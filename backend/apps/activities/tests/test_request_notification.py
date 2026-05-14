import pytest
from datetime import datetime, timezone
from apps.activities.models import Activity, ActivityBooking
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


def test_requested_booking_creates_notification(marina, manager_user):
    a = Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=4,
    )
    before = Notification.objects.filter(kind='activity_request').count()
    ActivityBooking.objects.create(
        marina=marina, activity=a,
        start_datetime=datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=1,
        status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
        lead_name='Jane',
    )
    assert Notification.objects.filter(kind='activity_request').count() == before + 1
    n = Notification.objects.filter(kind='activity_request').latest('id')
    assert n.recipient_id == manager_user.id
    assert n.link_screen == 'activities'


def test_confirmed_booking_does_not_create_notification(marina, manager_user):
    a = Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=4,
    )
    before = Notification.objects.filter(kind='activity_request').count()
    ActivityBooking.objects.create(
        marina=marina, activity=a,
        start_datetime=datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=1,
        status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
        lead_name='Jane',
    )
    assert Notification.objects.filter(kind='activity_request').count() == before
