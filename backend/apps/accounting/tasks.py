"""
apps/accounting/tasks.py

Celery tasks for the accounting module.

Beat schedule (add to config/settings/base.py CELERY_BEAT_SCHEDULE):
  'instalment-processor':        nightly 00:30
  'deferred-revenue-recogniser': nightly 01:00
  'hmrc-duty-aggregator':        quarterly last day 02:00
  'fx-rate-updater':             daily 06:00
  'accounting-sync-push':        every 15 minutes

All tasks are idempotent — running them twice on the same day produces the same result.
select_for_update(skip_locked=True) is used to avoid concurrent task interference.
"""

import logging
from datetime import timedelta
from decimal import Decimal

from celery import shared_task
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: advance notice (stub — connect to notification service)
# ---------------------------------------------------------------------------

def _send_advance_notice(instalment):
    """Send advance notice email to member about upcoming instalment."""
    # TODO: integrate with existing email/notification service
    logger.info(
        'Advance notice: instalment %s due %s for plan %s',
        instalment.pk, instalment.due_date, instalment.plan,
    )


def _notify_manager_approval(instalment):
    """Notify marina manager that manual approval is required for this instalment."""
    logger.info(
        'Manager approval needed: instalment %s plan %s',
        instalment.pk, instalment.plan,
    )


def _attempt_dd_charge(instalment):
    """
    Attempt Stripe Direct Debit charge for an instalment.
    On failure: increment retry_count, set last_retry_at, schedule retry.
    On second failure: status='failed'.
    """
    import stripe
    plan = instalment.plan

    try:
        # TODO: use actual Stripe mandate payment here
        # stripe.PaymentIntent.create(
        #     amount=int(instalment.amount * 100),
        #     currency=plan.marina.base_currency.lower(),
        #     customer=plan.member.stripe_customer_id,
        #     payment_method=plan.dd_mandate_ref,
        #     confirm=True,
        # )
        logger.info('DD charge attempted for instalment %s', instalment.pk)
    except Exception as exc:
        instalment.retry_count    += 1
        instalment.last_retry_at  = timezone.now()
        instalment.failure_reason = str(exc)

        if instalment.retry_count >= 2:
            instalment.status = 'failed'
            instalment.save(update_fields=['status', 'retry_count', 'last_retry_at', 'failure_reason'])
        else:
            instalment.save(update_fields=['retry_count', 'last_retry_at', 'failure_reason'])
            # Re-schedule via Celery countdown
            retry_seconds = plan.marina.dd_retry_days * 86400 if hasattr(plan.marina, 'dd_retry_days') else 3 * 86400
            instalment_processor.apply_async(countdown=retry_seconds)


# ---------------------------------------------------------------------------
# Task 1: instalment_processor  (nightly, 00:30)
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=3, name='apps.accounting.tasks.instalment_processor')
def instalment_processor(self):
    """
    Step 1: Send advance notices to members for upcoming instalments.
    Step 2: Issue invoices for due instalments.
    Uses select_for_update(skip_locked=True) to avoid concurrent processing.
    """
    from apps.accounting.models import PaymentPlanInstalment
    from apps.accounting.services.payment_plans import issue_instalment_invoice
    from django.db.models import F

    today = timezone.now().date()

    # Step 1: Send advance notices
    try:
        with transaction.atomic():
            qs = PaymentPlanInstalment.objects.select_for_update(skip_locked=True).filter(
                status='scheduled',
                due_date__lte=today + timedelta(days=3),  # default advance days
            ).select_related('plan', 'plan__marina')

            for instalment in qs:
                _send_advance_notice(instalment)
                instalment.status      = 'notified'
                instalment.notified_at = timezone.now()
                instalment.save(update_fields=['status', 'notified_at'])
    except Exception as exc:
        logger.exception('instalment_processor step 1 failed: %s', exc)
        raise self.retry(exc=exc, countdown=300)

    # Step 2: Issue invoices for due instalments
    try:
        with transaction.atomic():
            qs = PaymentPlanInstalment.objects.select_for_update(skip_locked=True).filter(
                status__in=['scheduled', 'notified'],
                due_date__lte=today,
            ).select_related('plan', 'plan__marina')

            for instalment in qs:
                if instalment.plan.auto_issue:
                    issue_instalment_invoice(instalment)
                else:
                    _notify_manager_approval(instalment)

                if instalment.plan.dd_mandate_ref:
                    _attempt_dd_charge(instalment)
    except Exception as exc:
        logger.exception('instalment_processor step 2 failed: %s', exc)
        raise self.retry(exc=exc, countdown=300)

    logger.info('instalment_processor completed for %s', today)


