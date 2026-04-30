import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.members.models import Member
from apps.vessels.models import Vessel
from .models import Booking, BookingRequest


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='manager')


def make_berth(marina, price=50):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    return Berth.objects.create(
        marina=marina, pier=pier, code='A1', price_per_night=price, status='available'
    )


class BookingAmountAutoCalcTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=50)
        self.member = Member.objects.create(marina=self.marina, name='A. Smith')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_amount_and_nights_calculated_on_create(self):
        resp = self.client.post('/api/v1/bookings/', {
            'berth':        self.berth.id,
            'vessel':       self.vessel.id,
            'booking_type': 'transient',
            'check_in':     '2026-06-01',
            'check_out':    '2026-06-04',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['nights'], 3)
        self.assertEqual(float(data['amount']), 150.0)


class BookingRequestConvertTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=50)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_convert_stranger_creates_member_vessel_booking(self):
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='transient',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 3),
            guest_name='J. Doe',
            guest_phone='+353 87 100 0000',
            guest_email='j@example.com',
            guest_vessel='Blue Horizon',
            guest_loa=12,
        )
        resp = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')
        self.assertIsNotNone(req.booking)
        self.assertIsNotNone(req.member)
        self.assertIsNotNone(req.vessel)
        self.assertEqual(req.booking.nights, 2)
        self.assertEqual(float(req.booking.amount), 100.0)
        self.assertEqual(req.member.name, 'J. Doe')
        self.assertEqual(req.vessel.name, 'Blue Horizon')

    def test_convert_is_idempotent(self):
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='transient',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 2),
            guest_name='K. Oduya',
            guest_vessel='Pelican',
        )
        resp1 = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        resp2 = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp1.json()['id'], resp2.json()['id'])
        self.assertEqual(Booking.objects.filter(marina=self.marina).count(), 1)

    def test_convert_relational_request_skips_profile_creation(self):
        member = Member.objects.create(marina=self.marina, name='G. Ferreira')
        vessel = Vessel.objects.create(marina=self.marina, name='Sunrise II', owner=member)
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='seasonal',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 8),
            member=member,
            vessel=vessel,
        )
        resp = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.member, member)
        self.assertEqual(req.vessel, vessel)


# ── Booking Engine Tests ─────────────────────────────────────────────────────

from apps.berths.models import Pier, Berth
from .booking_engine import compatible_available_berths, run_tetris, create_manual_approval


def make_berth_with_dims(marina, code, loa=20.0, beam=6.0, price=50):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='T', defaults={'label': 'Test Pier'})
    return Berth.objects.create(
        marina=marina, pier=pier, code=code,
        length_m=loa, max_beam_m=beam,
        price_per_night=price, status='available',
    )


class CompatibleBerthsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.b_small = make_berth_with_dims(self.marina, 'S1', loa=10.0, beam=3.5)
        self.b_large = make_berth_with_dims(self.marina, 'L1', loa=25.0, beam=8.0)

    def test_filters_by_loa(self):
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertNotIn(self.b_small.id, ids)
        self.assertIn(self.b_large.id, ids)

    def test_filters_by_beam(self):
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=None, boat_beam=9.0)
        ids = [b.id for b in result]
        self.assertNotIn(self.b_large.id, ids)

    def test_excludes_berths_with_overlapping_confirmed_booking(self):
        Booking.objects.create(
            marina=self.marina, berth=self.b_large,
            check_in='2026-06-03', check_out='2026-06-07',
            nights=4, status='confirmed',
        )
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertNotIn(self.b_large.id, ids)

    def test_excludes_pending_approval_bookings_from_overlap(self):
        # pending_approval has berth=null so should NOT be counted as blocking
        Booking.objects.create(
            marina=self.marina,
            check_in='2026-06-03', check_out='2026-06-07',
            nights=4, status='pending_approval',
        )
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertIn(self.b_large.id, ids)

    def test_adjacent_bookings_do_not_block(self):
        Booking.objects.create(
            marina=self.marina, berth=self.b_large,
            check_in='2026-05-25', check_out='2026-06-01',  # ends exactly on our check_in
            nights=7, status='confirmed',
        )
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertIn(self.b_large.id, ids)


class RunTetrisTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        self.b1 = make_berth_with_dims(self.marina, 'A1', loa=20.0, beam=6.0, price=80)
        self.b2 = make_berth_with_dims(self.marina, 'A2', loa=20.0, beam=6.0, price=80)

    def test_selects_berth_with_lowest_gap_score(self):
        # b1 has a booking ending 1 day before our check-in (gap_before=1)
        Booking.objects.create(
            marina=self.marina, berth=self.b1,
            check_in='2026-05-28', check_out='2026-06-01',
            nights=4, status='confirmed',
        )
        # b2 has a booking ending 10 days before our check-in (gap_before=10)
        Booking.objects.create(
            marina=self.marina, berth=self.b2,
            check_in='2026-05-15', check_out='2026-05-22',
            nights=7, status='confirmed',
        )
        booking = run_tetris(
            marina=self.marina,
            check_in='2026-06-01',
            check_out='2026-06-05',
            boat_loa=12.0,
            boat_beam=4.0,
            guest_name='T. Boater',
            guest_email='t@example.com',
            guest_phone='',
        )
        self.assertEqual(booking.berth, self.b1)
        self.assertEqual(booking.status, 'pending_payment')
        self.assertEqual(booking.nights, 4)
        self.assertEqual(float(booking.amount), 320.0)

    def test_run_tetris_raises_if_no_compatible_berth(self):
        from .booking_engine import NoAvailableBerthError
        Booking.objects.create(
            marina=self.marina, berth=self.b1,
            check_in='2026-06-01', check_out='2026-06-10',
            nights=9, status='confirmed',
        )
        Booking.objects.create(
            marina=self.marina, berth=self.b2,
            check_in='2026-06-02', check_out='2026-06-08',
            nights=6, status='confirmed',
        )
        with self.assertRaises(NoAvailableBerthError):
            run_tetris(
                marina=self.marina,
                check_in='2026-06-03',
                check_out='2026-06-06',
                boat_loa=12.0,
                boat_beam=4.0,
                guest_name='A. Guest',
                guest_email='',
                guest_phone='',
            )


class CreateManualApprovalTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.booking_mode = 'manual_approval'
        self.marina.save()

    def test_creates_booking_with_null_berth(self):
        booking = create_manual_approval(
            marina=self.marina,
            check_in='2026-06-01',
            check_out='2026-06-05',
            boat_loa=12.0,
            boat_beam=4.0,
            guest_name='J. Sailor',
            guest_email='j@sea.com',
            guest_phone='+353 87 100 0000',
        )
        self.assertIsNone(booking.berth)
        self.assertEqual(booking.status, 'pending_approval')
        self.assertEqual(booking.nights, 4)
        self.assertIsNone(booking.amount)

    def test_creates_booking_with_guest_fields(self):
        booking = create_manual_approval(
            marina=self.marina,
            check_in='2026-06-01',
            check_out='2026-06-03',
            boat_loa=10.0,
            boat_beam=3.5,
            guest_name='K. Wanderer',
            guest_email='k@sea.com',
            guest_phone='+353 87 200 0000',
        )
        self.assertEqual(booking.guest_name, 'K. Wanderer')
        self.assertEqual(booking.guest_email, 'k@sea.com')
        self.assertEqual(booking.boat_loa, 10.0)


# ── Endpoint Tests ───────────────────────────────────────────────────────────

import json
from unittest.mock import patch, MagicMock


class AvailableBerthsEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.b = make_berth_with_dims(self.marina, 'E1', loa=20.0, beam=6.0)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_compatible_berths(self):
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'check_in': '2026-07-01',
            'check_out': '2026-07-05',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
        })
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertIn(self.b.id, ids)

    def test_excludes_berth_too_small(self):
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'check_in': '2026-07-01',
            'check_out': '2026-07-05',
            'boat_loa': '22.0',
            'boat_beam': '4.0',
        })
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertNotIn(self.b.id, ids)

    def test_returns_400_without_dates(self):
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'boat_loa': '12.0',
        })
        self.assertEqual(resp.status_code, 400)


class BookingEngineRequestEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.b = make_berth_with_dims(self.marina, 'R1', loa=20.0, beam=6.0, price=100)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_mode_a_creates_pending_approval_booking(self):
        self.marina.booking_mode = 'manual_approval'
        self.marina.save()
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in': '2026-08-01',
            'check_out': '2026-08-05',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
            'guest_name': 'A. Mariner',
            'guest_email': 'a@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'pending_approval')
        self.assertIsNone(resp.data['berth'])

    @patch('apps.reservations.views.stripe')
    def test_mode_b_creates_pending_payment_booking(self, mock_stripe):
        mock_session = MagicMock()
        mock_session.id = 'cs_test_123'
        mock_session.url = 'https://checkout.stripe.com/test'
        mock_stripe.checkout.Session.create.return_value = mock_session
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in': '2026-08-01',
            'check_out': '2026-08-05',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
            'guest_name': 'B. Skipper',
            'guest_email': 'b@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'pending_payment')
        self.assertIsNotNone(resp.data['berth'])
        self.assertIn('checkout_url', resp.data)

    @patch('apps.reservations.views.stripe')
    def test_mode_b_returns_409_when_no_berth(self, mock_stripe):
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        # Block all compatible berths
        Booking.objects.create(
            marina=self.marina, berth=self.b,
            check_in='2026-08-01', check_out='2026-08-10',
            nights=9, status='confirmed',
        )
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in': '2026-08-02',
            'check_out': '2026-08-06',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
            'guest_name': 'C. Yachtsman',
            'guest_email': 'c@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 409)


class AssignBerthEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.berth = make_berth_with_dims(self.marina, 'AS1', loa=20.0, beam=6.0, price=75)
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in='2026-09-01',
            check_out='2026-09-04',
            nights=3,
            status='pending_approval',
            boat_loa=12.0,
            boat_beam=4.0,
            guest_name='D. Boater',
            guest_email='d@sea.com',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch('apps.reservations.views.stripe')
    @patch('apps.reservations.views.send_mail')
    def test_assign_berth_updates_status_and_creates_invoice(self, mock_mail, mock_stripe):
        mock_session = MagicMock()
        mock_session.id = 'cs_test_assign'
        mock_session.url = 'https://checkout.stripe.com/assign'
        mock_stripe.checkout.Session.create.return_value = mock_session

        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': self.berth.id,
        })
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'awaiting_payment')
        self.assertEqual(self.booking.berth, self.berth)
        from apps.billing.models import Invoice
        self.assertTrue(Invoice.objects.filter(booking=self.booking).exists())
        self.assertTrue(mock_mail.called)

    @patch('apps.reservations.views.stripe')
    @patch('apps.reservations.views.send_mail')
    def test_assign_berth_rejects_incompatible_berth(self, mock_mail, mock_stripe):
        small_berth = make_berth_with_dims(self.marina, 'AS2', loa=5.0, beam=2.0)
        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': small_berth.id,
        })
        self.assertEqual(resp.status_code, 400)

    def test_assign_berth_rejects_non_pending_approval_booking(self):
        self.booking.status = 'confirmed'
        self.booking.save()
        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': self.berth.id,
        })
        self.assertEqual(resp.status_code, 400)


class StripeWebhookTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.berth = make_berth_with_dims(self.marina, 'WH1', loa=20.0, beam=6.0)
        self.booking = Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in='2026-10-01', check_out='2026-10-05',
            nights=4, amount='300.00',
            status='pending_payment',
            stripe_session_id='cs_test_webhook',
            guest_name='E. Sailor',
        )
        from apps.billing.models import Invoice
        import datetime
        self.invoice = Invoice.objects.create(
            marina=self.marina,
            booking=self.booking,
            invoice_type='berth_fee',
            amount='300.00',
            issued=datetime.date.today(),
            due=datetime.date.today(),
            status='unpaid',
        )

    @patch('apps.reservations.views.stripe')
    def test_webhook_confirms_booking_and_marks_invoice_paid(self, mock_stripe):
        event_data = {
            'type': 'checkout.session.completed',
            'data': {'object': {
                'id': 'cs_test_webhook',
                'metadata': {'booking_id': str(self.booking.id)},
                'payment_status': 'paid',
            }},
        }
        mock_stripe.Webhook.construct_event.return_value = event_data

        resp = self.client.post(
            '/api/v1/bookings/stripe-webhook/',
            data=json.dumps(event_data),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='t=123,v1=abc',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'confirmed')
        self.assertTrue(self.booking.paid)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')

    @patch('apps.reservations.views.stripe')
    def test_webhook_rejects_invalid_signature(self, mock_stripe):
        import stripe as stripe_lib
        mock_stripe.Webhook.construct_event.side_effect = stripe_lib.error.SignatureVerificationError('bad sig', 'sig_header')
        resp = self.client.post(
            '/api/v1/bookings/stripe-webhook/',
            data='{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='bad',
        )
        self.assertEqual(resp.status_code, 400)
