"""
Tests for REQUESTED status, confirm/reject transitions, and capacity guard.

TDD: these tests are written first and fail until implementation lands.
"""
import pytest
from datetime import datetime, timezone

from rest_framework.test import APIClient

from apps.activities.models import Activity, ActivityBooking
from apps.activities.services.transitions import (
    confirm_requested_booking,
    reject_requested_booking,
    CapacityExceeded,
)

pytestmark = pytest.mark.django_db


def _activity(marina, capacity_max=4):
    return Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=capacity_max,
    )


def _requested(marina, activity, participant_count=1):
    return ActivityBooking.objects.create(
        marina=marina, activity=activity,
        start_datetime=datetime(2030, 1, 6, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 6, 11, 0, tzinfo=timezone.utc),
        participant_count=participant_count,
        status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
        lead_name='Jane',
    )


def test_confirm_transitions_status(marina):
    a = _activity(marina)
    b = _requested(marina, a)
    confirm_requested_booking(b)
    b.refresh_from_db()
    assert b.status == ActivityBooking.Status.CONFIRMED


def test_confirm_rejects_when_capacity_full(marina):
    a = _activity(marina, capacity_max=2)
    ActivityBooking.objects.create(
        marina=marina, activity=a,
        start_datetime=datetime(2030, 1, 6, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 6, 11, 0, tzinfo=timezone.utc),
        participant_count=2,
        status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    b = _requested(marina, a, participant_count=1)
    with pytest.raises(CapacityExceeded) as ei:
        confirm_requested_booking(b)
    assert ei.value.remaining == 0
    b.refresh_from_db()
    assert b.status == ActivityBooking.Status.REQUESTED


def test_reject_transitions_to_cancelled(marina):
    a = _activity(marina)
    b = _requested(marina, a)
    reject_requested_booking(b, reason='Slot full')
    b.refresh_from_db()
    assert b.status == ActivityBooking.Status.CANCELLED
    assert b.cancellation_reason == 'Slot full'
    assert b.cancelled_at is not None


def test_confirm_endpoint_409_on_capacity_exceeded(marina, manager_user):
    """POST /api/v1/activity-bookings/<id>/confirm/ returns 409 when capacity exhausted."""
    a = _activity(marina, capacity_max=1)
    # One CONFIRMED booking that fills capacity
    ActivityBooking.objects.create(
        marina=marina, activity=a,
        start_datetime=datetime(2030, 1, 6, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 6, 11, 0, tzinfo=timezone.utc),
        participant_count=1,
        status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    # A REQUESTED booking that would exceed capacity
    b = _requested(marina, a, participant_count=1)

    client = APIClient()
    client.force_authenticate(user=manager_user)
    resp = client.post(f'/api/v1/activity-bookings/{b.pk}/confirm/')
    assert resp.status_code == 409
    assert resp.data['detail'] == 'capacity_exceeded'
