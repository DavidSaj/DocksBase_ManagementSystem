from django.test import TestCase
from apps.accounts.models import MarinaGroup, MarinaGroupMembership, Marina


class MarinaGroupFieldsTest(TestCase):
    def test_default_fields(self):
        g = MarinaGroup.objects.create(name='Test Group', slug='test-group')
        self.assertEqual(g.max_marinas, 1)
        self.assertEqual(g.base_currency, 'EUR')
        self.assertEqual(g.billing_contact_email, '')
        self.assertEqual(g.stripe_customer_id, '')

    def test_custom_fields(self):
        g = MarinaGroup.objects.create(
            name='Big Group', slug='big-group',
            max_marinas=5, base_currency='GBP',
            billing_contact_email='billing@big.com',
        )
        self.assertEqual(g.max_marinas, 5)
        self.assertEqual(g.base_currency, 'GBP')
