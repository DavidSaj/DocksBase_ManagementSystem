from django.test import TestCase
from apps.utilities.models import PendingUtilityCharge


class PendingUtilityChargeTest(TestCase):
    def test_model_exists_with_required_fields(self):
        fields = {f.name for f in PendingUtilityCharge._meta.get_fields()}
        self.assertIn('member', fields)
        self.assertIn('marina', fields)
        self.assertIn('meter', fields)
        self.assertIn('meter_reading', fields)
        self.assertIn('kwh_delta', fields)
        self.assertIn('m3_delta', fields)
        self.assertIn('unit_price', fields)
        self.assertIn('amount', fields)
        self.assertIn('rollover', fields)
        self.assertIn('swept_to_invoice', fields)
