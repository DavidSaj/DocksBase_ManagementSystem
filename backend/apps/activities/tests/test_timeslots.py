import pytest
from datetime import time
from django.db import IntegrityError
from apps.activities.models import Activity, ActivityTimeSlot

pytestmark = pytest.mark.django_db


def _make_activity(marina):
    return Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=4,
    )


def test_timeslot_creates(marina):
    a = _make_activity(marina)
    slot = ActivityTimeSlot.objects.create(
        activity=a, weekday=ActivityTimeSlot.Weekday.MON, start_time=time(10, 0),
    )
    assert slot.is_active is True
    assert slot.weekday == 0


def test_timeslot_unique_per_activity_weekday_time(marina):
    a = _make_activity(marina)
    ActivityTimeSlot.objects.create(
        activity=a, weekday=ActivityTimeSlot.Weekday.MON, start_time=time(10, 0),
    )
    with pytest.raises(IntegrityError):
        ActivityTimeSlot.objects.create(
            activity=a, weekday=ActivityTimeSlot.Weekday.MON, start_time=time(10, 0),
        )
