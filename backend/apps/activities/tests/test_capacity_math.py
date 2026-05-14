import pytest
from datetime import date, datetime, time, timezone
from apps.activities.models import Activity, ActivityBooking, ActivityTimeSlot
from apps.activities.services.slots import materialise_slots

pytestmark = pytest.mark.django_db


def test_open_slot_when_no_bookings(marina):
    a = Activity.objects.create(marina=marina, name='Kayak', duration_minutes=60, capacity_max=4)
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))  # Monday
    slots = materialise_slots(a, '2030-01-07', '2030-01-07')  # Monday
    assert len(slots) == 1
    assert slots[0]['available'] == 4
    assert slots[0]['state'] == 'open'


def test_requested_seats_count_against_capacity(marina):
    a = Activity.objects.create(marina=marina, name='Kayak', duration_minutes=60, capacity_max=2)
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))
    start = datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc)
    ActivityBooking.objects.create(
        marina=marina, activity=a, start_datetime=start,
        end_datetime=start + (datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc) - start),
        participant_count=2, status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    slots = materialise_slots(a, '2030-01-07', '2030-01-07')
    assert slots[0]['available'] == 0
    assert slots[0]['state'] == 'full'


def test_low_state_when_few_seats_left(marina):
    a = Activity.objects.create(marina=marina, name='Kayak', duration_minutes=60, capacity_max=10)
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))
    start = datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc)
    ActivityBooking.objects.create(
        marina=marina, activity=a, start_datetime=start,
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=9, status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    slots = materialise_slots(a, '2030-01-07', '2030-01-07')
    assert slots[0]['available'] == 1
    assert slots[0]['state'] == 'low'


def test_season_window_excludes_slots(marina):
    a = Activity.objects.create(
        marina=marina, name='Sailing', duration_minutes=60, capacity_max=4,
        season_start=date(2030, 6, 1), season_end=date(2030, 8, 31),
    )
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))
    slots = materialise_slots(a, '2030-01-07', '2030-01-14')
    assert slots == []


def test_inactive_slot_template_excluded(marina):
    a = Activity.objects.create(marina=marina, name='Kayak', duration_minutes=60, capacity_max=4)
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0), is_active=False)
    slots = materialise_slots(a, '2030-01-07', '2030-01-07')
    assert slots == []