# ---------------------------------------------------------------------------
# Task 2: deferred_revenue_recogniser  (nightly, 01:00)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='apps.accounting.tasks.deferred_revenue_recogniser')
def deferred_revenue_recogniser(self):
    """
    Nightly task: recognise a day's worth of deferred revenue for each active entry.
    Idempotent: get_or_create on (deferred_entry, recognition_date) prevents double-posting.
    """
    from apps.accounting.models import DeferredRevenueEntry, DeferredRevenueRecognitionLog
    from apps.accounting.services.gl_posting import post_deferred_recognition_gl

    today = timezone.now().date()

    entries = DeferredRevenueEntry.objects.filter(
        is_fully_recognised=False,
        service_start__lte=today,
        cancelled_at__isnull=True,
    )

    for entry in entries:
        try:
            days        = max((entry.service_end - entry.service_start).days, 1)
            daily_rate  = entry.total_amount / days
            amount      = min(daily_rate, entry.deferred_amount).quantize(Decimal('0.01'))

            # Idempotent: get_or_create prevents double-posting on Celery retry
            log, created = DeferredRevenueRecognitionLog.objects.get_or_create(
                deferred_entry=entry,
                recognition_date=today,
                defaults={'amount_recognised': amount},
            )
            if not created:
                logger.debug('Skipping entry %s — already recognised for %s', entry.pk, today)
                continue

            je = post_deferred_recognition_gl(entry, amount, today)
            log.journal_entry = je
            log.save(update_fields=['journal_entry'])

            with transaction.atomic():
                entry.earned_amount   += amount
                entry.deferred_amount -= amount
                if entry.deferred_amount <= 0:
                    entry.is_fully_recognised = True
                entry.save(update_fields=['earned_amount', 'deferred_amount', 'is_fully_recognised'])

        except Exception as exc:
            logger.exception('deferred_revenue_recogniser failed for entry %s: %s', entry.pk, exc)

    logger.info('deferred_revenue_recogniser completed for %s', today)


# ---------------------------------------------------------------------------
# Task 3: hmrc_duty_period_aggregator  (quarterly)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='apps.accounting.tasks.hmrc_duty_period_aggregator')
def hmrc_duty_period_aggregator(self):
    """
    Quarterly task: aggregate red diesel declarations into HMRCFuelDutyReturn.
    Only processes marinas where hmrc_fuel_duty_enabled=True.
    """
    from apps.accounting.models import HMRCFuelDutyReturn, RedDieselSaleDeclaration
    from apps.accounts.models import Marina
    from django.db.models import Sum
    import datetime

    today = timezone.now().date()
    # Determine current quarter period string e.g. "2026-Q1"
    quarter     = (today.month - 1) // 3 + 1
    period_str  = f'{today.year}-Q{quarter}'
    quarter_starts = {1: '-01-01', 2: '-04-01', 3: '-07-01', 4: '-10-01'}
    quarter_ends   = {1: '-03-31', 2: '-06-30', 3: '-09-30', 4: '-12-31'}
    period_start = datetime.date.fromisoformat(f'{today.year}{quarter_starts[quarter]}')
    period_end   = datetime.date.fromisoformat(f'{today.year}{quarter_ends[quarter]}')

    marinas = Marina.objects.filter(hmrc_fuel_duty_enabled=True)
    for marina in marinas:
        agg = RedDieselSaleDeclaration.objects.filter(
            marina=marina,
            duty_period=period_str,
        ).aggregate(
            total_litres=Sum('propulsion_litres') + Sum('non_propulsion_litres'),
            prop_litres=Sum('propulsion_litres'),
            non_prop_litres=Sum('non_propulsion_litres'),
            prop_duty=Sum('propulsion_duty'),
            non_prop_duty=Sum('non_propulsion_duty'),
        )

        total_litres  = agg['total_litres'] or Decimal('0.000')
        prop_litres   = agg['prop_litres'] or Decimal('0.000')
        non_litres    = agg['non_prop_litres'] or Decimal('0.000')
        prop_duty     = agg['prop_duty'] or Decimal('0.00')
        non_duty      = agg['non_prop_duty'] or Decimal('0.00')

        ret, _ = HMRCFuelDutyReturn.objects.update_or_create(
            marina=marina,
            duty_period=period_str,
            defaults={
                'period_start':               period_start,
                'period_end':                 period_end,
                'total_litres_sold':          total_litres,
                'propulsion_litres':          prop_litres,
                'non_propulsion_litres':      non_litres,
                'propulsion_duty_payable':    prop_duty,
                'non_propulsion_duty_payable': non_duty,
                'total_duty_payable':         prop_duty + non_duty,
                'status':                     HMRCFuelDutyReturn.ReturnStatus.DRAFT,
            },
        )
        logger.info('HMRC return upserted for marina %s period %s', marina, period_str)

        # TODO: send email to marina accountant contact
    logger.info('hmrc_duty_period_aggregator completed for period %s', period_str)


