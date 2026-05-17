"""
Auto-migrate legacy ``Booking.booking_type='seasonal'`` rows to the new
``BerthLease`` tenancy model (spec §7.2 — locked decision §9.10).

Locked decision §9.10: auto-migrate with an audit report email to the
marina admin.  This command is **opt-in** — existing repos don't break on
``migrate`` because no Django data-migration is registered; an operator
must explicitly run::

    python manage.py migrate_legacy_seasonal_bookings           # all marinas
    python manage.py migrate_legacy_seasonal_bookings --marina 7  # one marina
    python manage.py migrate_legacy_seasonal_bookings --dry-run

Behaviour:

* One ``Season`` is created (or reused) per ``(marina, year, season_type)``
  group, named "Summer YYYY" / "Winter YYYY" / "Annual YYYY" inferred
  from the booking's check_in month.
* One ``BerthLease`` per legacy Booking, with::

      season_total = booking.amount  (preserve quoted price)
      start_date   = booking.check_in
      end_date     = booking.check_out
      member       = booking.vessel.owner (fallback to None)
      vessel       = booking.vessel
      status       = 'active' if booking was paid, else 'offered'
      source       = 'migrated_legacy'

* The original ``Booking`` is **not** deleted; we set its notes to flag
  the conversion so a manager can revert within 30 days (locked decision
  §9.10) — actual revert UI is Phase 5.
* An audit report email is sent to the marina admin listing each
  conversion (silently skipped if the marina has no contact_email).
"""
from collections import defaultdict
from datetime import date as _date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from apps.seasons.models import BerthLease, Season


def _infer_season_type(check_in: _date) -> str:
    month = check_in.month
    if 4 <= month <= 10:
        return 'summer'
    return 'winter'


def _season_window(year: int, season_type: str):
    if season_type == 'summer':
        return _date(year, 5, 1), _date(year, 10, 31)
    if season_type == 'annual':
        return _date(year, 1, 1), _date(year, 12, 31)
    # winter: Nov–Mar of the following year
    return _date(year, 11, 1), _date(year + 1, 3, 31)


class Command(BaseCommand):
    help = (
        'Auto-migrate Booking(booking_type="seasonal") rows to BerthLease + '
        'Season records.  Opt-in per spec §9.10.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--marina', type=int, default=None,
                            help='Limit to a single marina id.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Report only; do not write.')
        parser.add_argument('--quiet', action='store_true',
                            help='Suppress per-row stdout.')

    def handle(self, *args, marina=None, dry_run=False, quiet=False, **opts):
        from apps.reservations.models import Booking

        qs = Booking.objects.filter(booking_type='seasonal').select_related(
            'marina', 'berth', 'vessel', 'vessel__owner',
        )
        if marina is not None:
            qs = qs.filter(marina_id=marina)

        # Group by (marina, year, season_type) to seed Season rows.
        by_marina = defaultdict(list)
        for b in qs:
            by_marina[b.marina_id].append(b)

        total_converted = 0
        total_skipped = 0
        report_per_marina = defaultdict(list)

        for marina_id, bookings in by_marina.items():
            for booking in bookings:
                try:
                    with transaction.atomic():
                        result = self._convert_one(booking, dry_run=dry_run)
                except Exception as exc:  # pragma: no cover — diagnostic
                    self.stderr.write(
                        f'ERR booking={booking.pk}: {exc!r}'
                    )
                    total_skipped += 1
                    continue
                if result is None:
                    total_skipped += 1
                    continue
                lease, season_name = result
                total_converted += 1
                report_per_marina[marina_id].append(
                    (booking.pk, lease.pk if lease else None, season_name)
                )
                if not quiet:
                    self.stdout.write(
                        f'  booking={booking.pk} → lease={lease.pk if lease else "DRY"} '
                        f'(season={season_name})'
                    )

        # Email audit reports.
        if not dry_run:
            self._send_audit_emails(report_per_marina)

        self.stdout.write(self.style.SUCCESS(
            f'Migration complete: converted={total_converted} '
            f'skipped={total_skipped} dry_run={dry_run}'
        ))

    # ------------------------------------------------------------------
    def _convert_one(self, booking, *, dry_run):
        if not booking.berth_id:
            return None  # nothing to lease against
        if BerthLease.objects.filter(
            berth=booking.berth, start_date=booking.check_in,
            end_date=booking.check_out, source='migrated_legacy',
        ).exists():
            return None  # idempotent

        season_type = _infer_season_type(booking.check_in)
        year = booking.check_in.year
        s_start, s_end = _season_window(year, season_type)
        name = (
            f'{season_type.title()} {year}'
            if season_type != 'winter'
            else f'Winter {year}/{(year + 1) % 100:02d}'
        )

        season, _ = Season.objects.get_or_create(
            marina=booking.marina, name=name,
            defaults=dict(
                season_type=season_type,
                start_date=s_start, end_date=s_end,
                notes='Auto-created during legacy migration.',
            ),
        )

        member = None
        if booking.vessel and booking.vessel.owner_id:
            member = booking.vessel.owner

        if member is None:
            # Lease requires a member; skip orphaned bookings.
            return None

        if dry_run:
            return None, name

        # Map booking.paid → status.
        if booking.paid:
            status = 'active'
        else:
            status = 'offered'

        lease = BerthLease.objects.create(
            marina=booking.marina,
            berth=booking.berth,
            member=member,
            vessel=booking.vessel,
            season=season,
            season_total=booking.amount or Decimal('0.00'),
            deposit_amount=Decimal('0.00'),
            start_date=booking.check_in,
            end_date=booking.check_out,
            status=status,
            status_changed_at=timezone.now(),
            source='migrated_legacy',
            notes=(
                f'Migrated from legacy Booking #{booking.pk}. '
                'See spec §7.2.'
            ),
        )
        # Flag the original booking — kept visible so a manager can
        # revert (Phase 5 UI).
        booking.notes = (booking.notes or '') + (
            f'\n[migrated to lease #{lease.pk} on '
            f'{timezone.now():%Y-%m-%d}]'
        )
        booking.save(update_fields=['notes'])
        return lease, name

    def _send_audit_emails(self, report_per_marina):
        from apps.accounts.models import Marina
        for marina_id, rows in report_per_marina.items():
            if not rows:
                continue
            try:
                marina = Marina.objects.get(pk=marina_id)
            except Marina.DoesNotExist:
                continue
            recipient = marina.contact_email
            if not recipient:
                continue
            lines = [
                f'Marina: {marina.name}',
                f'Total leases created: {len(rows)}',
                '',
                'booking_id  →  lease_id  (season)',
            ]
            for booking_id, lease_id, season_name in rows:
                lines.append(f'  {booking_id}  →  {lease_id}  ({season_name})')
            try:
                send_mail(
                    subject=f'[DocksBase] Seasonal-booking auto-migration report — {marina.name}',
                    message='\n'.join(lines),
                    from_email='noreply@docksbase.com',
                    recipient_list=[recipient],
                    fail_silently=True,
                )
            except Exception:  # pragma: no cover — diagnostic only
                pass
