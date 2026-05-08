"""
Celery tasks for the utilities app.

All tasks are decorated with @shared_task so they work regardless of
how the Celery app is configured (explicit app or project-level).

Beat schedule entries are documented in INSTALL.md.
Wire them into CELERY_BEAT_SCHEDULE in config/settings/base.py.

Task list:
  poll_smart_meters_all_marinas — fan-out: polls all active marinas
  poll_smart_meters(marina_id)  — per-marina polling (called by fan-out)
  check_meter_outages(marina_id)
  send_low_balance_alerts
  auto_deduct_utility_charges
  send_launch_confirmation_reminders
  enforce_no_show
  expire_wash_tokens
"""

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Smart meter polling
# ---------------------------------------------------------------------------

@shared_task(name='apps.utilities.tasks.poll_smart_meters_all_marinas')
def poll_smart_meters_all_marinas():
    """
    Fan-out task — runs every 15 minutes via Celery Beat.
    Finds all active marinas and dispatches poll_smart_meters for each.
    """
    from apps.accounts.models import Marina

    active_marina_ids = Marina.objects.filter(
        operations_paused=False
    ).values_list('id', flat=True)

    for marina_id in active_marina_ids:
        poll_smart_meters.delay(marina_id)

    logger.info('poll_smart_meters_all_marinas: dispatched %d marina tasks', len(active_marina_ids))


@shared_task(name='apps.utilities.tasks.poll_smart_meters')
def poll_smart_meters(marina_id: int):
    """
    Entry point from Celery Beat (via poll_smart_meters_all_marinas fan-out).
    Delegates to poll_service.poll_all_meters().
    Outage detection runs inside poll_all_meters after readings are committed.
    """
    from apps.utilities.services.poll_service import poll_all_meters

    logger.info('poll_smart_meters: marina_id=%s', marina_id)
    poll_all_meters(marina_id)


# ---------------------------------------------------------------------------
# Outage detection (standalone — also called inside poll_smart_meters)
# ---------------------------------------------------------------------------

@shared_task(name='apps.utilities.tasks.check_meter_outages')
def check_meter_outages(marina_id: int):
    """
    Standalone outage check. Normally chained after poll_smart_meters via
    Celery chain(). Can also be triggered ad-hoc via admin or shell.
    """
    from apps.utilities.services.outage_service import check_outages

    logger.info('check_meter_outages: marina_id=%s', marina_id)
    check_outages(marina_id)


# ---------------------------------------------------------------------------
# Low balance alerts
# ---------------------------------------------------------------------------

@shared_task(name='apps.utilities.tasks.send_low_balance_alerts')
def send_low_balance_alerts():
    """
    Every hour. Finds UtilityWallet records where balance < low_balance_threshold
    and auto_deduct_enabled=True. Sends notification if last_low_balance_alert
    is null or older than 24h. Updates last_low_balance_alert.
    """
    from datetime import timedelta

    from django.db.models import F
    from django.utils import timezone

    from apps.utilities.models import UtilityWallet

    now    = timezone.now()
    cutoff = now - timedelta(hours=24)

    wallets = UtilityWallet.objects.filter(
        auto_deduct_enabled=True,
        balance__lt=F('low_balance_threshold'),
    ).filter(
        # last alert was >24h ago or never sent
        last_low_balance_alert__isnull=True
    ).union(
        UtilityWallet.objects.filter(
            auto_deduct_enabled=True,
            last_low_balance_alert__lt=cutoff,
        ).filter(balance__lt=F('low_balance_threshold'))
    )

    count = 0
    for wallet in wallets:
        # TODO: send in-app or email notification via comms app
        logger.warning(
            'Low balance alert: member=%s marina=%s balance=%.2f',
            wallet.member_id, wallet.marina_id, wallet.balance,
        )
        UtilityWallet.objects.filter(pk=wallet.pk).update(last_low_balance_alert=now)
        count += 1

    logger.info('send_low_balance_alerts: %d wallets alerted', count)


# ---------------------------------------------------------------------------
# Auto-deduct utility charges
# ---------------------------------------------------------------------------

@shared_task(name='apps.utilities.tasks.auto_deduct_utility_charges')
def auto_deduct_utility_charges():
    """
    Every hour. For each wallet with auto_deduct_enabled=True:
    1. Calculate kWh/m3 consumed since the last deduction (delta from MeterReading).
    2. Look up ChargeableItem for utility type; compute charge.
    3. Create InvoiceLineItem via billing engine.
    4. Call debit_wallet(wallet, charge).
    5. If wallet.balance <= 0 after deduction:
       - Find all ServiceBollard records linked to member's berth SmartMeter
         where has_remote_switch=True AND status='active'.
       - For each: call switch_bollard(bollard, 'off', reason='Wallet balance exhausted').
       Note: power restoration is NOT automatic — staff must manually switch back
             after confirming payment.
    """
    from apps.utilities.models import ServiceBollard, UtilityWallet
    from apps.utilities.services.bollard_service import switch_bollard
    from apps.utilities.services.wallet_service import debit_wallet, _get_meters_for_member

    wallets = UtilityWallet.objects.filter(auto_deduct_enabled=True).select_related('member', 'marina')

    for wallet in wallets:
        meters = _get_meters_for_member(wallet.member, wallet.marina_id)
        total_charge = _compute_current_charge(wallet, meters)
        if not total_charge or total_charge <= 0:
            continue

        try:
            updated = debit_wallet(
                wallet,
                amount=total_charge,
                description='Auto-deduct: utility usage',
            )
            if updated.balance <= 0:
                bollards = ServiceBollard.objects.filter(
                    marina=wallet.marina,
                    berth__in=meters.values_list('berth_id', flat=True),
                    has_remote_switch=True,
                    status='active',
                )
                for bollard in bollards:
                    try:
                        switch_bollard(
                            bollard,
                            action='off',
                            triggered_by=None,
                            reason='Wallet balance exhausted — auto-deduct',
                        )
                    except Exception:
                        logger.exception('Failed to switch off bollard %s', bollard.pk)
        except Exception:
            logger.exception('auto_deduct_utility_charges failed for wallet %s', wallet.pk)


