from django.test import TestCase
from apps.accounts.models import Marina


class MarinaPublicViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Blue Cove Marina',
            slug='blue-cove',
            contact_email='info@bluecove.com',
            timezone='Europe/Paris',
            currency='EUR',
        )

    def test_returns_public_marina_data(self):
        response = self.client.get(
            '/api/v1/public/marina/',
            HTTP_X_MARINA_SLUG='blue-cove',
        )
        self.assertEqual(response.status_code, 200)
        import json
        data = json.loads(response.content)
        self.assertEqual(data['slug'], 'blue-cove')
        self.assertEqual(data['name'], 'Blue Cove Marina')
        self.assertEqual(data['timezone'], 'Europe/Paris')
        self.assertEqual(data['currency'], 'EUR')
        # Must NOT expose internal fields
        self.assertNotIn('stripe_account_id', data)
        self.assertNotIn('vat_number', data)

    def test_returns_404_for_unknown_slug(self):
        response = self.client.get(
            '/api/v1/public/marina/',
            HTTP_X_MARINA_SLUG='nonexistent',
        )
        self.assertEqual(response.status_code, 404)

    def test_returns_400_when_no_slug_header(self):
        response = self.client.get('/api/v1/public/marina/')
        self.assertEqual(response.status_code, 400)
