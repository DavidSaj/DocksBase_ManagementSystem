import datetime
from unittest.mock import patch
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.reservations.models import Booking
from apps.berths.models import Pier, Berth, BerthCategory
from apps.billing.models import ChargeableItem, Invoice


class PublicBookingCreateTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina', slug='test-marina', booking_mode='manual_approval')
        self.client = APIClient()
        self.url = '/api/v1/public/bookings/'
        today = datetime.date.today()
        self.payload = {
            'check_in': str(today + datetime.timedelta(days=30)),
            'check_out': str(today + datetime.timedelta(days=37)),
            'guest_name': 'J. Sailor',
            'guest_email': 'sailor@example.com',
            'boat_loa': 12.5,
            'boat_beam': 4.2,
            'boat_draft': 1.8,
        }

    def _post(self, payload=None, slug='test-marina'):
        return self.client.post(
            self.url,
            payload or self.payload,
            format='json',
            HTTP_X_MARINA_SLUG=slug,
        )

    @patch('apps.portal.public_booking_views.send_booking_request_boater_email')
    @patch('apps.portal.public_booking_views.send_booking_request_manager_email')
    def test_creates_pending_approval_booking(self, mock_mgr, mock_boater):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        booking = Booking.objects.get(pk=resp.data['booking_id'])
        self.assertEqual(booking.status, 'pending_approval')
        self.assertIsNone(booking.berth)
        self.assertEqual(booking.booking_type, 'transient')
        self.assertEqual(booking.marina, self.marina)
        mock_boater.assert_called_once_with(booking)
        mock_mgr.assert_called_once_with(booking)

    @patch('apps.portal.public_booking_views.send_booking_request_boater_email')
    @patch('apps.portal.public_booking_views.send_booking_request_manager_email')
    def test_returns_booking_id_and_message(self, mock_mgr, mock_boater):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        self.assertIn('booking_id', resp.data)
        self.assertIn('message', resp.data)

    def test_missing_field_returns_400(self):
        payload = {**self.payload}
        del payload['guest_email']
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('guest_email', resp.data)

    def test_check_in_not_before_check_out_returns_400(self):
        payload = {**self.payload, 'check_in': '2026-07-22', 'check_out': '2026-07-15'}
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)

    def test_unknown_marina_slug_returns_404(self):
        resp = self._post(slug='nonexistent-marina')
        self.assertEqual(resp.status_code, 404)

    def test_no_slug_header_returns_400_or_404(self):
        resp = self.client.post(self.url, self.payload, format='json')
        self.assertIn(resp.status_code, [400, 404])

    def test_check_in_in_past_returns_400(self):
        payload = {**self.payload, 'check_in': '2020-01-01', 'check_out': '2020-01-08'}
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)


def make_auto_marina():
    return Marina.objects.create(
        name='Auto Marina', slug='auto-marina', booking_mode='auto_tetris',
    )


def make_test_berth(marina, code='B1', loa=20.0, beam=6.0, price=90):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='P', defaults={'label': 'Pier'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Berth Night', category='berth',
        defaults={'pricing_model': 'per_night', 'unit_price': price},
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code,
        length_m=loa, max_beam_m=beam,
        pricing_tier=tier, status='available',
    )


class PublicAvailableBerthsTest(TestCase):
    def setUp(self):
        self.marina = make_auto_marina()
        self.berth = make_test_berth(self.marina)
        self.client = APIClient()
        self.today = datetime.date.today()
        self.check_in = str(self.today + datetime.timedelta(days=30))
        self.check_out = str(self.today + datetime.timedelta(days=33))

    def _get(self, slug='auto-marina', **params):
        qs = '&'.join(f'{k}={v}' for k, v in params.items())
        return self.client.get(
            f'/api/v1/public/bookings/available-berths/?{qs}',
            HTTP_X_MARINA_SLUG=slug,
        )

    def test_returns_berths_when_available(self):
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertGreater(len(resp.data), 0)
        self.assertIn('pricing_tier_unit_price', resp.data[0])

    def test_returns_empty_when_blocked(self):
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=self.today + datetime.timedelta(days=30),
            check_out=self.today + datetime.timedelta(days=33),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])

    def test_missing_dates_returns_400(self):
        resp = self._get()
        self.assertEqual(resp.status_code, 400)

    def test_unknown_marina_returns_404(self):
        resp = self._get(slug='no-such-marina', check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 404)

    def test_invalid_date_format_returns_400(self):
        resp = self._get(check_in='not-a-date', check_out='also-not-a-date')
        self.assertEqual(resp.status_code, 400)

    def test_boat_draft_filter(self):
        self.berth.max_draft_m = '1.0'
        self.berth.save()
        resp = self._get(check_in=self.check_in, check_out=self.check_out, boat_draft='2.0')
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertNotIn(self.berth.id, ids)

    def test_equal_dates_returns_400(self):
        resp = self._get(check_in='2027-07-10', check_out='2027-07-10')
        self.assertEqual(resp.status_code, 400)


