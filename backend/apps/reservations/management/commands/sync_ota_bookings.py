"""
sync_ota_bookings — run every 10 minutes via cron.

Fetches the inbound iCal feed for each OTAConnection that has inbound_ical_url set,
parses each VEVENT, and creates/updates Booking records.
booking_source is set to connection.slug[:20] so records are identified per-connection.

Usage:
  python manage.py sync_ota_bookings
  python manage.py sync_ota_bookings --marina-slug=port-de-nice
  python manage.py sync_ota_bookings --dry-run
"""

import re
from datetime import date, timedelta

import requests
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from icalendar import Calendar

from apps.reservations.booking_engine import ACTIVE_STATUSES


def _parse_date(dt_value):
    if hasattr(dt_value, 'dt'):
        val = dt_value.dt
    else:
        val = dt_value
    if hasattr(val, 'date'):
        return val.date()
    return val


def _parse_loa_from_summary(summary: str):
    match = re.search(r'LOA\s+([\d.]+)', summary or '', re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return None


def _find_free_ota_berth(connection, check_in, check_out, boat_loa=None):
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    blocked_ids = (
        Booking.objects.filter(
            marina=connection.marina,
            berth__isnull=False,
            status__in=ACTIVE_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        )
        .values_list('berth_id', flat=True)
        .distinct()
    )

    qs = Berth.objects.filter(
        marina=connection.marina,
        ota_connection=connection,
    ).exclude(status='maintenance').exclude(pk__in=blocked_ids).order_by('code')

    if boat_loa is not None:
        qs = qs.filter(length_m__gte=boat_loa)

    return qs.first()


def sync_connection(connection, dry=False, stdout=None):
    from apps.reservations.models import Booking

    if not connection.inbound_ical_url:
        return 0

    try:
        resp = requests.get(connection.inbound_ical_url, timeout=15)
        resp.raise_for_status()
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR fetching feed for {connection.slug}: {exc}')
        return 0

    try:
        cal = Calendar.from_ical(resp.content)
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR parsing iCal for {connection.slug}: {exc}')
        return 0

    created = updated = 0

    with transaction.atomic():
        for component in cal.walk():
            if component.name != 'VEVENT':
                continue
            uid = str(component.get('UID', ''))
            if not uid:
                continue
            try:
                check_in = _parse_date(component['DTSTART'])
                check_out = _parse_date(component['DTEND'])
            except (KeyError, AttributeError):
                continue
            if not isinstance(check_in, date) or not isinstance(check_out, date):
                continue
            if check_out <= check_in:
                continue

            summary = str(component.get('SUMMARY', ''))
            boat_loa = _parse_loa_from_summary(summary)

            existing = Booking.objects.filter(
                marina=connection.marina,
                booking_source=connection.slug[:20],
                mysea_event_uid=uid,
            ).first()

            if existing:
                if existing.check_in != check_in or existing.check_out != check_out:
                    if not dry:
                        existing.check_in = check_in
                        existing.check_out = check_out
                        existing.nights = (check_out - check_in).days or 1
                        existing.save(update_fields=['check_in', 'check_out', 'nights'])
                    updated += 1
                continue

            berth = _find_free_ota_berth(connection, check_in, check_out, boat_loa)
            if berth is None:
                if stdout:
                    stdout.write(f'  WARNING: No free berth for {check_in}–{check_out} (uid={uid})')
                continue

            nights = (check_out - check_in).days or 1
            if not dry:
                Booking.objects.create(
                    marina=connection.marina,
                    berth=berth,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    status='confirmed',
                    paid=True,
                    booking_source=connection.slug[:20],
                    mysea_event_uid=uid,  # TODO: rename to ota_event_uid in a follow-up migration
                    guest_name=summary[:200] if summary else '',
                    boat_loa=boat_loa,
                )
            created += 1

        if not dry:
            connection.last_synced = timezone.now()
            connection.save(update_fields=['last_synced'])

    return created + updated


class Command(BaseCommand):
    help = 'Sync OTA bookings from iCal feeds for all connections with inbound_ical_url set'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--marina-slug', default='')

    def handle(self, *args, **options):
        from apps.berths.models import OTAConnection

        dry = options['dry_run']
        slug = options['marina_slug']

        qs = OTAConnection.objects.exclude(inbound_ical_url='')
        if slug:
            qs = qs.filter(marina__slug=slug)

        total = 0
        for conn in qs:
            prefix = '[DRY] ' if dry else ''
            self.stdout.write(f'{prefix}Syncing {conn.marina.slug} / {conn.slug}…')
            count = sync_connection(conn, dry=dry, stdout=self.stdout)
            total += count
            self.stdout.write(f'  {count} events processed.')

        self.stdout.write(f'Done. Total: {total}')
