"""
sync_mysea_bookings — run every 10 minutes via cron.

Fetches the mySea iCal feed for each marina that has mysea_ical_url set,
parses each VEVENT, and creates/updates Booking records with booking_source='mysea'.

Deduplication: by mysea_event_uid (the VEVENT UID from the mySea feed).
Berth assignment: match by length_m >= boat_loa if parseable from SUMMARY,
otherwise first free mySea berth ordered by code.

Usage:
  python manage.py sync_mysea_bookings
  python manage.py sync_mysea_bookings --marina-slug=port-de-nice
  python manage.py sync_mysea_bookings --dry-run
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
    """Convert icalendar date/datetime to Python date."""
    if hasattr(dt_value, 'dt'):
        val = dt_value.dt
    else:
        val = dt_value
    if hasattr(val, 'date'):
        return val.date()
    return val


def _parse_loa_from_summary(summary: str):
    """Try to extract boat LOA from SUMMARY strings like 'LOA 12.5m'."""
    match = re.search(r'LOA\s+([\d.]+)', summary or '', re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return None


def _find_free_mysea_berth(marina, check_in, check_out, boat_loa=None):
    """Return the first free mySea berth for the given dates, optionally filtered by LOA."""
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    blocked_ids = (
        Booking.objects.filter(
            marina=marina,
            berth__isnull=False,
            status__in=ACTIVE_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        )
        .values_list('berth_id', flat=True)
        .distinct()
    )

    qs = Berth.objects.filter(
        marina=marina,
        sales_channel='mysea',
    ).exclude(
        status='maintenance',
    ).exclude(
        pk__in=blocked_ids,
    ).order_by('code')

    if boat_loa is not None:
        qs = qs.filter(length_m__gte=boat_loa)

    return qs.first()


def sync_marina(marina, dry=False, stdout=None):
    from apps.reservations.models import Booking

    if not marina.mysea_ical_url:
        return 0

    try:
        resp = requests.get(marina.mysea_ical_url, timeout=15)
        resp.raise_for_status()
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR fetching feed for {marina.slug}: {exc}')
        return 0

    try:
        cal = Calendar.from_ical(resp.content)
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR parsing iCal for {marina.slug}: {exc}')
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
                marina=marina,
                booking_source='mysea',
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
                    if stdout:
                        stdout.write(f'  Updated booking {existing.pk} (uid={uid})')
                continue

            # New booking
            berth = _find_free_mysea_berth(marina, check_in, check_out, boat_loa)
            if berth is None:
                if stdout:
                    stdout.write(f'  WARNING: No free mySea berth for {check_in}–{check_out} (uid={uid})')
                continue

            nights = (check_out - check_in).days or 1
            if not dry:
                Booking.objects.create(
                    marina=marina,
                    berth=berth,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    status='confirmed',
                    paid=True,
                    booking_source='mysea',
                    mysea_event_uid=uid,
                    guest_name=summary[:200] if summary else '',
                    boat_loa=boat_loa,
                )
            created += 1
            if stdout:
                stdout.write(f'  Created booking for {check_in}–{check_out} berth={berth.code} (uid={uid})')

        if not dry:
            marina.mysea_last_synced = timezone.now()
            marina.save(update_fields=['mysea_last_synced'])

    return created + updated


class Command(BaseCommand):
    help = 'Sync mySea bookings from iCal feeds for all marinas with mysea_ical_url set'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--marina-slug', default='')

    def handle(self, *args, **options):
        from apps.accounts.models import Marina

        dry = options['dry_run']
        slug = options['marina_slug']

        qs = Marina.objects.exclude(mysea_ical_url='')
        if slug:
            qs = qs.filter(slug=slug)

        total = 0
        for marina in qs:
            prefix = '[DRY] ' if dry else ''
            self.stdout.write(f'{prefix}Syncing {marina.slug}…')
            count = sync_marina(marina, dry=dry, stdout=self.stdout)
            total += count
            self.stdout.write(f'  {count} events processed.')

        self.stdout.write(f'Done. Total: {total}')