def _compute_current_charge(wallet, meters):
    """Compute total charge for meters since last deduction. Stub for hourly billing."""
    # Full implementation: delta between latest and previous MeterReading,
    # multiply by ChargeableItem unit_price. Deferred to full billing pass.
    return None


# ---------------------------------------------------------------------------
# Launch confirmation reminders
# ---------------------------------------------------------------------------

@shared_task(name='apps.utilities.tasks.send_launch_confirmation_reminders')
def send_launch_confirmation_reminders():
    """
    Every 30 min. Finds LaunchRequest where confirmed_by_customer=False
    and confirmation_deadline is within 2 hours. Sends reminder via comms app.
    """
    from datetime import timedelta

    from django.utils import timezone

    now = timezone.now()
    horizon = now + timedelta(hours=2)

    try:
        from apps.boatyard.models import LaunchRequest
    except ImportError:
        logger.warning('LaunchRequest model not available — skip confirmation reminders')
        return

    pending = LaunchRequest.objects.filter(
        confirmed_by_customer=False,
        confirmation_deadline__gte=now,
        confirmation_deadline__lte=horizon,
        no_show=False,
    ).select_related('vessel__member')

    count = 0
    for lr in pending:
        # TODO: dispatch via comms app
        logger.info('Reminder: LaunchRequest %s — confirmation_deadline=%s', lr.pk, lr.confirmation_deadline)
        count += 1

    logger.info('send_launch_confirmation_reminders: %d reminders sent', count)


# ---------------------------------------------------------------------------
# No-show enforcement
# ---------------------------------------------------------------------------

@shared_task(name='apps.utilities.tasks.enforce_no_show')
def enforce_no_show():
    """
    Every 15 min. Finds LaunchRequest where:
    - status='launching', arrived_at is null
    - scheduled_for + marina.no_show_grace_minutes < now()
    - no_show=False

    For each:
    1. Set no_show=True.
    2. Look up 'No-Show Penalty' ChargeableItem.
    3. Create InvoiceLineItem; set launch_request.no_show_fee_line.
    4. Send member notification.
    5. CRITICAL: create new LaunchRequest with request_type='retrieval',
       status='scheduled', slot=original slot, vessel=vessel.
       This puts the vessel back in the forklift queue to clear the staging dock.
    """
    from datetime import timedelta

    from django.utils import timezone

    from apps.billing.models import Invoice, InvoiceLineItem

    now = timezone.now()

    try:
        from apps.boatyard.models import LaunchRequest
    except ImportError:
        logger.warning('LaunchRequest model not available — skip no-show enforcement')
        return

    candidates = LaunchRequest.objects.filter(
        status='launching',
        arrived_at__isnull=True,
        no_show=False,
        scheduled_for__isnull=False,
    ).select_related('marina', 'vessel', 'slot')

    count = 0
    for lr in candidates:
        grace_cutoff = lr.scheduled_for + timedelta(minutes=lr.marina.no_show_grace_minutes)
        if now < grace_cutoff:
            continue

        lr.no_show = True
        lr.save(update_fields=['no_show'])

        # Charge no-show fee
        from apps.billing.models import ChargeableItem
        penalty_item = ChargeableItem.objects.filter(
            marina=lr.marina, category='no_show_penalty', is_active=True
        ).first()
        if penalty_item:
            # Find or create a draft invoice for this member
            invoice, _ = Invoice.objects.get_or_create(
                marina=lr.marina,
                member=lr.vessel.member if hasattr(lr.vessel, 'member') else None,
                status='draft',
                source_type='no_show',
                defaults={'invoice_number': f'NS-{lr.pk}', 'billing_period': ''},
            )
            line = InvoiceLineItem.objects.create(
                invoice=invoice,
                description=f'No-Show Penalty — LaunchRequest #{lr.pk}',
                quantity=1,
                unit_price=penalty_item.unit_price,
                total_price=penalty_item.unit_price,
                chargeable_item=penalty_item,
            )
            LaunchRequest.objects.filter(pk=lr.pk).update(no_show_fee_line=line)

        # Create retrieval request to clear the staging dock
        LaunchRequest.objects.create(
            marina=lr.marina,
            vessel=lr.vessel,
            slot=lr.slot,
            status='scheduled',
            request_type='retrieval',
            notes=f'Auto-created retrieval after no-show on LaunchRequest #{lr.pk}',
        )

        logger.warning(
            'No-show enforced: LaunchRequest=%s vessel=%s marina=%s',
            lr.pk, lr.vessel_id, lr.marina_id,
        )
        count += 1

    logger.info('enforce_no_show: %d no-shows processed', count)


# ---------------------------------------------------------------------------
# Wash token expiry
# ---------------------------------------------------------------------------

@shared_task(name='apps.utilities.tasks.expire_wash_tokens')
def expire_wash_tokens():
    """
    Every hour. Sets status='expired' on WashToken where
    expires_at < now() and status='issued'.
    """
    from django.utils import timezone

    from apps.utilities.models import WashToken

    updated = WashToken.objects.filter(
        expires_at__lt=timezone.now(),
        status='issued',
    ).update(status='expired')

    logger.info('expire_wash_tokens: %d tokens expired', updated)