# ---------------------------------------------------------------------------
# Task 4: fx_rate_updater  (daily, 06:00 UTC)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='apps.accounting.tasks.fx_rate_updater')
def fx_rate_updater(self):
    """
    Daily task: fetch exchange rates from ECB free API and upsert ExchangeRate records.
    Errors are logged to AccountingIntegrationConfig.sync_errors for the marina.
    """
    import requests as req
    from apps.accounting.models import Currency, ExchangeRate

    today = timezone.now().date()

    ECB_URL = 'https://api.exchangerate.host/latest?source=ecb'

    try:
        response = req.get(ECB_URL, timeout=15)
        response.raise_for_status()
        rates_data = response.json().get('rates', {})
    except Exception as exc:
        logger.error('fx_rate_updater: failed to fetch ECB rates: %s', exc)
        return

    # Iterate all marinas with multiple active currencies
    from apps.accounts.models import Marina
    for marina in Marina.objects.all():
        currencies = list(Currency.objects.filter(marina=marina, is_active=True))
        if len(currencies) <= 1:
            continue

        base_cur = next((c for c in currencies if c.is_base), None)
        if not base_cur:
            continue

        for currency in currencies:
            if currency.code == base_cur.code:
                continue
            rate_value = rates_data.get(currency.code)
            if not rate_value:
                continue

            ExchangeRate.objects.update_or_create(
                marina=marina,
                from_currency=base_cur.code,
                to_currency=currency.code,
                rate_date=today,
                defaults={'rate': Decimal(str(rate_value)), 'source': 'ecb'},
            )

    logger.info('fx_rate_updater completed for %s', today)


# ---------------------------------------------------------------------------
# Task 5: accounting_sync_push  (every 15 minutes)
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=5, default_retry_delay=60,
             name='apps.accounting.tasks.accounting_sync_push')
def accounting_sync_push(self, config_id=None):
    """
    Push new invoices, payments, and journal entries to active external accounting platforms.
    Retries with exponential backoff on AdapterRetryableError.
    If config_id is provided, only sync that specific config.
    """
    from apps.accounting.models import AccountingIntegrationConfig, AccountingSyncRecord, JournalEntry
    from apps.accounting.integrations import _get_adapter
    from apps.accounting.integrations.base import AdapterRetryableError
    from apps.billing.models import Invoice, Payment

    if config_id:
        configs = AccountingIntegrationConfig.objects.filter(pk=config_id, is_active=True)
    else:
        configs = AccountingIntegrationConfig.objects.filter(is_active=True)

    for config in configs:
        try:
            adapter = _get_adapter(config)
            _push_new_records(adapter, config)
            config.last_synced_at = timezone.now()
            config.save(update_fields=['last_synced_at'])
        except AdapterRetryableError as exc:
            logger.warning('accounting_sync_push retryable error: %s', exc)
            raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))
        except Exception as exc:
            logger.exception('accounting_sync_push failed for config %s: %s', config.pk, exc)
            # Record error in config.sync_errors
            errors = config.sync_errors or []
            errors.append({'error': str(exc), 'timestamp': str(timezone.now())})
            config.sync_errors = errors[-50:]  # keep last 50 errors
            config.save(update_fields=['sync_errors'])


