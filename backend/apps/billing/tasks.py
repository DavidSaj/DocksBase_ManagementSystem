"""
apps/billing/tasks.py

Celery tasks for the billing module.

Beat schedule entry (in config/settings/base.py CELERY_BEAT_SCHEDULE):
  'send-overdue-invoice-alerts':       daily at 09:00 UTC
  'sweep-pending-utility-charges':     nightly at 02:30 UTC
"""

import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Task 1: send_overdue_invoice_alerts  (daily, 09:00 UTC)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='billing.send_overdue_invoice_alerts')
def send_overdue_invoice_alerts(self):
    """
    Daily digest: for each marina, email owner/manager users a table of all
    invoices that are open/unpaid and past their due_date.

    Idempotent — running twice on the same day is safe; no state is mutated.
    """
    from django.db.models import Count
    from apps.billing.models import Invoice
    from apps.accounts.models import User, Marina

    today = timezone.now().date()

    # Gather overdue invoices grouped by marina
    overdue_qs = (
        Invoice.objects
        .filter(status__in=['open', 'unpaid'], due_date__lt=today)
        .select_related('marina', 'member', 'tenant')
        .order_by('marina_id', 'due_date')
    )

    if not overdue_qs.exists():
        logger.info('send_overdue_invoice_alerts: no overdue invoices today (%s)', today)
        return

    # Group by marina
    by_marina: dict = {}
    for inv in overdue_qs:
        by_marina.setdefault(inv.marina_id, {'marina': inv.marina, 'invoices': []})
        by_marina[inv.marina_id]['invoices'].append(inv)

    from apps.accounts.notifications import rule_enabled

    for marina_id, data in by_marina.items():
        marina = data['marina']
        invoices = data['invoices']

        # Pick the most-overdue invoice to choose between the 7-day and 30-day
        # rules. The digest contains a mix, so we use the worst case to decide
        # whether the marina has opted into receiving the digest at all.
        max_days_overdue = max((today - inv.due_date).days for inv in invoices)
        rule_key = 'payment_overdue_30d' if max_days_overdue >= 30 else 'payment_overdue_7d'
        if not rule_enabled(marina, rule_key, 'email'):
            logger.info(
                'send_overdue_invoice_alerts: rule %s disabled for marina %s, skipping',
                rule_key, marina,
            )
            continue

        # Get owner/manager recipients for this marina
        recipients = list(
            User.objects.filter(marina=marina, role__in=['owner', 'manager'])
            .values_list('email', flat=True)
        )
        if not recipients:
            logger.info(
                'send_overdue_invoice_alerts: no owner/manager users for marina %s, skipping',
                marina,
            )
            continue

        count = len(invoices)

        # Build plain-text table
        rows = []
        rows.append(f"{'Invoice #':<20} {'Member':<30} {'Amount':>10} {'Days Overdue':>12}")
        rows.append('-' * 76)
        for inv in invoices:
            days_overdue = (today - inv.due_date).days
            if inv.member:
                member_name = inv.member.name
            elif inv.tenant:
                member_name = str(inv.tenant)
            else:
                member_name = '—'
            rows.append(
                f"{inv.invoice_number:<20} {member_name:<30} "
                f"€{inv.total:>8.2f} {days_overdue:>12}"
            )

        table = '\n'.join(rows)

        body = (
            f"Overdue Invoice Alert — {marina.name}\n"
            f"Date: {today}\n\n"
            f"{count} invoice{'s' if count != 1 else ''} "
            f"{'are' if count != 1 else 'is'} overdue at {marina.name}.\n\n"
            f"{table}\n\n"
            f"Review in DocksBase: {getattr(settings, 'FRONTEND_URL', '')}/billing\n\n"
            f"— DocksBase"
        )

        try:
            send_mail(
                subject=f"{count} overdue invoice{'s' if count != 1 else ''} — {marina.name}",
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=recipients,
                fail_silently=False,
            )
            logger.info(
                'send_overdue_invoice_alerts: sent digest for marina %s (%d invoices) to %s',
                marina, count, recipients,
            )
        except Exception as exc:
            logger.exception(
                'send_overdue_invoice_alerts: failed to send for marina %s: %s',
                marina, exc,
            )

        # notify managers/owners via in-app notifications
        from apps.notifications.utils import notify
        notif_users = list(User.objects.filter(marina=marina, role__in=['owner', 'manager', 'admin']))
        for user in notif_users:
            notify(
                marina=marina,
                recipient=user,
                kind='overdue_invoice',
                title=f"{count} overdue invoice{'s' if count != 1 else ''}",
                body=marina.name,
                link_screen='billing',
            )


# ---------------------------------------------------------------------------
# Task 2: sweep_pending_utility_charges  (nightly, 02:30 UTC)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='apps.billing.tasks.sweep_pending_utility_charges')
def sweep_pending_utility_charges(self, marina_id=None, dry_run=False):
    """
    Nightly sweep that attaches `PendingUtilityCharge` rows to draft invoices.

    See `apps.billing.utility_sweep.sweep_pending_utility_charges` for the
    full algorithm. Idempotent — already-swept rows are excluded by the
    query filter and each row is locked with `select_for_update()`.
    """
    from apps.billing.utility_sweep import (
        sweep_pending_utility_charges as _sweep,
    )

    marina_ids = [marina_id] if marina_id else None
    result = _sweep(marina_ids=marina_ids, dry_run=dry_run)
    logger.info(
        'sweep_pending_utility_charges: '
        'rows_swept=%d lines_added=%d invoices_created=%d invoices_appended=%d',
        result.rows_swept, result.lines_added,
        result.invoices_created, result.invoices_appended,
    )
    return {
        'rows_swept': result.rows_swept,
        'lines_added': result.lines_added,
        'invoices_created': result.invoices_created,
        'invoices_appended': result.invoices_appended,
        'marinas': result.marinas,
    }
