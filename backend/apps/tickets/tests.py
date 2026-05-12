from unittest.mock import patch, MagicMock
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User


@override_settings(INGRESS_WEBHOOK_SECRET='test-secret')
class TicketViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='staff@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.valid_payload = {
            'title': 'Reservations page crashes on load',
            'description': 'When I navigate to the reservations screen it crashes immediately. I have tried refreshing and it still happens every time.',
            'context': {
                'screen': 'reservations',
                'user_email': 'staff@test.com',
                'user_name': 'Test User',
                'user_role': 'manager',
                'user_agent': 'Mozilla/5.0',
                'timestamp': '2026-05-13T10:00:00Z',
                'app_version': '1.0.0',
            },
        }

    @patch('apps.tickets.views.requests.post')
    def test_valid_submission_forwards_to_webhook(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_post.return_value = mock_resp

        r = self.client.post('/api/v1/tickets/', self.valid_payload, format='json')

        self.assertEqual(r.status_code, 200)
        self.assertIn('ticket_id', r.json())
        mock_post.assert_called_once()

        call_kwargs = mock_post.call_args
        url = call_kwargs[0][0]
        headers = call_kwargs[1]['headers']
        body = call_kwargs[1]['json']

        self.assertEqual(url, 'https://tickets.sajosi.com/tickets')
        self.assertEqual(headers['X-Webhook-Secret'], 'test-secret')
        self.assertIn('id', body)
        self.assertEqual(body['title'], 'Reservations page crashes on load')
        self.assertIsNone(body['error'])

    @patch('apps.tickets.views.requests.post')
    def test_upstream_failure_returns_502(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 500
        mock_post.return_value = mock_resp

        r = self.client.post('/api/v1/tickets/', self.valid_payload, format='json')

        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()['detail'], 'Ticket service unavailable.')

    @patch('apps.tickets.views.requests.post')
    def test_network_error_returns_502(self, mock_post):
        import requests as req
        mock_post.side_effect = req.RequestException('timeout')

        r = self.client.post('/api/v1/tickets/', self.valid_payload, format='json')

        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()['detail'], 'Ticket service unavailable.')

    def test_missing_title_returns_400(self):
        payload = {**self.valid_payload, 'title': ''}
        r = self.client.post('/api/v1/tickets/', payload, format='json')
        self.assertEqual(r.status_code, 400)

    def test_missing_description_returns_400(self):
        payload = {**self.valid_payload, 'description': ''}
        r = self.client.post('/api/v1/tickets/', payload, format='json')
        self.assertEqual(r.status_code, 400)

    def test_title_too_long_returns_400(self):
        payload = {**self.valid_payload, 'title': 'x' * 121}
        r = self.client.post('/api/v1/tickets/', payload, format='json')
        self.assertEqual(r.status_code, 400)

    def test_unauthenticated_returns_401(self):
        anon = APIClient()
        r = anon.post('/api/v1/tickets/', self.valid_payload, format='json')
        self.assertEqual(r.status_code, 401)