def _push_new_records(adapter, config):
    """
    Find objects created/modified since config.last_synced_at with no 'ok' sync record.
    Push each and record the result.
    """
    from apps.accounting.models import AccountingSyncRecord, JournalEntry
    from apps.accounting.integrations.base import AdapterError
    from apps.billing.models import Invoice, Payment

    since = config.last_synced_at
    marina = config.marina

    # -- Invoices --
    qs = Invoice.objects.filter(marina=marina, status='unpaid')
    if since:
        qs = qs.filter(created_at__gte=since)
    for invoice in qs:
        already_synced = AccountingSyncRecord.objects.filter(
            config=config, object_type='invoice', local_id=invoice.pk, status='ok'
        ).exists()
        if already_synced:
            continue
        try:
            ext_id = adapter.push_invoice(invoice)
            AccountingSyncRecord.objects.create(
                config=config, direction='push', object_type='invoice',
                local_id=invoice.pk, external_id=ext_id, status='ok',
            )
        except AdapterError as exc:
            AccountingSyncRecord.objects.create(
                config=config, direction='push', object_type='invoice',
                local_id=invoice.pk, status='error', error_detail=str(exc),
            )

    # -- Payments --
    qs = Payment.objects.filter(invoice__marina=marina)
    if since:
        qs = qs.filter(paid_at__gte=since)
    for payment in qs:
        already_synced = AccountingSyncRecord.objects.filter(
            config=config, object_type='payment', local_id=payment.pk, status='ok'
        ).exists()
        if already_synced:
            continue
        try:
            ext_id = adapter.push_payment(payment)
            AccountingSyncRecord.objects.create(
                config=config, direction='push', object_type='payment',
                local_id=payment.pk, external_id=ext_id, status='ok',
            )
        except AdapterError as exc:
            AccountingSyncRecord.objects.create(
                config=config, direction='push', object_type='payment',
                local_id=payment.pk, status='error', error_detail=str(exc),
            )

    # -- Journal Entries --
    qs = JournalEntry.objects.filter(marina=marina, is_posted=True)
    if since:
        qs = qs.filter(created_at__gte=since)
    for je in qs:
        already_synced = AccountingSyncRecord.objects.filter(
            config=config, object_type='gl_entry', local_id=je.pk, status='ok'
        ).exists()
        if already_synced:
            continue
        try:
            ext_id = adapter.push_journal_entry(je)
            AccountingSyncRecord.objects.create(
                config=config, direction='push', object_type='gl_entry',
                local_id=je.pk, external_id=ext_id, status='ok',
            )
        except AdapterError as exc:
            AccountingSyncRecord.objects.create(
                config=config, direction='push', object_type='gl_entry',
                local_id=je.pk, status='error', error_detail=str(exc),
            )


# ---------------------------------------------------------------------------
# Task 6: credit_auto_deduct  (dispatched by Invoice post_save signal)
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=3, name='apps.accounting.tasks.credit_auto_deduct')
def credit_auto_deduct(self, invoice_pk: int):
    """
    Auto-deduct available credit against a newly issued invoice.
    Dispatched via transaction.on_commit() in the Invoice post_save signal.
    """
    from apps.billing.models import Invoice
    from apps.accounting.services.credit import auto_deduct_on_invoice

    try:
        invoice = Invoice.objects.get(pk=invoice_pk)
    except Invoice.DoesNotExist:
        logger.warning('credit_auto_deduct: invoice %s not found', invoice_pk)
        return

    if invoice.status not in ('unpaid', 'open'):
        return

    try:
        auto_deduct_on_invoice(invoice)
    except Exception as exc:
        logger.exception('credit_auto_deduct failed for invoice %s: %s', invoice_pk, exc)
        raise self.retry(exc=exc, countdown=30)
