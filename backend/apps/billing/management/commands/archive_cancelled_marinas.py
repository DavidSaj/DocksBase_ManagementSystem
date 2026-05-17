"""
Stub management command — cold-storage archival of long-cancelled marinas.

Spec ref: docs/superpowers/specs/2026-05-17-billing-gates-design.md §A.10 / locked
decision A.6 — 90-day soft retention before cold-storage archive after a marina
transitions to `cancelled`.

TODO: this command is intentionally a no-op stub for v1. The blocker is the
storage destination (S3 Glacier? Compressed JSON dump in apps.documents?) —
that decision is deferred. When implementing:

  1. Select marinas where `billing_state='cancelled'` AND the most recent
     BillingStateChange transitioning into `cancelled` is older than
     BILLING_CANCELLED_RETENTION_DAYS.
  2. Serialise core marina data + bookings + invoices into a single archive
     blob.
  3. Upload to cold storage (e.g. S3 + IA storage class).
  4. Delete or anonymise the live rows according to policy.

For now this command simply lists candidates so operators can verify the
retention window calculation against production.
"""
import datetime as _dt

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import Marina
from apps.admin_portal.models import BillingStateChange
from config.billing_gates import BILLING_CANCELLED_RETENTION_DAYS


class Command(BaseCommand):
    help = 'List (or — in future — archive) cancelled marinas past retention.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=BILLING_CANCELLED_RETENTION_DAYS,
            help='Retention window in days (default: %(default)s).',
        )
        parser.add_argument(
            '--apply', action='store_true',
            help='Currently unimplemented — exits with error to prevent data loss.',
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - _dt.timedelta(days=options['days'])
        candidates = []
        for marina in Marina.objects.filter(billing_state='cancelled'):
            entered_at = (
                marina.billing_state_changes
                .filter(to_state='cancelled').order_by('-created_at').first()
            )
            if entered_at and entered_at.created_at < cutoff:
                candidates.append((marina, entered_at.created_at))
        self.stdout.write(f'{len(candidates)} candidate marina(s) past retention:')
        for marina, when in candidates:
            self.stdout.write(f'  marina={marina.id} ({marina.name!r}) cancelled at {when}')
        if options['apply']:
            self.stderr.write(self.style.ERROR(
                '--apply is not yet implemented; see TODO in '
                'apps/billing/management/commands/archive_cancelled_marinas.py'
            ))
            return
        self.stdout.write(self.style.SUCCESS('Dry run only — no data was archived.'))
