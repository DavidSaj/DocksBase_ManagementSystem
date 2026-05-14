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


def test_timeslot_viewset_creates_and_lists(manager_user, marina):
    from rest_framework.test import APIClient
    a = Activity.objects.create(marina=marina, name='Kayak', duration_minutes=60, capacity_max=4)
    client = APIClient()
    client.force_authenticate(manager_user)

    r = client.post('/api/v1/activity-time-slots/', {
        'activity': a.pk, 'weekday': 0, 'start_time': '10:00:00', 'is_active': True,
    }, format='json')
    assert r.status_code == 201, r.content

    r = client.get(f'/api/v1/activity-time-slots/?activity={a.pk}')
    assert r.status_code == 200
    data = r.data.get('results', r.data)
    assert len(data) == 1
