"""
Tests for the Broadcast Center feature (spec §14 locked decisions).
"""
from datetime import date, timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier
from apps.communications.models import Broadcast, BroadcastRecipient, MessageLog
from apps.communications.services import broadcast as svc
from apps.members.models import Member
from apps.reservations.models import Booking
from apps.vessels.models import Vessel


def _make_marina(name='Test Marina', sms_unit_cost_cents=250):
    return Marina.objects.create(name=name, sms_unit_cost_cents=sms_unit_cost_cents)


def _make_user(marina, email='mgr@test.com'):
    return User.objects.create_user(email=email, password='pw', marina=marina, role='manager')


def _make_member(marina, name='Alice Skipper', phone='+15551110001', email='alice@example.com',
                 opt_in=True):
    return Member.objects.create(
        marina=marina, name=name, phone=phone, email=email,
        broadcast_opt_in=opt_in,
    )


def _make_booking_for(marina, member, *,
                     check_in=None, check_out=None,
                     status='checked_in', pier_label=''):
    today = timezone.now().date()
    check_in = check_in or today
    check_out = check_out or (today + timedelta(days=2))
    pier, _ = Pier.objects.get_or_create(
        marina=marina, code=pier_label or 'P',
        defaults={'label': f'Pier {pier_label or "P"}'},
    )
    berth = Berth.objects.create(
        marina=marina, pier=pier, code=f'{pier_label or "P"}-{member.pk}',
        pier_label=pier_label or 'P', status='available',
    )
    vessel = Vessel.objects.create(marina=marina, name=f'Vessel-{member.pk}', owner=member)
    return Booking.objects.create(
        marina=marina, berth=berth, vessel=vessel,
        booking_type='transient', check_in=check_in, check_out=check_out,
        nights=(check_out - check_in).days or 1, status=status,
    )


# ── STOP webhook ────────────────────────────────────────────────────────────

@override_settings(TWILIO_AUTH_TOKEN='')
class StopWebhookTests(TestCase):
    """Locked decision B."""

    def setUp(self):
        self.marina = _make_marina()
        self.member = _make_member(self.marina)
        self.client = APIClient()

    def test_stop_webhook_flips_opt_in(self):
        resp = self.client.post(
            '/api/v1/communications/webhooks/twilio-sms/',
            data={'From': self.member.phone, 'Body': 'STOP'},
        )
        self.assertEqual(resp.status_code, 200)
        self.member.refresh_from_db()
        self.assertFalse(self.member.broadcast_opt_in)

        # Subsequent broadcast skips them: build a broadcast targeting all
        # active-in-marina members and assert the opted-out member is gone.
        _make_booking_for(self.marina, self.member)
        broadcast = Broadcast.objects.create(
            marina=self.marina, title='t', channel='sms', body='hi',
            cohort_filter={'all_of': [{'everyone_active_in_marina': True}]},
        )
        result = svc.preview(broadcast)
        self.assertEqual(result['count'], 0)

    def test_twilio_signature_required(self):
        with override_settings(TWILIO_AUTH_TOKEN='real-token'):
            resp = self.client.post(
                '/api/v1/communications/webhooks/twilio-sms/',
                data={'From': self.member.phone, 'Body': 'STOP'},
            )
            self.assertEqual(resp.status_code, 403)
            self.member.refresh_from_db()
            self.assertTrue(self.member.broadcast_opt_in)


# ── Cohort drift (optimistic concurrency) ───────────────────────────────────