class PublicAvailabilityAlternativesTest(TestCase):
    def setUp(self):
        self.marina = make_auto_marina()
        self.berth = make_test_berth(self.marina)
        self.berth2 = make_test_berth(self.marina, code='B2')
        self.client = APIClient()
        self.today = datetime.date.today()
        self.check_in = str(self.today + datetime.timedelta(days=60))
        self.check_out = str(self.today + datetime.timedelta(days=63))

    def _get(self, slug='auto-marina', **params):
        qs = '&'.join(f'{k}={v}' for k, v in params.items())
        return self.client.get(
            f'/api/v1/public/bookings/availability-alternatives/?{qs}',
            HTTP_X_MARINA_SLUG=slug,
        )

    def _block_all(self, check_in_offset, check_out_offset):
        ci = self.today + datetime.timedelta(days=check_in_offset)
        co = self.today + datetime.timedelta(days=check_out_offset)
        for berth in (self.berth, self.berth2):
            Booking.objects.create(
                marina=self.marina, berth=berth,
                check_in=ci, check_out=co,
                nights=(co - ci).days, amount='270',
                status='confirmed', booking_type='transient',
            )

    def test_returns_alternatives_when_primary_blocked(self):
        # Block both berths for exact dates — berth2 is free for shifted windows
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=self.today + datetime.timedelta(days=60),
            check_out=self.today + datetime.timedelta(days=63),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        Booking.objects.create(
            marina=self.marina, berth=self.berth2,
            check_in=self.today + datetime.timedelta(days=60),
            check_out=self.today + datetime.timedelta(days=63),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        # A third free berth provides the alternative
        make_test_berth(self.marina, code='B3')
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertGreater(len(resp.data), 0)
        alt = resp.data[0]
        self.assertIn('check_in', alt)
        self.assertIn('check_out', alt)
        self.assertIn('nights', alt)
        self.assertIn('price_per_night', alt)
        self.assertIn('total', alt)

    def test_returns_empty_when_no_alternatives(self):
        self._block_all(55, 70)
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])

    def test_missing_dates_returns_400(self):
        resp = self._get()
        self.assertEqual(resp.status_code, 400)

    def test_unknown_marina_returns_404(self):
        resp = self._get(slug='no-such-marina', check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 404)

    def test_boat_draft_respected(self):
        self.berth.max_draft_m = '1.0'
        self.berth.save()
        self.berth2.max_draft_m = '1.0'
        self.berth2.save()
        # Block exact dates on both shallow berths
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=self.today + datetime.timedelta(days=60),
            check_out=self.today + datetime.timedelta(days=63),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        Booking.objects.create(
            marina=self.marina, berth=self.berth2,
            check_in=self.today + datetime.timedelta(days=60),
            check_out=self.today + datetime.timedelta(days=63),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        resp = self._get(check_in=self.check_in, check_out=self.check_out, boat_draft='2.0')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])

    def test_equal_dates_returns_400(self):
        resp = self._get(check_in='2027-07-10', check_out='2027-07-10')
        self.assertEqual(resp.status_code, 400)


