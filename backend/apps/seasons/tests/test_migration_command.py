"""Smoke-test the migrate_legacy_seasonal_bookings management command."""
from datetime import date
from decimal import Decimal
from io import StringIO

import pytest
from django.core.management import call_command


@pytest.mark.django_db
def test_command_converts_seasonal_booking_to_lease(marina, member, berth):
    from apps.vessels.models import Vessel
    from apps.reservations.models import Booking
    from apps.seasons.models import BerthLease

    vessel = Vessel.objects.create(
        marina=marina, name='Sea Lion', owner=member,
    )
    Booking.objects.create(
        marina=marina, berth=berth, vessel=vessel,
        booking_type='seasonal',
        check_in=date(2026, 5, 1), check_out=date(2026, 10, 31),
        nights=184, amount=Decimal('4500.00'),
        status='confirmed', paid=True,
    )
    out = StringIO()
    call_command('migrate_legacy_seasonal_bookings', stdout=out)
    assert BerthLease.objects.filter(source='migrated_legacy').count() == 1
    lease = BerthLease.objects.get(source='migrated_legacy')
    assert lease.season_total == Decimal('4500.00')
    assert lease.status == 'active'  # booking was paid
    # Idempotent on a second run.
    call_command('migrate_legacy_seasonal_bookings', stdout=out)
    assert BerthLease.objects.filter(source='migrated_legacy').count() == 1


@pytest.mark.django_db
def test_command_dry_run_does_not_write(marina, member, berth):
    from apps.vessels.models import Vessel
    from apps.reservations.models import Booking
    from apps.seasons.models import BerthLease

    vessel = Vessel.objects.create(marina=marina, name='Sea Lion', owner=member)
    Booking.objects.create(
        marina=marina, berth=berth, vessel=vessel,
        booking_type='seasonal',
        check_in=date(2026, 5, 1), check_out=date(2026, 10, 31),
        nights=184, amount=Decimal('4500.00'),
        status='confirmed', paid=False,
    )
    out = StringIO()
    call_command('migrate_legacy_seasonal_bookings', '--dry-run', stdout=out)
    assert BerthLease.objects.count() == 0
