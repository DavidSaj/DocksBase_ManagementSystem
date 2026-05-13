import datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.billing.models import Invoice, InvoiceLineItem, ChargeableItem, TaxRate
from apps.billing import service as billing_service
from apps.members.models import Member
from apps.vessels.models import Vessel
from .models import Booking, BookingRequest
from .emails import (
    send_booking_request_boater_email,
    send_booking_request_manager_email,
    send_approve_email,
    send_reject_email,
    send_booking_confirmed_email,
)


def make_marina():
    return Marina.objects.create(name='Test Marina')


def _default_tax(marina):
    tax, _ = TaxRate.objects.get_or_create(
        marina=marina, name='Standard', defaults={'rate': '0.00', 'is_default': True}
    )
    return tax


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='manager')


def make_berth(marina, price=50):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=price,
        tax_category=_default_tax(marina),
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code='A1', pricing_tier=tier, status='available'
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
from .booking_engine import compatible_available_berths, run_tetris, create_manual_approval, find_date_alternatives


def make_berth_with_dims(marina, code, loa=20.0, beam=6.0, price=50):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='T', defaults={'label': 'Test Pier'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Berth Night', category='berth',
        defaults={'pricing_model': 'per_night', 'unit_price': price,
                  'tax_category': _default_tax(marina)},
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code,
        length_m=loa, max_beam_m=beam,
        pricing_tier=tier, status='available',
    )


class ChannelFilterTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        from apps.berths.models import OTAConnection
        self.conn = OTAConnection.objects.create(
            marina=self.marina, name='mySea', slug='mysea', target_pct=20
        )
        self.berth = make_berth(self.marina)
        self.check_in = datetime.date(2030, 7, 1)
        self.check_out = datetime.date(2030, 7, 5)

    def test_ota_berth_excluded_from_direct_search(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.ota_connection = self.conn
        self.berth.save(update_fields=['ota_connection'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertNotIn(self.berth, qs)

    def test_direct_berth_included_in_search(self):
        from apps.reservations.booking_engine import compatible_available_berths
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertIn(self.berth, qs)

    def test_null_ota_berth_included(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.ota_connection = None
        self.berth.save(update_fields=['ota_connection'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertIn(self.berth, qs)


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

    def test_draft_too_deep_excluded(self):
        self.b_small.max_draft_m = Decimal('1.5')
        self.b_small.save()
        result = compatible_available_berths(
            self.marina, '2026-06-01', '2026-06-05', boat_draft=2.0,
        )
        ids = [b.id for b in result]
        self.assertNotIn(self.b_small.id, ids)
        self.assertIn(self.b_large.id, ids)  # NULL draft = unlimited, must not be excluded

    def test_draft_fits_included(self):
        self.b_large.max_draft_m = Decimal('2.5')
        self.b_large.save()
        result = compatible_available_berths(
            self.marina, '2026-06-01', '2026-06-05', boat_draft=2.0,
        )
        ids = [b.id for b in result]
        self.assertIn(self.b_large.id, ids)
        self.assertIn(self.b_small.id, ids)  # NULL max_draft_m = unconstrained, must pass

    def test_maintenance_berth_excluded(self):
        self.b_large.status = 'maintenance'
        self.b_large.save()
        result = compatible_available_berths(
            self.marina, '2026-06-01', '2026-06-05',
        )
        ids = [b.id for b in result]
        self.assertNotIn(self.b_large.id, ids)


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

    def test_boat_draft_wired_through(self):
        self.b1.max_draft_m = Decimal('1.0')
        self.b1.save()
        self.b2.max_draft_m = Decimal('3.0')
        self.b2.save()
        booking = run_tetris(
            marina=self.marina,
            check_in='2026-07-01',
            check_out='2026-07-04',
            boat_loa=12.0,
            boat_beam=4.0,
            boat_draft=2.5,
            guest_name='D. Drafter',
            guest_email='d@sea.com',
            guest_phone='',
        )
        self.assertEqual(booking.berth, self.b2)
        self.assertEqual(booking.boat_draft, Decimal('2.5'))

    def test_race_condition_falls_to_next_candidate(self):
        # b1 gets a booking ending the day before check_in → tight gap → ranked 1st
        Booking.objects.create(
            marina=self.marina, berth=self.b1,
            check_in='2026-06-28', check_out='2026-07-01',
            nights=3, status='confirmed',
        )
        # b2 has no nearby bookings → large gap score → ranked 2nd

        berth_1_id = self.b1.pk
        mock_sfu_qs = MagicMock()

        def sfu_get_side_effect(pk):
            if pk == berth_1_id:
                # Simulate a concurrent request committing a booking on b1 just before
                # our collision check runs — our subsequent .filter(...).exists() finds it.
                Booking.objects.create(
                    marina=self.marina, berth=self.b1,
                    check_in='2026-07-01', check_out='2026-07-05',
                    nights=4, status='pending_payment',
                )
            return Berth.objects.get(pk=pk)

        mock_sfu_qs.get.side_effect = sfu_get_side_effect

        with patch.object(Berth.objects, 'select_for_update', return_value=mock_sfu_qs):
            booking = run_tetris(
                marina=self.marina,
                check_in='2026-07-01',
                check_out='2026-07-05',
                boat_loa=12.0,
                boat_beam=4.0,
                boat_draft=None,
                guest_name='T. Racer',
                guest_email='',
                guest_phone='',
            )

        self.assertEqual(booking.berth, self.b2)
        self.assertEqual(booking.status, 'pending_payment')


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

    def test_boat_draft_filter(self):
        self.b.max_draft_m = Decimal('2.0')
        self.b.save()
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'check_in':   '2026-07-01',
            'check_out':  '2026-07-05',
            'boat_draft': '3.0',
        })
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertNotIn(self.b.id, ids)


class BookingEngineRequestEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.stripe_account_id = 'acct_test'
        self.marina.save()
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

    @patch('apps.billing.stripe_service._create_checkout_session', return_value='https://checkout.stripe.com/test')
    def test_mode_b_creates_pending_payment_booking(self, mock_checkout):
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
        self.assertEqual(resp.data['booking']['status'], 'pending_payment')
        self.assertIsNotNone(resp.data['booking']['berth'])
        self.assertIn('checkout_url', resp.data)

    def test_mode_b_returns_409_when_no_berth(self):
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

    @patch('apps.billing.stripe_service._create_checkout_session', return_value='https://checkout.stripe.com/test')
    def test_auto_tetris_sets_invoice_booking_fk(self, mock_checkout):
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in':   '2026-09-01',
            'check_out':  '2026-09-05',
            'boat_loa':   '12.0',
            'boat_beam':  '4.0',
            'guest_name': 'I. Boatman',
            'guest_email': 'i@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 201)
        booking_id = resp.data['booking']['id']
        from apps.billing.models import Invoice
        inv = Invoice.objects.get(source_type='berth_booking', source_id=str(booking_id))
        self.assertEqual(inv.booking_id, booking_id)


class AssignBerthEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.stripe_account_id = 'acct_test'
        self.marina.save()
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

    @patch('apps.billing.stripe_service._create_checkout_session', return_value='https://checkout.stripe.com/assign')
    @patch('apps.reservations.views.send_mail')
    def test_assign_berth_updates_status_and_creates_invoice(self, mock_mail, mock_checkout):
        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': self.berth.id,
        })
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'awaiting_payment')
        self.assertEqual(self.booking.berth, self.berth)
        from apps.billing.models import Invoice
        self.assertTrue(
            Invoice.objects.filter(source_type='berth_booking', source_id=str(self.booking.id)).exists()
        )
        self.assertTrue(mock_mail.called)

    @patch('apps.reservations.views.send_mail')
    def test_assign_berth_rejects_incompatible_berth(self, mock_mail):
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

    @patch('apps.billing.stripe_service._create_checkout_session', return_value='https://checkout.stripe.com/assign')
    @patch('apps.reservations.views.send_mail')
    def test_assign_berth_sets_invoice_booking_fk(self, mock_mail, mock_checkout):
        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': self.berth.id,
        })
        self.assertEqual(resp.status_code, 200)
        from apps.billing.models import Invoice
        inv = Invoice.objects.get(source_type='berth_booking', source_id=str(self.booking.id))
        self.assertEqual(inv.booking_id, self.booking.id)


class CheckoutFinalisesInvoiceTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=100)
        self.member = Member.objects.create(marina=self.marina, name='A. Smith')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member)
        self.booking = Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            booking_type='transient', check_in='2026-06-01', check_out='2026-06-04',
            nights=3, amount=300, status='checked_in',
        )
        # Create a draft invoice linked to the booking
        self.invoice = Invoice.objects.create(
            marina=self.marina, member=self.member,
            invoice_number='INV-TEST-0001',
            source_type='berth_booking', source_id=str(self.booking.id),
            status='draft',
        )
        InvoiceLineItem.objects.create(
            invoice=self.invoice, description='Berth fee', quantity=1, unit_price=300,
            total_price=300,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_checkout_patch_finalises_draft_invoice(self):
        resp = self.client.patch(f'/api/v1/bookings/{self.booking.id}/', {'status': 'checked_out'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'open')

    def test_checkout_does_not_error_when_no_invoice(self):
        # Delete the invoice — checkout should still succeed
        self.invoice.delete()
        resp = self.client.patch(f'/api/v1/bookings/{self.booking.id}/', {'status': 'checked_out'}, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_checkout_is_idempotent_when_invoice_already_open(self):
        self.invoice.status = 'open'
        self.invoice.save()
        resp = self.client.patch(f'/api/v1/bookings/{self.booking.id}/', {'status': 'checked_out'}, format='json')
        self.assertEqual(resp.status_code, 200)


# ── Email Helper Tests ───────────────────────────────────────────────────────

class BookingEmailsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.name = 'Sunport Marina'
        self.marina.save()
        self.berth = make_berth(self.marina)
        self.booking = Booking.objects.create(
            marina=self.marina,
            berth=None,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='pending_approval',
            booking_type='transient',
            guest_name='J. Sailor',
            guest_email='sailor@example.com',
            boat_loa=12.5,
            boat_beam=4.2,
            boat_draft=1.8,
        )

    @patch('apps.reservations.emails.send_mail')
    def test_boater_request_received(self, mock_send):
        send_booking_request_boater_email(self.booking)
        mock_send.assert_called_once()
        kwargs = mock_send.call_args.kwargs
        self.assertIn('Sunport Marina', kwargs['subject'])
        self.assertEqual(kwargs['recipient_list'], ['sailor@example.com'])

    @patch('apps.reservations.emails.send_mail')
    def test_manager_notification_sent_to_owners_and_managers(self, mock_send):
        User.objects.create_user(email='owner@m.com', password='x', marina=self.marina, role='owner')
        User.objects.create_user(email='mgr@m.com', password='x', marina=self.marina, role='manager')
        User.objects.create_user(email='staff@m.com', password='x', marina=self.marina, role='staff')
        send_booking_request_manager_email(self.booking)
        mock_send.assert_called_once()
        recipients = mock_send.call_args.kwargs['recipient_list']
        self.assertIn('owner@m.com', recipients)
        self.assertIn('mgr@m.com', recipients)
        self.assertNotIn('staff@m.com', recipients)

    @patch('apps.reservations.emails.send_mail')
    def test_approve_email_contains_checkout_url(self, mock_send):
        send_approve_email(self.booking, checkout_url='https://checkout.stripe.com/xyz')
        mock_send.assert_called_once()
        kwargs = mock_send.call_args.kwargs
        message = kwargs['message']
        self.assertIn('https://checkout.stripe.com/xyz', message)
        self.assertEqual(kwargs['recipient_list'], ['sailor@example.com'])

    @patch('apps.reservations.emails.send_mail')
    def test_reject_email_contains_reason(self, mock_send):
        send_reject_email(self.booking, reason='No space available.')
        mock_send.assert_called_once()
        kwargs = mock_send.call_args.kwargs
        message = kwargs['message']
        self.assertIn('No space available.', message)
        self.assertEqual(kwargs['recipient_list'], ['sailor@example.com'])

    @patch('apps.reservations.emails.send_mail')
    @patch('apps.reservations.emails.make_magic_url')
    def test_confirmed_email_contains_magic_link(self, mock_magic, mock_send):
        mock_magic.return_value = 'https://book.docksbase.com/sunport/portal?token=abc123'
        send_booking_confirmed_email(self.booking)
        mock_send.assert_called_once()
        kwargs = mock_send.call_args.kwargs
        message = kwargs['message']
        self.assertIn('abc123', message)
        mock_magic.assert_called_once_with(self.booking)


class ApproveBookingViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.berth = make_berth(self.marina, price=100)
        self.berth.length_m = 15
        self.berth.max_beam_m = 5
        self.berth.max_draft_m = 2
        self.berth.save()
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            nights=7,
            status='pending_approval',
            booking_type='transient',
            guest_name='J. Sailor',
            guest_email='sailor@example.com',
            boat_loa=12.5,
            boat_beam=4.2,
            boat_draft=1.8,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/bookings/{self.booking.pk}/approve/'

    @patch('apps.reservations.views.send_approve_email')
    @patch('apps.billing.service.create_stripe_checkout_session', return_value='https://stripe.com/pay/xyz')
    def test_approve_assigns_berth_and_returns_checkout_url(self, mock_stripe, mock_email):
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('checkout_url', resp.data)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'awaiting_payment')
        self.assertEqual(self.booking.berth, self.berth)
        self.assertIsNotNone(self.booking.amount)
        mock_email.assert_called_once()

    @patch('apps.reservations.views.send_approve_email')
    @patch('apps.billing.service.create_stripe_checkout_session', return_value='https://stripe.com/pay/xyz')
    def test_approve_sets_invoice_booking_fk(self, mock_stripe, mock_email):
        self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        invoice = Invoice.objects.get(source_type='berth_booking', source_id=str(self.booking.pk))
        self.assertEqual(invoice.booking_id, self.booking.pk)

    @patch('apps.reservations.views.send_approve_email')
    @patch('apps.billing.service.create_stripe_checkout_session', return_value='https://stripe.com/pay/xyz')
    def test_approve_includes_booking_fee_in_amount(self, mock_stripe, mock_email):
        ChargeableItem.objects.create(
            marina=self.marina, name='Harbour Dues', category='booking_fee',
            pricing_model='flat_fee', unit_price='30.00',
            tax_category=_default_tax(self.marina),
        )
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        expected = 100 * 7 + 30  # berth_cost + harbour_dues
        self.assertEqual(float(self.booking.amount), expected)

    def test_approve_returns_409_on_berth_collision(self):
        # Create a conflicting booking on the same berth
        Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            check_in=datetime.date(2026, 7, 18),
            check_out=datetime.date(2026, 7, 25),
            status='confirmed',
            booking_type='transient',
        )
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 409)
        # Booking must not have changed
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'pending_approval')
        self.assertIsNone(self.booking.berth)

    def test_approve_returns_400_if_not_pending_approval(self):
        self.booking.status = 'awaiting_payment'
        self.booking.save()
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_approve_returns_400_if_berth_from_different_marina(self):
        other_marina = Marina.objects.create(name='Other Marina')
        other_berth = make_berth(other_marina)
        resp = self.client.post(self.url, {'berth_id': other_berth.pk}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_approve_requires_authentication(self):
        self.client.force_authenticate(user=None)
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertIn(resp.status_code, [401, 403])


class RejectBookingViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='pending_approval',
            booking_type='transient',
            guest_name='J. Sailor',
            guest_email='sailor@example.com',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/bookings/{self.booking.pk}/reject/'

    @patch('apps.reservations.views.send_reject_email')
    def test_reject_sets_cancelled_status(self, mock_email):
        resp = self.client.post(self.url, {'reason': 'No space available.'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'cancelled')
        mock_email.assert_called_once_with(self.booking, reason='No space available.')

    @patch('apps.reservations.views.send_reject_email')
    def test_reject_returns_400_if_not_pending_approval(self, mock_email):
        self.booking.status = 'confirmed'
        self.booking.save()
        resp = self.client.post(self.url, {'reason': 'No space.'}, format='json')
        self.assertEqual(resp.status_code, 400)
        mock_email.assert_not_called()


class BerthCapableForTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        pier = Pier.objects.create(marina=self.marina, code='P', label='Pier P')
        tier = ChargeableItem.objects.create(
            marina=self.marina, name='Berth Night', category='berth',
            pricing_model='per_night', unit_price=80,
            tax_category=_default_tax(self.marina),
        )
        self.big_berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='B1', pricing_tier=tier,
            length_m=20, max_beam_m=6, max_draft_m=3, status='available',
        )
        self.small_berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='B2', pricing_tier=tier,
            length_m=8, max_beam_m=3, max_draft_m=1, status='available',
        )
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='pending_approval',
            booking_type='transient',
            boat_loa=12.5,
            boat_beam=4.2,
            boat_draft=1.8,
        )

    def test_capable_for_returns_only_fitting_berths(self):
        resp = self.client.get(f'/api/v1/berths/?capable_for={self.booking.pk}')
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data['results']]
        self.assertIn(self.big_berth.pk, ids)
        self.assertNotIn(self.small_berth.pk, ids)

    def test_capable_for_unknown_booking_returns_400(self):
        resp = self.client.get('/api/v1/berths/?capable_for=99999')
        self.assertEqual(resp.status_code, 400)

    def test_without_capable_for_returns_all_berths(self):
        resp = self.client.get('/api/v1/berths/')
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data['results']]
        self.assertIn(self.big_berth.pk, ids)
        self.assertIn(self.small_berth.pk, ids)

    def test_capable_for_cross_marina_booking_returns_400(self):
        other_marina = Marina.objects.create(name='Other Marina')
        other_booking = Booking.objects.create(
            marina=other_marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='pending_approval',
            booking_type='transient',
            boat_loa=12.5,
        )
        resp = self.client.get(f'/api/v1/berths/?capable_for={other_booking.pk}')
        self.assertEqual(resp.status_code, 400)

    def test_capable_for_non_integer_returns_400(self):
        resp = self.client.get('/api/v1/berths/?capable_for=abc')
        self.assertEqual(resp.status_code, 400)


class FindDateAlternativesTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        self.berth = make_berth_with_dims(self.marina, 'ALT1', loa=20.0, beam=6.0, price=90)
        self.berth2 = make_berth_with_dims(self.marina, 'ALT2', loa=20.0, beam=6.0, price=90)
        self.check_in = datetime.date.today() + datetime.timedelta(days=60)
        self.check_out = self.check_in + datetime.timedelta(days=3)

    def _block(self, check_in, check_out, berth=None):
        """Book a berth (defaults to self.berth) for a date range."""
        if berth is None:
            berth = self.berth
        Booking.objects.create(
            marina=self.marina,
            berth=berth,
            check_in=check_in,
            check_out=check_out,
            nights=(check_out - check_in).days,
            amount=Decimal('270'),
            status='confirmed',
            booking_type='transient',
        )

    def _block_all(self, check_in, check_out):
        """Book BOTH berths for a date range, making those dates truly unavailable."""
        self._block(check_in, check_out, berth=self.berth)
        self._block(check_in, check_out, berth=self.berth2)

    def test_shift_window_finds_alternative(self):
        self._block(self.check_in, self.check_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        result_pairs = [(r['check_in'], r['check_out']) for r in results]
        shifted = (self.check_in + datetime.timedelta(days=1), self.check_out + datetime.timedelta(days=1))
        self.assertIn(shifted, result_pairs)

    def test_duration_variant_finds_alternative(self):
        self._block(self.check_in, self.check_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        result_pairs = [(r['check_in'], r['check_out']) for r in results]
        extended = (self.check_in, self.check_out + datetime.timedelta(days=1))
        self.assertIn(extended, result_pairs)

    def test_returns_empty_when_truly_no_availability(self):
        big_block_in = self.check_in - datetime.timedelta(days=5)
        big_block_out = self.check_out + datetime.timedelta(days=5)
        # Block both berths over a wide window so every alternative is also unavailable
        self._block_all(big_block_in, big_block_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        self.assertEqual(results, [])

    def test_capped_at_max_results(self):
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
            max_results=4,
        )
        self.assertEqual(len(results), 4)

    def test_sorted_by_proximity(self):
        self._block(self.check_in, self.check_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        if len(results) >= 2:
            first_distance = abs((results[0]['check_in'] - self.check_in).days) + abs(results[0]['nights'] - 3)
            second_distance = abs((results[1]['check_in'] - self.check_in).days) + abs(results[1]['nights'] - 3)
            self.assertLessEqual(first_distance, second_distance)

    def test_past_dates_excluded(self):
        near_future_in = datetime.date.today() + datetime.timedelta(days=1)
        near_future_out = near_future_in + datetime.timedelta(days=3)
        self._block(near_future_in, near_future_out)
        results = find_date_alternatives(
            self.marina, near_future_in, near_future_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        for r in results:
            self.assertGreaterEqual(r['check_in'], timezone.localdate())


import pytest
import datetime as _dt
from decimal import Decimal as _Decimal


@pytest.fixture
def marina_factory():
    def _make(**kwargs):
        return Marina.objects.create(name=kwargs.get('name', 'Test Marina'))
    return _make


@pytest.fixture
def berth_factory():
    def _make(marina, code=None, price=100):
        import random
        from apps.billing.models import TaxRate
        _code = code or f'B{random.randint(10, 9999)}'
        pier, _ = Pier.objects.get_or_create(
            marina=marina, code='P', defaults={'label': 'Pytest Pier'}
        )
        tax_rate, _ = TaxRate.objects.get_or_create(
            marina=marina, name='VAT', defaults={'rate': '0.00'}
        )
        tier = ChargeableItem.objects.create(
            marina=marina, name='Berth Night', category='berth',
            pricing_model='per_night', unit_price=price,
            tax_category=tax_rate,
        )
        return Berth.objects.create(
            marina=marina, pier=pier, code=_code, pricing_tier=tier, status='available'
        )
    return _make


@pytest.mark.django_db
class TestInvoiceReservationFK:
    def test_invoice_reservation_field_exists(self, marina_factory, berth_factory):
        from apps.billing.models import Invoice
        from apps.reservations.models import Reservation
        from decimal import Decimal

        marina = marina_factory()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Invoice Test',
            guest_email='inv@test.com',
            status='confirmed',
            total_price=Decimal('150.00'),
        )
        inv = Invoice.objects.create(
            marina=marina,
            invoice_number='INV-2026-9999',
            status='draft',
            reservation=res,
        )
        assert Invoice.objects.get(pk=inv.pk).reservation_id == res.pk


@pytest.mark.django_db
class TestReservationModel:
    def test_reservation_str(self, marina_factory):
        from apps.reservations.models import Reservation
        marina = marina_factory()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Alice',
            guest_email='alice@test.com',
            status='confirmed',
            total_price=_Decimal('200.00'),
        )
        assert 'RES-' in str(res)
        assert 'Alice' in str(res)

    def test_reservation_item_str(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = _dt.date.today()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Bob',
            guest_email='bob@test.com',
            status='confirmed',
            total_price=_Decimal('100.00'),
        )
        item = ReservationItem.objects.create(
            reservation=res,
            berth=berth,
            check_in=today,
            check_out=today + _dt.timedelta(days=2),
            nights=2,
            item_price=_Decimal('100.00'),
        )
        assert berth.code in str(item)

    def test_reservation_total_price_sum_of_items(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        marina = marina_factory()
        berth1 = berth_factory(marina=marina)
        berth2 = berth_factory(marina=marina)
        today = _dt.date.today()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Fleet Owner',
            guest_email='fleet@test.com',
            status='confirmed',
            total_price=_Decimal('0.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth1,
            check_in=today, check_out=today + _dt.timedelta(days=2),
            nights=2, item_price=_Decimal('150.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth2,
            check_in=today, check_out=today + _dt.timedelta(days=2),
            nights=2, item_price=_Decimal('90.00'),
        )
        total = sum(i.item_price for i in res.items.all())
        assert total == _Decimal('240.00')


@pytest.mark.django_db
class TestBackfillMigration:
    def test_every_booking_gets_reservation(self, marina_factory, berth_factory):
        from apps.reservations.models import Booking, Reservation, ReservationItem
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        b = Booking.objects.create(
            marina=marina,
            berth=berth,
            check_in=today,
            check_out=today + datetime.timedelta(days=3),
            nights=3,
            guest_name='Test Guest',
            guest_email='test@test.com',
            amount=Decimal('300.00'),
            status='confirmed',
            booking_source='portal',
            boat_loa=Decimal('12.00'),
        )

        # Run the backfill function directly (same logic as the migration)
        from apps.reservations.migrations._backfill_helpers import backfill_booking
        backfill_booking(b)

        res = Reservation.objects.get(legacy_booking=b)
        res.refresh_from_db()
        assert res.marina_id == marina.pk
        assert res.guest_email == 'test@test.com'
        assert res.total_price == Decimal('300.00')
        assert res.status == 'confirmed'
        assert res.booking_source == 'portal'
        assert res.created_at.date() == b.created_at.date()

        item = res.items.get()
        assert item.berth_id == berth.pk
        assert item.check_in == today
        assert item.nights == 3
        assert item.item_price == Decimal('300.00')
        assert item.boat_loa == Decimal('12.00')

    def test_backfill_is_idempotent(self, marina_factory, berth_factory):
        from apps.reservations.models import Booking, Reservation
        from apps.reservations.migrations._backfill_helpers import backfill_booking
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        b = Booking.objects.create(
            marina=marina, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=1),
            nights=1, guest_name='Repeat', guest_email='r@test.com',
            amount=Decimal('100.00'), status='confirmed',
        )
        backfill_booking(b)
        backfill_booking(b)  # second call must not create duplicates
        assert Reservation.objects.filter(legacy_booking=b).count() == 1


@pytest.fixture
def api_client_factory():
    from rest_framework.test import APIClient
    from apps.accounts.models import User

    def factory(marina):
        client = APIClient()
        user = User.objects.create_user(
            email=f'staff_{marina.slug}@test.com',
            password='testpass',
            marina=marina,
            role='manager',
        )
        client.force_authenticate(user=user)
        return client

    return factory


@pytest.mark.django_db
class TestReservationAPI:
    def test_list_reservations(self, api_client_factory, marina_factory, berth_factory):
        """Staff can list reservations for their marina."""
        from apps.reservations.models import Reservation
        from decimal import Decimal

        marina = marina_factory()
        client = api_client_factory(marina=marina)

        Reservation.objects.create(
            marina=marina, guest_name='API Guest',
            guest_email='api@test.com', status='confirmed',
            total_price=Decimal('100.00'),
        )
        resp = client.get(
            '/api/v1/reservations/',
            HTTP_X_MARINA_SLUG=marina.slug,
        )
        assert resp.status_code == 200
        assert len(resp.data) == 1
        assert resp.data[0]['guest_email'] == 'api@test.com'

    def test_reservation_detail_includes_items(self, api_client_factory, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from decimal import Decimal
        import datetime

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()
        client = api_client_factory(marina=marina)

        res = Reservation.objects.create(
            marina=marina, guest_name='Detail Test',
            guest_email='detail@test.com', status='confirmed',
            total_price=Decimal('150.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=3),
            nights=3, item_price=Decimal('150.00'),
        )
        resp = client.get(
            f'/api/v1/reservations/{res.pk}/',
            HTTP_X_MARINA_SLUG=marina.slug,
        )
        assert resp.status_code == 200
        assert len(resp.data['items']) == 1
        assert resp.data['items'][0]['nights'] == 3


@pytest.mark.django_db
class TestReservationSerializer:
    def test_serializer_output(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from apps.reservations.serializers import ReservationSerializer
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        res = Reservation.objects.create(
            marina=marina,
            guest_name='Serializer Test',
            guest_email='ser@test.com',
            status='confirmed',
            total_price=Decimal('200.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=2),
            nights=2, item_price=Decimal('200.00'),
        )
        data = ReservationSerializer(res).data
        assert data['id'] == res.pk
        assert data['guest_email'] == 'ser@test.com'
        assert data['status'] == 'confirmed'
        assert len(data['items']) == 1
        assert data['items'][0]['berth_code'] is not None


@pytest.fixture
def chargeable_item_factory():
    def factory(marina, category='berth', pricing_model='per_night', unit_price=None):
        from apps.billing.models import ChargeableItem, TaxRate
        from decimal import Decimal
        tax_rate, _ = TaxRate.objects.get_or_create(
            marina=marina, name='Standard — 20.00%',
            defaults={'rate': Decimal('20.00'), 'is_default': True},
        )
        return ChargeableItem.objects.create(
            marina=marina,
            name='Berth Fee',
            category=category,
            pricing_model=pricing_model,
            unit_price=unit_price or Decimal('50.00'),
            is_active=True,
            tax_category=tax_rate,
        )
    return factory


@pytest.mark.django_db
class TestCalculateReservationInvoice:
    def test_two_slips_produce_two_line_items(self, marina_factory, berth_factory, chargeable_item_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from apps.billing.service import calculate_reservation_invoice
        from apps.billing.models import Invoice, ChargeableItem
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth1 = berth_factory(marina=marina)
        berth2 = berth_factory(marina=marina)
        today = datetime.date.today()

        # Deactivate berth_factory catalog items so only our 50.00 item is active
        ChargeableItem.objects.filter(marina=marina).update(is_active=False)

        # A ChargeableItem must exist for the marina to price berths
        item = chargeable_item_factory(marina=marina, category='berth', pricing_model='per_night', unit_price=Decimal('50.00'))

        res = Reservation.objects.create(
            marina=marina, guest_name='Two Slips',
            guest_email='two@test.com', status='confirmed',
            total_price=Decimal('0.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth1,
            check_in=today, check_out=today + datetime.timedelta(days=2),
            nights=2, item_price=Decimal('100.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth2,
            check_in=today, check_out=today + datetime.timedelta(days=3),
            nights=3, item_price=Decimal('150.00'),
        )

        invoice = calculate_reservation_invoice(res)
        assert invoice is not None
        assert invoice.reservation_id == res.pk
        assert invoice.items.count() == 2

        totals = sorted(str(i.total_price) for i in invoice.items.all())
        assert totals == ['100.00', '150.00']

    def test_returns_none_when_no_chargeable_item(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from apps.billing.service import calculate_reservation_invoice
        from apps.billing.models import ChargeableItem
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        # Deactivate all catalog items so the function has nothing to price with
        ChargeableItem.objects.filter(marina=marina).update(is_active=False)

        res = Reservation.objects.create(
            marina=marina, guest_name='No Catalog',
            guest_email='nc@test.com', status='confirmed',
            total_price=Decimal('100.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=1),
            nights=1, item_price=Decimal('100.00'),
        )

        invoice = calculate_reservation_invoice(res)
        assert invoice is None


class TestReservationCheckoutFields:
    @pytest.mark.django_db
    def test_pending_checkout_status_is_valid_choice(self):
        from apps.reservations.models import Reservation
        choices = [c[0] for c in Reservation.STATUS_CHOICES]
        assert 'pending_checkout' in choices
        assert 'abandoned' in choices

    @pytest.mark.django_db
    def test_locked_until_field_exists(self):
        from apps.reservations.models import Reservation
        assert hasattr(Reservation, 'locked_until')

    @pytest.mark.django_db
    def test_reservation_item_status_field_exists_and_defaults_confirmed(self):
        from apps.reservations.models import ReservationItem
        assert hasattr(ReservationItem, 'status')
        # Default is 'confirmed' — existing backfilled items remain valid
        field = ReservationItem._meta.get_field('status')
        assert field.default == 'confirmed'

    @pytest.mark.django_db
    def test_pending_review_status_is_valid_choice(self):
        from apps.reservations.models import Reservation
        choices = [c[0] for c in Reservation.STATUS_CHOICES]
        assert 'pending_review' in choices

    @pytest.mark.django_db
    def test_unassigned_item_status_is_valid_choice(self):
        from apps.reservations.models import ReservationItem
        field = ReservationItem._meta.get_field('status')
        valid = [c[0] for c in field.choices]
        assert 'unassigned' in valid


# ── Fixtures for assign_berth tests ─────────────────────────────────────────

@pytest.fixture
def ab_marina():
    from apps.accounts.models import Marina
    return Marina.objects.create(name='AB Marina', slug='ab-marina', booking_mode='auto_tetris')

@pytest.fixture
def ab_tax_rate(ab_marina):
    from apps.billing.models import TaxRate
    return TaxRate.objects.create(marina=ab_marina, name='Zero', rate=Decimal('0.00'))

@pytest.fixture
def ab_tier(ab_marina, ab_tax_rate):
    from apps.billing.models import ChargeableItem
    return ChargeableItem.objects.create(
        marina=ab_marina, name='Berth', category='berth',
        pricing_model='per_night', unit_price=Decimal('100.00'),
        tax_category=ab_tax_rate, is_active=True,
    )

@pytest.fixture
def ab_berth(ab_marina, ab_tier):
    from apps.berths.models import Berth
    return Berth.objects.create(
        marina=ab_marina, code='AB1',
        length_m=Decimal('15.00'), max_beam_m=Decimal('5.00'),
        pricing_tier=ab_tier,
    )


class TestAssignBerth:
    @pytest.mark.django_db(transaction=True)
    def test_returns_berth_and_price(self, ab_marina, ab_berth):
        from django.db import transaction
        from apps.reservations.booking_engine import assign_berth
        ci = datetime.date(2027, 7, 1)
        co = datetime.date(2027, 7, 4)  # 3 nights
        with transaction.atomic():
            berth, price = assign_berth(ab_marina, ci, co, boat_loa=12.0)
        assert berth.pk == ab_berth.pk
        assert price == Decimal('300.00')  # 100/night × 3 nights

    @pytest.mark.django_db(transaction=True)
    def test_raises_when_berth_too_small(self, ab_marina, ab_berth):
        from django.db import transaction
        from apps.reservations.booking_engine import assign_berth, NoAvailableBerthError
        ci = datetime.date(2027, 8, 1)
        co = datetime.date(2027, 8, 4)
        with transaction.atomic():
            with pytest.raises(NoAvailableBerthError):
                assign_berth(ab_marina, ci, co, boat_loa=99.0)  # boat too big

    @pytest.mark.django_db(transaction=True)
    def test_skips_berth_already_locked_by_reservation_item(self, ab_marina, ab_berth):
        from django.db import transaction
        from apps.reservations.models import Reservation, ReservationItem
        from apps.reservations.booking_engine import assign_berth, NoAvailableBerthError
        ci = datetime.date(2027, 9, 1)
        co = datetime.date(2027, 9, 4)
        res = Reservation.objects.create(marina=ab_marina, status='pending_checkout')
        ReservationItem.objects.create(
            reservation=res, berth=ab_berth,
            check_in=ci, check_out=co, nights=3, status='locked',
        )
        with transaction.atomic():
            with pytest.raises(NoAvailableBerthError):
                assign_berth(ab_marina, ci, co, boat_loa=12.0)


class TestSendReservationConfirmedEmail:
    @pytest.mark.django_db
    def test_sends_to_guest_email_with_reference(self, ab_marina, ab_berth):
        from django.core import mail
        from apps.reservations.models import Reservation, ReservationItem
        from apps.reservations.emails import send_reservation_confirmed_email

        res = Reservation.objects.create(
            marina=ab_marina,
            guest_name='Test Sailor',
            guest_email='sailor@test.com',
            status='confirmed',
            paid=True,
            total_price=Decimal('300.00'),
        )
        ReservationItem.objects.create(
            reservation=res,
            berth=ab_berth,
            check_in=datetime.date(2027, 7, 1),
            check_out=datetime.date(2027, 7, 4),
            nights=3,
            status='confirmed',
        )

        send_reservation_confirmed_email(res)

        assert len(mail.outbox) == 1
        msg = mail.outbox[0]
        assert msg.to == ['sailor@test.com']
        assert f'RES-{res.pk}' in msg.body


def _make_intent_marina(slug='intent-marina'):
    from apps.accounts.models import Marina
    from apps.billing.models import TaxRate, ChargeableItem
    from apps.berths.models import Berth
    marina = Marina.objects.create(
        name='Intent Marina', slug=slug,
        booking_mode='auto_tetris',
    )
    tax = TaxRate.objects.create(marina=marina, name='Zero', rate=Decimal('0.00'))
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth', category='berth',
        pricing_model='per_night', unit_price=Decimal('100.00'),
        tax_category=tax, is_active=True,
    )
    berth = Berth.objects.create(
        marina=marina, code='I01',
        length_m=Decimal('15.00'), max_beam_m=Decimal('5.00'),
        pricing_tier=tier,
    )
    return marina, berth


class TestReservationIntentView:
    BASE_URL = '/api/v1/public/reservations/intent/'

    @pytest.mark.django_db(transaction=True)
    def test_intent_creates_reservation_and_items(self):
        from unittest.mock import patch
        from apps.reservations.models import Reservation, ReservationItem
        from django.test import Client

        marina, berth = _make_intent_marina('intent-a')
        client = Client()

        with patch('apps.billing.service.create_payment_intent', return_value='pi_test_secret_xyz'):
            resp = client.post(
                self.BASE_URL,
                data={
                    'check_in': '2027-07-01',
                    'check_out': '2027-07-04',
                    'guest_name': 'John Smith',
                    'guest_email': 'john@test.com',
                    'items': [
                        {'boat_loa': '12.5', 'vessel_name': 'Sea Breeze'},
                    ],
                },
                content_type='application/json',
                HTTP_X_MARINA_SLUG='intent-a',
            )

        assert resp.status_code == 201, resp.json()
        data = resp.json()
        assert 'reservation_id' in data
        assert data['client_secret'] == 'pi_test_secret_xyz'
        assert data['total'] == '300.00'
        assert len(data['items']) == 1

        res = Reservation.objects.get(pk=data['reservation_id'])
        assert res.status == 'pending_checkout'
        assert res.locked_until is not None
        assert res.total_price == Decimal('300.00')

        items = list(ReservationItem.objects.filter(reservation=res))
        assert len(items) == 1
        assert items[0].status == 'locked'
        assert items[0].berth_id == berth.pk

    @pytest.mark.django_db(transaction=True)
    def test_intent_returns_409_when_no_berth_available(self):
        from unittest.mock import patch
        from django.test import Client

        marina, _ = _make_intent_marina('intent-b')
        client = Client()

        with patch('apps.billing.service.create_payment_intent', return_value='pi_x'):
            resp = client.post(
                self.BASE_URL,
                data={
                    'check_in': '2027-08-01',
                    'check_out': '2027-08-04',
                    'guest_name': 'Jane Doe',
                    'guest_email': 'jane@test.com',
                    'items': [
                        {'boat_loa': '99.0'},  # too big for any berth
                    ],
                },
                content_type='application/json',
                HTTP_X_MARINA_SLUG='intent-b',
            )

        assert resp.status_code == 409

    @pytest.mark.django_db(transaction=True)
    def test_intent_rolls_back_all_items_if_one_fails(self):
        from unittest.mock import patch
        from apps.reservations.models import Reservation
        from django.test import Client

        marina, _ = _make_intent_marina('intent-c')
        client = Client()

        before = Reservation.objects.count()
        with patch('apps.billing.service.create_payment_intent', return_value='pi_x'):
            resp = client.post(
                self.BASE_URL,
                data={
                    'check_in': '2027-09-01',
                    'check_out': '2027-09-04',
                    'guest_name': 'Bob',
                    'guest_email': 'bob@test.com',
                    'items': [
                        {'boat_loa': '12.5'},
                        {'boat_loa': '99.0'},  # second item fails → whole cart rolls back
                    ],
                },
                content_type='application/json',
                HTTP_X_MARINA_SLUG='intent-c',
            )

        assert resp.status_code == 409
        assert Reservation.objects.count() == before  # no partial records left

    @pytest.mark.django_db
    def test_intent_manual_marina_returns_pending_review(self):
        from apps.accounts.models import Marina
        from apps.billing.service import seed_default_tax_rates
        from django.test import Client
        marina = Marina.objects.create(
            name='Manual Marina', slug='intent-manual',
            booking_mode='manual',
        )
        seed_default_tax_rates(marina)
        client = Client()
        resp = client.post(
            self.BASE_URL,
            data={
                'check_in': '2027-10-01', 'check_out': '2027-10-04',
                'guest_name': 'X', 'guest_email': 'x@test.com',
                'items': [{'boat_loa': '10.0'}],
            },
            content_type='application/json',
            HTTP_X_MARINA_SLUG='intent-manual',
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data['requires_payment'] is False
        assert data['status'] == 'pending_review'


def _make_pending_reservation(marina):
    from apps.billing.models import TaxRate, ChargeableItem
    from apps.berths.models import Berth
    from apps.reservations.models import Reservation, ReservationItem
    tax = TaxRate.objects.create(marina=marina, name='ZeroC', rate=Decimal('0.00'))
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth', category='berth',
        pricing_model='per_night', unit_price=Decimal('100.00'),
        tax_category=tax, is_active=True,
    )
    berth = Berth.objects.create(
        marina=marina, code='C01',
        length_m=Decimal('15.00'),
        pricing_tier=tier,
    )
    res = Reservation.objects.create(
        marina=marina,
        guest_name='Confirm Sailor',
        guest_email='confirm@test.com',
        status='pending_checkout',
        stripe_payment_intent_id='pi_test123',
        total_price=Decimal('300.00'),
    )
    ReservationItem.objects.create(
        reservation=res, berth=berth,
        check_in=datetime.date(2027, 7, 1),
        check_out=datetime.date(2027, 7, 4),
        nights=3, status='locked',
    )
    return res


class TestReservationConfirmView:
    BASE_URL = '/api/v1/public/reservations/confirm/'

    @pytest.mark.django_db
    def test_confirm_success_flips_status_and_sends_email(self):
        from unittest.mock import patch, MagicMock
        from django.test import Client
        from apps.accounts.models import Marina
        from apps.reservations.models import ReservationItem

        marina = Marina.objects.create(
            name='Conf Marina', slug='conf-a',
            booking_mode='auto_tetris', stripe_account_id='acct_test',
        )
        res = _make_pending_reservation(marina)
        client = Client()

        mock_pi = MagicMock()
        mock_pi.status = 'succeeded'

        with patch('apps.reservations.public_reservation_views.stripe') as mock_stripe, \
             patch('apps.reservations.public_reservation_views.send_reservation_confirmed_email') as mock_email:
            mock_stripe.PaymentIntent.retrieve.return_value = mock_pi
            resp = client.post(
                self.BASE_URL,
                data={'reservation_id': res.pk, 'payment_intent_id': 'pi_test123'},
                content_type='application/json',
                HTTP_X_MARINA_SLUG='conf-a',
            )

        assert resp.status_code == 200, resp.json()
        data = resp.json()
        assert data['status'] == 'confirmed'
        assert data['reference'] == f'RES-{res.pk}'

        res.refresh_from_db()
        assert res.status == 'confirmed'
        assert res.paid is True
        assert ReservationItem.objects.filter(reservation=res, status='confirmed').count() == 1
        mock_email.assert_called_once_with(res)

    @pytest.mark.django_db
    def test_confirm_idempotent_if_already_confirmed(self):
        from unittest.mock import patch, MagicMock
        from django.test import Client
        from apps.accounts.models import Marina
        from apps.reservations.models import Reservation

        marina = Marina.objects.create(
            name='Conf Marina 2', slug='conf-b', stripe_account_id='acct_test',
        )
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Already Done',
            guest_email='done@test.com',
            status='confirmed',
            stripe_payment_intent_id='pi_already',
            total_price=Decimal('100.00'),
            paid=True,
        )
        client = Client()
        mock_pi = MagicMock()
        mock_pi.status = 'succeeded'

        with patch('apps.reservations.public_reservation_views.stripe') as mock_stripe, \
             patch('apps.reservations.public_reservation_views.send_reservation_confirmed_email') as mock_email:
            mock_stripe.PaymentIntent.retrieve.return_value = mock_pi
            resp = client.post(
                self.BASE_URL,
                data={'reservation_id': res.pk, 'payment_intent_id': 'pi_already'},
                content_type='application/json',
                HTTP_X_MARINA_SLUG='conf-b',
            )

        assert resp.status_code == 200
        mock_email.assert_not_called()  # no duplicate email

    @pytest.mark.django_db
    def test_confirm_returns_409_for_abandoned_reservation(self):
        from django.test import Client
        from apps.accounts.models import Marina
        from apps.reservations.models import Reservation

        marina = Marina.objects.create(name='Conf Marina 3', slug='conf-c')
        res = Reservation.objects.create(
            marina=marina, guest_email='gone@test.com',
            status='abandoned', stripe_payment_intent_id='pi_gone',
            total_price=Decimal('100.00'),
        )
        client = Client()
        resp = client.post(
            self.BASE_URL,
            data={'reservation_id': res.pk, 'payment_intent_id': 'pi_gone'},
            content_type='application/json',
            HTTP_X_MARINA_SLUG='conf-c',
        )
        assert resp.status_code == 409

    @pytest.mark.django_db
    def test_confirm_returns_402_when_payment_not_yet_succeeded(self):
        from unittest.mock import patch, MagicMock
        from django.test import Client
        from apps.accounts.models import Marina

        marina = Marina.objects.create(
            name='Conf Marina 4', slug='conf-d', stripe_account_id='acct_test',
        )
        res = _make_pending_reservation(marina)
        client = Client()
        mock_pi = MagicMock()
        mock_pi.status = 'requires_payment_method'

        with patch('apps.reservations.public_reservation_views.stripe') as mock_stripe:
            mock_stripe.PaymentIntent.retrieve.return_value = mock_pi
            resp = client.post(
                self.BASE_URL,
                data={'reservation_id': res.pk, 'payment_intent_id': 'pi_test123'},
                content_type='application/json',
                HTTP_X_MARINA_SLUG='conf-d',
            )
        assert resp.status_code == 402


class TestReservationIntentManualMarina:
    BASE_URL = '/api/v1/public/reservations/intent/'

    @pytest.mark.django_db
    def test_manual_marina_returns_requires_payment_false(self):
        from apps.accounts.models import Marina
        from apps.billing.service import seed_default_tax_rates
        from apps.reservations.models import Reservation

        marina = Marina.objects.create(
            name='Manual Marina', slug='manual-m', booking_mode='manual',
        )
        seed_default_tax_rates(marina)

        client = APIClient()
        resp = client.post(
            self.BASE_URL,
            data={
                'check_in': '2028-06-01',
                'check_out': '2028-06-04',
                'guest_name': 'Manual Guest',
                'guest_email': 'manual@test.com',
                'items': [{'boat_loa': '12.0'}],
            },
            format='json',
            headers={'X-Marina-Slug': 'manual-m'},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data['requires_payment'] is False
        assert 'reservation_id' in data
        assert data['reference'].startswith('RES-')
        assert 'client_secret' not in data

    @pytest.mark.django_db
    def test_manual_marina_creates_pending_review_reservation(self):
        from apps.accounts.models import Marina
        from apps.billing.service import seed_default_tax_rates
        from apps.reservations.models import Reservation, ReservationItem

        marina = Marina.objects.create(
            name='Manual Marina 2', slug='manual-m2', booking_mode='manual',
        )
        seed_default_tax_rates(marina)

        client = APIClient()
        resp = client.post(
            self.BASE_URL,
            data={
                'check_in': '2028-07-01',
                'check_out': '2028-07-03',
                'guest_name': 'Request Guest',
                'guest_email': 'req@test.com',
                'items': [
                    {'boat_loa': '10.0', 'vessel_name': 'My Yacht'},
                    {'boat_loa': '5.0',  'vessel_name': 'Tender'},
                ],
            },
            format='json',
            headers={'X-Marina-Slug': 'manual-m2'},
        )
        assert resp.status_code == 201
        res_id = resp.json()['reservation_id']
        res = Reservation.objects.get(pk=res_id)
        assert res.status == 'pending_review'
        assert res.paid is False
        items = ReservationItem.objects.filter(reservation=res)
        assert items.count() == 2
        assert all(i.status == 'unassigned' for i in items)
        assert all(i.berth_id is None for i in items)

    @pytest.mark.django_db
    def test_manual_marina_empty_items_rejected(self):
        """Serializer should reject empty items list (min_length=1)"""
        from apps.accounts.models import Marina
        from apps.billing.service import seed_default_tax_rates

        marina = Marina.objects.create(
            name='Manual Marina', slug='manual-empty',
            booking_mode='manual',
        )
        seed_default_tax_rates(marina)

        client = APIClient()
        resp = client.post(
            self.BASE_URL,
            data={
                'check_in': '2028-06-01',
                'check_out': '2028-06-04',
                'guest_name': 'Test Guest',
                'guest_email': 'test@test.com',
                'items': [],  # Empty - should be rejected
            },
            format='json',
            headers={'X-Marina-Slug': 'manual-empty'},
        )
        assert resp.status_code == 400
        assert 'items' in resp.json()

    @pytest.mark.django_db
    def test_manual_marina_missing_guest_phone(self):
        """Missing guest_phone should default to empty string"""
        from apps.accounts.models import Marina
        from apps.billing.service import seed_default_tax_rates
        from apps.reservations.models import Reservation

        marina = Marina.objects.create(
            name='Manual Marina', slug='manual-nophone',
            booking_mode='manual',
        )
        seed_default_tax_rates(marina)

        client = APIClient()
        resp = client.post(
            self.BASE_URL,
            data={
                'check_in': '2028-06-01',
                'check_out': '2028-06-04',
                'guest_name': 'Test Guest',
                'guest_email': 'test@test.com',
                # No guest_phone field
                'items': [{'boat_loa': '10.0'}],
            },
            format='json',
            headers={'X-Marina-Slug': 'manual-nophone'},
        )
        assert resp.status_code == 201
        res_id = resp.json()['reservation_id']
        res = Reservation.objects.get(pk=res_id)
        assert res.guest_phone == ''  # Should default to empty string


class TestExpireReservationsCommand(TestCase):
    def _setup(self):
        from apps.billing.service import seed_default_tax_rates
        from apps.billing.models import TaxRate, ChargeableItem
        from apps.berths.models import Berth
        from apps.reservations.models import Reservation, ReservationItem

        marina = Marina.objects.create(name='Expire Marina', slug='expire-m')
        seed_default_tax_rates(marina)
        tax = TaxRate.objects.get(marina=marina, name='Zero Rated — 0.00%')
        tier = ChargeableItem.objects.create(
            marina=marina, name='Berth', category='berth',
            pricing_model='per_night', unit_price=50,
            tax_category=tax,
        )
        berth = Berth.objects.create(marina=marina, code='E1', pricing_tier=tier)
        return marina, berth

    def test_expired_reservation_becomes_abandoned(self):
        from apps.reservations.models import Reservation, ReservationItem
        from django.core.management import call_command

        marina, berth = self._setup()
        past = timezone.now() - datetime.timedelta(minutes=30)
        res = Reservation.objects.create(
            marina=marina,
            guest_email='ex@test.com',
            status='pending_checkout',
            locked_until=past,
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=datetime.date(2028, 1, 1),
            check_out=datetime.date(2028, 1, 4),
            nights=3, status='locked',
        )

        call_command('expire_reservations')

        res.refresh_from_db()
        self.assertEqual(res.status, 'abandoned')
        self.assertEqual(
            ReservationItem.objects.filter(reservation=res, status='released').count(), 1
        )

    def test_not_yet_expired_reservation_is_untouched(self):
        from apps.reservations.models import Reservation, ReservationItem
        from django.core.management import call_command

        marina, berth = self._setup()
        future = timezone.now() + datetime.timedelta(minutes=30)
        res = Reservation.objects.create(
            marina=marina,
            guest_email='future@test.com',
            status='pending_checkout',
            locked_until=future,
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=datetime.date(2028, 2, 1),
            check_out=datetime.date(2028, 2, 4),
            nights=3, status='locked',
        )

        call_command('expire_reservations')

        res.refresh_from_db()
        self.assertEqual(res.status, 'pending_checkout')
        self.assertEqual(
            ReservationItem.objects.filter(reservation=res, status='locked').count(), 1
        )

    def test_dry_run_does_not_mutate(self):
        from apps.reservations.models import Reservation, ReservationItem
        from django.core.management import call_command

        marina, berth = self._setup()
        past = timezone.now() - datetime.timedelta(minutes=30)
        res = Reservation.objects.create(
            marina=marina,
            guest_email='dry@test.com',
            status='pending_checkout',
            locked_until=past,
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=datetime.date(2028, 3, 1),
            check_out=datetime.date(2028, 3, 4),
            nights=3, status='locked',
        )

        call_command('expire_reservations', dry_run=True)

        res.refresh_from_db()
        self.assertEqual(res.status, 'pending_checkout')
        self.assertEqual(
            ReservationItem.objects.filter(reservation=res, status='locked').count(), 1
        )