@override_settings(TWILIO_AUTH_TOKEN='')
class CohortDriftTests(TestCase):
    """Locked decision C."""

    def setUp(self):
        self.marina = _make_marina()
        self.user = _make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        # 5 active members
        self.members = []
        for i in range(5):
            m = _make_member(
                self.marina,
                name=f'Member {i}',
                phone=f'+1555111000{i}',
                email=f'm{i}@x.com',
            )
            _make_booking_for(self.marina, m)
            self.members.append(m)

    def _make_previewed_broadcast(self):
        broadcast = Broadcast.objects.create(
            marina=self.marina, title='t', channel='sms', body='hi',
            cohort_filter={'all_of': [{'everyone_active_in_marina': True}]},
        )
        svc.preview(broadcast)
        broadcast.refresh_from_db()
        return broadcast

    def test_send_409_on_cohort_size_drift(self):
        b = self._make_previewed_broadcast()
        self.assertEqual(b.previewed_count, 5)

        # Add a new active member -> drift upward.
        new_m = _make_member(
            self.marina, name='Late Arrival', phone='+15551119999', email='late@x.com',
        )
        _make_booking_for(self.marina, new_m)

        resp = self.client.post(f'/api/v1/communications/broadcasts/{b.pk}/send/')
        self.assertEqual(resp.status_code, 409)
        body = resp.json()
        self.assertEqual(body['previewed_count'], 5)
        self.assertEqual(body['new_count'], 6)
        self.assertIn('5', body['detail'])
        self.assertIn('6', body['detail'])

    @patch('apps.communications.services.dispatch.dispatch')
    def test_send_proceeds_when_count_equal_or_smaller(self, mock_dispatch):
        # Mock dispatch so we don't hit Twilio.
        mock_dispatch.side_effect = lambda **kw: MessageLog.objects.create(
            marina=kw['marina'], channel=kw['channel'], recipient=kw['recipient'],
            subject=kw.get('subject', ''), body=kw.get('body', ''),
            status='sent', member=kw.get('member'),
        )

        # Equal:
        b = self._make_previewed_broadcast()
        resp = self.client.post(f'/api/v1/communications/broadcasts/{b.pk}/send/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['dispatched'], 5)

        # Smaller: drop a member, then re-preview at 5, then remove one and send.
        b2 = self._make_previewed_broadcast()
        self.members[-1].broadcast_opt_in = False
        self.members[-1].save(update_fields=['broadcast_opt_in'])
        resp2 = self.client.post(f'/api/v1/communications/broadcasts/{b2.pk}/send/')
        self.assertEqual(resp2.status_code, 200, resp2.content)
        self.assertEqual(resp2.json()['dispatched'], 4)


# ── Marina-name body prefix ─────────────────────────────────────────────────

@override_settings(TWILIO_AUTH_TOKEN='')
class BodyPrefixTests(TestCase):
    """Locked decision A: every outbound SMS body starts with `[<marina>] `."""

    def setUp(self):
        self.marina = _make_marina(name='Harbor Reach')
        self.user = _make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        for i in range(3):
            m = _make_member(self.marina, name=f'M{i}', phone=f'+1555200000{i}', email=f'm{i}@x.com')
            _make_booking_for(self.marina, m)

    @patch('apps.communications.adapters.sms.send_sms', return_value='SM-fake')
    def test_body_prefixed_with_marina_name(self, _mock_sms):
        b = Broadcast.objects.create(
            marina=self.marina, title='Storm', channel='sms', body='Storm coming!',
            cohort_filter={'all_of': [{'everyone_active_in_marina': True}]},
        )
        svc.preview(b)
        resp = self.client.post(f'/api/v1/communications/broadcasts/{b.pk}/send/')
        self.assertEqual(resp.status_code, 200, resp.content)
        logs = MessageLog.objects.filter(marina=self.marina, channel='sms')
        self.assertGreater(logs.count(), 0)
        for log in logs:
            self.assertTrue(
                log.body.startswith('[Harbor Reach] '),
                f'Body did not start with marina prefix: {log.body!r}',
            )


# ── Active-in-marina filter excludes stale members ──────────────────────────

class ActiveInMarinaTests(TestCase):
    """Locked decision D."""

    def setUp(self):
        self.marina = _make_marina()
        self.recent_member = _make_member(self.marina, name='Recent', phone='+15553330001')
        self.stale_member = _make_member(self.marina, name='Stale', phone='+15553330002')

        # Recent: booking 30 days ago.
        today = timezone.now().date()
        _make_booking_for(
            self.marina, self.recent_member,
            check_in=today - timedelta(days=30),
            check_out=today - timedelta(days=28),
            status='checked_out',
        )
        # Stale: booking 400 days ago.
        _make_booking_for(
            self.marina, self.stale_member,
            check_in=today - timedelta(days=400),
            check_out=today - timedelta(days=398),
            status='checked_out',
            pier_label='B',
        )

    def test_active_in_marina_excludes_stale_members(self):
        qs = svc.resolve_cohort(
            self.marina,
            {'all_of': [{'everyone_active_in_marina': True}]},
        )
        ids = set(qs.values_list('pk', flat=True))
        self.assertIn(self.recent_member.pk, ids)
        self.assertNotIn(self.stale_member.pk, ids)


# ── Cost estimate ───────────────────────────────────────────────────────────

class CostEstimateTests(TestCase):

    def test_cost_estimate_uses_marina_sms_cost(self):
        # 1 segment, 5 recipients, 250 cents/segment -> 5 * 1 * 250 = 1250
        marina = _make_marina(sms_unit_cost_cents=250)
        self.assertEqual(svc.estimate_cost_cents(marina, 5, 'hello', 'sms'), 1250)
        # 161-char body -> 2 segments
        body_2seg = 'a' * 161
        self.assertEqual(svc.estimate_sms_segments(body_2seg), 2)
        self.assertEqual(
            svc.estimate_cost_cents(marina, 10, body_2seg, 'sms'),
            10 * 2 * 250,
        )
        # Custom marina cost overrides
        marina2 = _make_marina(name='M2', sms_unit_cost_cents=400)
        self.assertEqual(svc.estimate_cost_cents(marina2, 3, 'hello', 'sms'), 3 * 1 * 400)
