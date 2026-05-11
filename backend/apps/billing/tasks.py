"""
apps/billing/tasks.py

Celery tasks for the billing module.

Beat schedule entry (in config/settings/base.py CELERY_BEAT_SCHEDULE):
  'send-overdue-invoice-alerts': daily at 09:00 UTC
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

    for marina_id, data in by_marina.items():
        marina = data['marina']
        invoices = data['invoices']

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
