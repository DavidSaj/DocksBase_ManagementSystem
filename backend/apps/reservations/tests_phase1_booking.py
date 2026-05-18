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


from rest_framework.test import APIClient
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.reservations.models import InsuranceUploadToken


class InsuranceUploadEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina(slug='insurance-test-marina')
        self.client = APIClient()
        self.url = '/api/v1/public/reservations/insurance-upload/'
        self.headers = {'HTTP_X_MARINA_SLUG': self.marina.slug}

    def _pdf(self, name='cert.pdf', size=1024):
        return SimpleUploadedFile(name, b'%PDF-1.4\n' + b'x' * (size - 9), content_type='application/pdf')

    def test_happy_path_returns_token(self):
        r = self.client.post(self.url, {'file': self._pdf()}, format='multipart', **self.headers)
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertIn('token', body)
        self.assertIn('expires_at', body)
        self.assertTrue(InsuranceUploadToken.objects.filter(token=body['token']).exists())

    def test_rejects_non_pdf_non_image(self):
        bad = SimpleUploadedFile('cert.exe', b'MZ\x90\x00', content_type='application/x-msdownload')
        r = self.client.post(self.url, {'file': bad}, format='multipart', **self.headers)
        self.assertEqual(r.status_code, 400)
        self.assertIn('mime', r.json().get('detail', '').lower())

    def test_rejects_oversize(self):
        big = SimpleUploadedFile('big.pdf', b'%PDF-1.4\n' + b'x' * (6 * 1024 * 1024), content_type='application/pdf')
        r = self.client.post(self.url, {'file': big}, format='multipart', **self.headers)
        self.assertEqual(r.status_code, 400)
        self.assertIn('size', r.json().get('detail', '').lower())

    def test_rejects_missing_marina(self):
        r = self.client.post(self.url, {'file': self._pdf()}, format='multipart')
        self.assertEqual(r.status_code, 404)


from apps.reservations.public_reservation_views import (
    CartItemSerializer, ReservationIntentSerializer,
)


class SerializerExtensionsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def _future(self, days=30):
        from datetime import date, timedelta
        return date.today() + timedelta(days=days)

    def test_cart_item_accepts_new_optional_fields(self):
        data = {
            'boat_loa': '12.5',
            'boat_air_draft': '4.2',
            'vessel_registration': 'GB-123-XYZ',
            'vessel_flag': 'GB',
            'crew_count': 3,
            'insurance_upload_token': 'tk_abc',
            'vessel_name': 'Bella',
        }
        ser = CartItemSerializer(data=data)
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(ser.validated_data['vessel_flag'], 'GB')
        self.assertEqual(ser.validated_data['crew_count'], 3)
        self.assertEqual(ser.validated_data['insurance_upload_token'], 'tk_abc')

    def test_cart_item_omitting_new_fields_is_valid(self):
        ser = CartItemSerializer(data={'boat_loa': '10.0'})
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_intent_accepts_new_booking_fields(self):
        from datetime import timedelta
        ci = self._future()
        data = {
            'check_in':  ci.isoformat(),
            'check_out': (ci + timedelta(days=4)).isoformat(),
            'guest_name':  'Alice',
            'guest_email': 'a@b.test',
            'guest_phone': '+44 7000 000000',
            'estimated_arrival_time': '14:30',
            'special_requests': 'arriving on engine',
            'shore_power_amperage': '32A',
            'billing_street':   '1 Quay St',
            'billing_city':     'Plymouth',
            'billing_postcode': 'PL1 1AB',
            'billing_country':  'GB',
            'company_name': 'Acme Charter Ltd',
            'vat_number':   'GB123456789',
            'promo_code':   'WELCOME10',
            'terms_accepted': True,
            'items': [{'boat_loa': '12.5'}],
        }
        ser = ReservationIntentSerializer(data=data)
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(ser.validated_data['billing_country'], 'GB')
        self.assertTrue(ser.validated_data['terms_accepted'])

    def test_intent_rejects_unknown_country(self):
        from datetime import timedelta
        ci = self._future()
        data = {
            'check_in':  ci.isoformat(),
            'check_out': (ci + timedelta(days=4)).isoformat(),
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'billing_country': 'ZZ',
            'items': [{'boat_loa': '10.0'}],
        }
        ser = ReservationIntentSerializer(data=data)
        self.assertFalse(ser.is_valid())
        self.assertIn('billing_country', ser.errors)

    def test_intent_rejects_bad_vat_format(self):
        from datetime import timedelta
        ci = self._future()
        data = {
            'check_in':  ci.isoformat(),
            'check_out': (ci + timedelta(days=4)).isoformat(),
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'vat_number': '!!',
            'items': [{'boat_loa': '10.0'}],
        }
        ser = ReservationIntentSerializer(data=data)
        self.assertFalse(ser.is_valid())
        self.assertIn('vat_number', ser.errors)


from django.utils import timezone


class TermsAcceptanceTest(TestCase):
    def setUp(self):
        self.marina = make_marina(
            slug='terms-marina',
            booking_terms_pdf_url='https://example.com/tos.pdf',
            booking_terms_version='2.0',
            booking_mode='manual',
        )
        self.client = APIClient()
        self.url = '/api/v1/public/reservations/intent/'
        self.headers = {'HTTP_X_MARINA_SLUG': self.marina.slug}

    def _payload(self, **overrides):
        base = {
            'check_in':  '2999-08-01',
            'check_out': '2999-08-05',
            'guest_name':  'Alice',
            'guest_email': 'a@b.test',
            'items': [{'boat_loa': '10.0'}],
        }
        base.update(overrides)
        return base

    def test_marina_with_terms_blocks_when_not_accepted(self):
        r = self.client.post(self.url, self._payload(terms_accepted=False), format='json', **self.headers)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.json().get('detail'), 'terms_not_accepted')

    def test_marina_with_terms_passes_when_accepted(self):
        r = self.client.post(self.url, self._payload(terms_accepted=True), format='json', **self.headers)
        self.assertIn(r.status_code, (200, 201), r.content)
        from apps.reservations.models import Reservation
        res = Reservation.objects.get(pk=r.json()['reservation_id'])
        self.assertIsNotNone(res.terms_accepted_at)
        self.assertEqual(res.terms_version, '2.0')

    def test_marina_without_terms_skips_check(self):
        m2 = make_marina(slug='no-tos-marina', booking_mode='manual')  # empty booking_terms_pdf_url default
        headers = {'HTTP_X_MARINA_SLUG': m2.slug}
        r = self.client.post(self.url, self._payload(), format='json', **headers)
        self.assertEqual(r.status_code, 201, r.content)
