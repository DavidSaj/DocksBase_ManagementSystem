import pytest
from datetime import datetime, time, timezone
from unittest.mock import patch
from django.test import override_settings
from rest_framework.test import APIClient
from apps.activities.models import Activity, ActivityBooking, ActivityTimeSlot

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def activity(marina):
    a = Activity.objects.create(marina=marina, name='Kayak', duration_minutes=60, capacity_max=2)
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))
    return a


@override_settings(CAPTCHA_BYPASS=True)
def test_public_list_returns_active_activities(client, marina, activity):
    r = client.get(f'/api/v1/public/activities/?marina={marina.slug}')
    assert r.status_code == 200
    assert any(item['id'] == activity.pk for item in r.data)


@override_settings(CAPTCHA_BYPASS=True)
def test_public_slots_returns_state(client, activity):
    r = client.get(f'/api/v1/public/activities/{activity.pk}/slots/?from=2030-01-07&to=2030-01-07')
    assert r.status_code == 200
    assert r.data['slots'][0]['state'] == 'open'


@override_settings(CAPTCHA_BYPASS=True)
def test_public_request_creates_requested_booking(client, marina, activity):
    r = client.post('/api/v1/public/activity-requests/', {
        'marina_slug':       marina.slug,
        'activity_id':       activity.pk,
        'start_datetime':    '2030-01-07T10:00:00Z',
        'participant_count': 1,
        'lead_name':         'Jane',
        'lead_email':        'jane@example.com',
        'captcha_token':     'test',
    }, format='json')
    assert r.status_code == 201
    b = ActivityBooking.objects.get(pk=r.data['id'])
    assert b.status == ActivityBooking.Status.REQUESTED


@override_settings(CAPTCHA_BYPASS=True)
def test_public_request_409_when_slot_full(client, marina, activity):
    ActivityBooking.objects.create(
        marina=marina, activity=activity,
        start_datetime=datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=2, status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    r = client.post('/api/v1/public/activity-requests/', {
        'marina_slug':       marina.slug,
        'activity_id':       activity.pk,
        'start_datetime':    '2030-01-07T10:00:00Z',
        'participant_count': 1,
        'lead_name':         'Bob',
        'lead_email':        'bob@example.com',
        'captcha_token':     'test',
    }, format='json')
    assert r.status_code == 409


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_SECRET_KEY='s')
def test_public_request_400_on_bad_captcha(client, marina, activity):
    with patch('apps.common.captcha.requests.post') as p:
        p.return_value.status_code = 200
        p.return_value.json.return_value = {'success': False}
        r = client.post('/api/v1/public/activity-requests/', {
            'marina_slug': marina.slug, 'activity_id': activity.pk,
            'start_datetime': '2030-01-07T10:00:00Z', 'participant_count': 1,
            'lead_name': 'X', 'lead_email': 'x@e.com', 'captcha_token': 't',
        }, format='json')
    assert r.status_code == 400
    assert r.data['detail'] == 'captcha_failed'
