import datetime
from decimal import Decimal
from django.test import TestCase
from apps.accounts.models import Marina


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
