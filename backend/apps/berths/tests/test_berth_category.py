from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import BerthCategory
from apps.billing.models import ChargeableItem, TaxRate


def make_marina():
    return Marina.objects.create(name='Test Marina')


def _default_tax(marina):
    tax, _ = TaxRate.objects.get_or_create(
        marina=marina, name='Standard', defaults={'rate': '0.00', 'is_default': True}
    )
    return tax


def make_tier(marina):
    return ChargeableItem.objects.create(
        marina=marina, name='Standard Night', category='berth',
        pricing_model='per_night', unit_price=40,
        tax_category=_default_tax(marina),
    )


def make_manager(marina):
    return User.objects.create_user(
        email='mgr@test.com', password='pass', role='manager', marina=marina,
    )


class BerthCategoryModelTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_clean_rejects_bad_amenity_slug(self):
        from django.core.exceptions import ValidationError
        cat = BerthCategory(marina=self.marina, name='Bad', amenities=['power_9000'])
        with self.assertRaises(ValidationError):
            cat.clean()

    def test_clean_accepts_valid_slugs(self):
        cat = BerthCategory(marina=self.marina, name='Good', amenities=['power_30a', 'water'])
        cat.clean()  # should not raise

    def test_clean_accepts_empty_amenities(self):
        cat = BerthCategory(marina=self.marina, name='Empty', amenities=[])
        cat.clean()  # should not raise


class BerthCategoryAPITest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.tier = make_tier(self.marina)
        self.user = make_manager(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_category(self):
        res = self.client.post('/api/v1/berths/berth-categories/', {
            'name': 'Premium Slip',
            'description': '30A shore power included.',
            'mooring_type': 'finger',
            'amenities': ['power_30a', 'water'],
            'pricing_tier': self.tier.id,
            'sort_order': 1,
            'is_active': True,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['name'], 'Premium Slip')

    def test_create_rejects_bad_amenity(self):
        res = self.client.post('/api/v1/berths/berth-categories/', {
            'name': 'Bad',
            'amenities': ['Wifi '],
            'pricing_tier': self.tier.id,
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('amenities', res.data)

    def test_list_scoped_to_marina(self):
        other = make_marina()
        BerthCategory.objects.create(marina=other, name='Other Marina Cat')
        BerthCategory.objects.create(marina=self.marina, name='My Cat')
        res = self.client.get('/api/v1/berths/berth-categories/')
        self.assertEqual(res.status_code, 200)
        names = [c['name'] for c in res.data]
        self.assertIn('My Cat', names)
        self.assertNotIn('Other Marina Cat', names)
