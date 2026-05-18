import datetime
from decimal import Decimal
from django.test import TestCase
from apps.accounts.models import Marina
from apps.reservations.models import Reservation, ReservationItem, InsuranceUploadToken


def make_marina(**overrides):
    defaults = dict(name='Phase1 Test Marina', slug='phase1-test')
    defaults.update(overrides)
    return Marina.objects.create(**defaults)


class MarinaPhase1FieldsTest(TestCase):
    def test_defaults(self):
        m = make_marina()
        self.assertEqual(m.booking_terms_pdf_url, '')
        self.assertEqual(m.booking_terms_version, '1.0')
        self.assertFalse(m.requires_air_draft)
        self.assertFalse(m.requires_insurance_at_booking)


class ReservationPhase1FieldsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_reservation_defaults(self):
        r = Reservation.objects.create(
            marina=self.marina,
            guest_name='Alice',
            guest_email='a@b.test',
            status='pending_review',
        )
        self.assertIsNone(r.estimated_arrival_time)
        self.assertEqual(r.special_requests, '')
        self.assertIsNone(r.shore_power_amperage)
        self.assertIsNone(r.terms_accepted_at)
        self.assertEqual(r.terms_version, '')
        self.assertEqual(r.billing_street, '')
        self.assertEqual(r.billing_city, '')
        self.assertEqual(r.billing_postcode, '')
        self.assertEqual(r.billing_country, '')
        self.assertEqual(r.company_name, '')
        self.assertEqual(r.vat_number, '')
        self.assertEqual(r.promo_code, '')


class ReservationItemPhase1FieldsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.reservation = Reservation.objects.create(
            marina=self.marina, guest_name='A', guest_email='a@b.test', status='pending_review',
        )

    def test_item_defaults(self):
        item = ReservationItem.objects.create(
            reservation=self.reservation,
            check_in=datetime.date(2026, 6, 1),
            check_out=datetime.date(2026, 6, 5),
            nights=4,
            boat_loa=Decimal('12.00'),
            status='unassigned',
        )
        self.assertIsNone(item.boat_air_draft)
        self.assertEqual(item.vessel_registration, '')
        self.assertEqual(item.vessel_flag, '')
        self.assertIsNone(item.crew_count)
        self.assertFalse(item.insurance_certificate)  # FileField empty is falsy


class InsuranceUploadTokenTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_token_create(self):
        t = InsuranceUploadToken.objects.create(
            token='tk_abc123',
            marina=self.marina,
            file_path='reservations/insurance/tmp/tk_abc123.pdf',
            mime_type='application/pdf',
            size_bytes=12345,
        )
        self.assertIsNotNone(t.created_at)
        self.assertIsNone(t.consumed_at)


class AllowedCountriesTest(TestCase):
    def test_constant_contains_eu_uk_us(self):
        from apps.reservations.constants import ALLOWED_COUNTRIES
        for code in ('FR', 'DE', 'GB', 'US'):
            self.assertIn(code, ALLOWED_COUNTRIES)

    def test_constant_excludes_garbage(self):
        from apps.reservations.constants import ALLOWED_COUNTRIES
        self.assertNotIn('ZZ', ALLOWED_COUNTRIES)
        self.assertNotIn('', ALLOWED_COUNTRIES)