class PublicEngineRequestTest(TestCase):
    def setUp(self):
        self.marina = make_auto_marina()
        self.berth = make_test_berth(self.marina)
        self.client = APIClient()
        self.today = datetime.date.today()
        self.payload = {
            'check_in': str(self.today + datetime.timedelta(days=30)),
            'check_out': str(self.today + datetime.timedelta(days=33)),
            'guest_name': 'J. Sailor',
            'guest_email': 'sailor@sea.com',
            'guest_phone': '+353871234567',
            'boat_loa': 12.5,
            'boat_beam': 4.2,
        }

    def _post(self, payload=None, slug='auto-marina'):
        return self.client.post(
            '/api/v1/public/bookings/engine-request/',
            payload or self.payload,
            format='json',
            HTTP_X_MARINA_SLUG=slug,
        )

    @patch('apps.portal.public_booking_views.billing_service.create_stripe_checkout_session', return_value='https://stripe.test/pay')
    def test_creates_booking_and_returns_checkout_url(self, _mock):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        self.assertIn('checkout_url', resp.data)
        self.assertIn('booking', resp.data)
        self.assertEqual(resp.data['checkout_url'], 'https://stripe.test/pay')

    @patch('apps.portal.public_booking_views.billing_service.create_stripe_checkout_session', return_value='https://stripe.test/pay')
    def test_invoice_booking_fk_is_set(self, _mock):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        booking_id = resp.data['booking']['id']
        inv = Invoice.objects.get(source_type='berth_booking', source_id=str(booking_id))
        self.assertEqual(inv.booking_id, booking_id)

    def test_no_availability_returns_409(self):
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=self.today + datetime.timedelta(days=30),
            check_out=self.today + datetime.timedelta(days=33),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        resp = self._post()
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(Booking.objects.count(), 1)  # only the pre-existing blocking booking

    def test_unknown_marina_returns_404(self):
        resp = self._post(slug='no-such-marina')
        self.assertEqual(resp.status_code, 404)

    def test_missing_field_returns_400(self):
        payload = {**self.payload}
        del payload['guest_email']
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('guest_email', resp.data)

    def test_non_auto_tetris_marina_returns_400(self):
        manual_marina = Marina.objects.create(name='Manual', slug='manual-m', booking_mode='manual_approval')
        make_test_berth(manual_marina, code='M1')
        resp = self._post(slug='manual-m')
        self.assertEqual(resp.status_code, 400)


class PublicBerthCategoriesViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Cat Marina', slug='cat-marina', booking_mode='auto_tetris')
        self.tier = ChargeableItem.objects.create(
            marina=self.marina, name='Night', category='berth',
            pricing_model='per_night', unit_price=50,
        )
        self.cat = BerthCategory.objects.create(
            marina=self.marina, name='Standard', amenities=['water'],
            pricing_tier=self.tier, is_active=True,
        )
        pier = Pier.objects.create(marina=self.marina, code='A')
        self.berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='A1',
            length_m=12, max_beam_m=4, max_draft_m=2,
            status='available', berth_class='standard',
            pricing_tier=self.tier, category=self.cat,
        )
        self.client = APIClient()
        self.url = '/api/v1/public/bookings/berth-categories/'

    def _get(self, check_in='2026-08-01', check_out='2026-08-05', loa='10', beam='3', draft='1.5'):
        qs = f'check_in={check_in}&check_out={check_out}&boat_loa={loa}&boat_beam={beam}&boat_draft={draft}'
        return self.client.get(
            f'{self.url}?{qs}',
            HTTP_X_MARINA_SLUG='cat-marina',
        )

    def test_returns_available_categories(self):
        res = self._get()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['name'], 'Standard')
        self.assertEqual(res.data[0]['available_count'], 1)
        self.assertEqual(res.data[0]['price_per_night'], '50.00')

    def test_excludes_category_without_pricing_tier(self):
        BerthCategory.objects.create(
            marina=self.marina, name='No Tier', is_active=True,
            pricing_tier=None,
        )
        res = self._get()
        names = [c['name'] for c in res.data]
        self.assertNotIn('No Tier', names)

    def test_excludes_category_when_boat_too_large(self):
        res = self._get(loa='20')  # berth max is 12m
        self.assertEqual(res.data, [])

    def test_requires_marina_slug(self):
        res = self.client.get(self.url + '?check_in=2026-08-01&check_out=2026-08-05')
        self.assertEqual(res.status_code, 404)
