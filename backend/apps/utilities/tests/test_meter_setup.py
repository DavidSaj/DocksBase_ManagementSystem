from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.utilities.models import (
    MarinaMeterWebhookKey, MeterReading, SmartMeter, UtilityIntegration,
)


class _Base(TestCase):
    def setUp(self):
        self.marina       = Marina.objects.create(name='Test Marina')
        self.other_marina = Marina.objects.create(name='Other Marina')
        self.user = User.objects.create_user(
            email='staff@test.com', password='pass', marina=self.marina, role='manager',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)


class IntegrationCrudTests(_Base):
    def test_list_scoped_to_user_marina(self):
        UtilityIntegration.objects.create(marina=self.marina,       vendor='rolec',
                                          credentials={'api_key': 'a'})
        UtilityIntegration.objects.create(marina=self.other_marina, vendor='rolec',
                                          credentials={'api_key': 'b'})
        r = self.client.get('/api/v1/utilities/integrations/')
        self.assertEqual(r.status_code, 200)
        rows = r.json().get('results', r.json())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['vendor'], 'rolec')

    def test_cannot_access_other_marina_integration(self):
        other = UtilityIntegration.objects.create(
            marina=self.other_marina, vendor='rolec', credentials={'api_key': 'b'},
        )
        r = self.client.get(f'/api/v1/utilities/integrations/{other.pk}/')
        self.assertEqual(r.status_code, 404)

    def test_create_persists_credentials_but_omits_from_response(self):
        r = self.client.post('/api/v1/utilities/integrations/', {
            'vendor': 'rolec',
            'credentials': {'api_key': 'secret', 'base_url': 'https://api.rolec.test'},
        }, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertNotIn('credentials', r.json())
        row = UtilityIntegration.objects.get(pk=r.json()['id'])
        self.assertEqual(row.credentials['api_key'], 'secret')

    @patch('apps.utilities.views.get_vendor_adapter')
    def test_test_action_success(self, mock_factory):
        mock_factory.return_value.test_connection.return_value = None
        i = UtilityIntegration.objects.create(marina=self.marina, vendor='rolec',
                                              credentials={'api_key': 'a'})
        r = self.client.post(f'/api/v1/utilities/integrations/{i.pk}/test/')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['ok'])

    @patch('apps.utilities.views.get_vendor_adapter')
    def test_test_action_failure(self, mock_factory):
        from apps.utilities.vendors.base import VendorConnectionError
        mock_factory.return_value.test_connection.side_effect = VendorConnectionError('401: bad token')
        i = UtilityIntegration.objects.create(marina=self.marina, vendor='rolec',
                                              credentials={'api_key': 'a'})
        r = self.client.post(f'/api/v1/utilities/integrations/{i.pk}/test/')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['ok'])
        self.assertIn('401', r.json()['error'])


class WebhookKeyTests(_Base):
    def test_get_when_unissued(self):
        r = self.client.get('/api/v1/utilities/webhook-key/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['status'], 'unissued')
        self.assertEqual(r.json()['key_prefix'], '')
        self.assertTrue(r.json()['endpoint_url'].endswith('/utilities/webhook/readings/'))

    def test_rotate_returns_plaintext_once(self):
        r = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        self.assertEqual(r.status_code, 200)
        plaintext = r.json()['key']
        self.assertTrue(plaintext.startswith('sk_'))
        self.assertGreater(len(plaintext), 40)

        r2 = self.client.get('/api/v1/utilities/webhook-key/')
        self.assertNotIn('key', r2.json())
        self.assertEqual(r2.json()['status'], 'active')

    def test_rotate_replaces_previous_key(self):
        r1 = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        old_plain = r1.json()['key']
        r2 = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        new_plain = r2.json()['key']
        self.assertNotEqual(old_plain, new_plain)

        ingest = self.client.post(
            '/api/v1/utilities/webhook/readings/',
            {'readings': []},
            format='json',
            HTTP_X_WEBHOOK_KEY=old_plain,
        )
        self.assertEqual(ingest.status_code, 401)

    def test_revoke(self):
        self.client.post('/api/v1/utilities/webhook-key/rotate/')
        r = self.client.delete('/api/v1/utilities/webhook-key/')
        self.assertEqual(r.status_code, 204)
        self.assertEqual(
            MarinaMeterWebhookKey.objects.get(marina=self.marina).key_hash, ''
        )


class WebhookIngestTests(_Base):
    def setUp(self):
        super().setUp()
        rot = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        self.plaintext = rot.json()['key']

        self.meter = SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='ROLEC-1', label='Berth 1',
        )
        self.client.credentials()  # drop JWT — ingest must work without it

    def _post(self, payload, key=None):
        return self.client.post(
            '/api/v1/utilities/webhook/readings/',
            payload, format='json',
            HTTP_X_WEBHOOK_KEY=key or self.plaintext,
        )

    def test_happy_path(self):
        r = self._post({'readings': [{
            'device_id': 'ROLEC-1',
            'recorded_at': '2026-05-14T10:00:00Z',
            'cumulative_kwh': '123.456',
        }]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['accepted'], 1)
        self.assertEqual(r.json()['rejected'], [])
        self.assertEqual(MeterReading.objects.count(), 1)

    def test_unknown_device_rejected(self):
        r = self._post({'readings': [{
            'device_id': 'NOPE',
            'recorded_at': '2026-05-14T10:00:00Z',
            'cumulative_kwh': '1.0',
        }]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['accepted'], 0)
        self.assertEqual(r.json()['rejected'][0]['device_id'], 'NOPE')

    def test_duplicate_silently_deduped(self):
        body = {'readings': [{'device_id': 'ROLEC-1',
                              'recorded_at': '2026-05-14T10:00:00Z',
                              'cumulative_kwh': '1.0'}]}
        self._post(body)
        self._post(body)
        self.assertEqual(MeterReading.objects.count(), 1)

    def test_missing_header_returns_401(self):
        r = self.client.post('/api/v1/utilities/webhook/readings/',
                             {'readings': [{'device_id': 'ROLEC-1',
                                            'recorded_at': '2026-05-14T10:00:00Z',
                                            'cumulative_kwh': '1.0'}]},
                             format='json')
        self.assertEqual(r.status_code, 401)

    def test_bad_key_returns_401(self):
        r = self._post({'readings': [{'device_id': 'ROLEC-1',
                                      'recorded_at': '2026-05-14T10:00:00Z',
                                      'cumulative_kwh': '1.0'}]},
                       key='sk_aaaaaaaa_wrong')
        self.assertEqual(r.status_code, 401)


class DeviceTokenTests(_Base):
    def setUp(self):
        super().setUp()
        self.meter = SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='DEV-1', label='Direct Meter',
        )

    def test_generate(self):
        r = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('hardware_id', r.json())
        self.assertIn('device_token', r.json())
        self.meter.refresh_from_db()
        self.assertNotEqual(self.meter.hardware_id, '')
        self.assertNotEqual(self.meter.device_token_hash, '')

    def test_rotate_changes_token(self):
        r1 = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        first = r1.json()['device_token']
        r2 = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.assertNotEqual(first, r2.json()['device_token'])

    def test_revoke(self):
        self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        r = self.client.delete(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.assertEqual(r.status_code, 204)
        self.meter.refresh_from_db()
        self.assertEqual(self.meter.hardware_id, '')
        self.assertEqual(self.meter.device_token_hash, '')


class DeviceIngestTests(_Base):
    def setUp(self):
        super().setUp()
        self.meter = SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='DEV-1', label='Direct Meter',
        )
        r = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.hw    = r.json()['hardware_id']
        self.token = r.json()['device_token']
        self.client.credentials()

    def _post(self, payload, hw=None, token=None):
        return self.client.post(
            '/api/v1/utilities/devices/readings/',
            payload, format='json',
            HTTP_X_HARDWARE_ID=hw or self.hw,
            HTTP_X_DEVICE_TOKEN=token or self.token,
        )

    def test_happy_path(self):
        r = self._post({'readings': [{
            'recorded_at': '2026-05-14T10:00:00Z',
            'cumulative_kwh': '5.0',
        }]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(MeterReading.objects.filter(meter=self.meter).count(), 1)

    def test_missing_token_returns_401(self):
        r = self.client.post('/api/v1/utilities/devices/readings/',
                             {'readings': [{'recorded_at': '2026-05-14T10:00:00Z',
                                            'cumulative_kwh': '1.0'}]},
                             format='json',
                             HTTP_X_HARDWARE_ID=self.hw)
        self.assertEqual(r.status_code, 401)

    def test_wrong_token_returns_401(self):
        r = self._post({'readings': [{'recorded_at': '2026-05-14T10:00:00Z',
                                      'cumulative_kwh': '1.0'}]},
                       token='sk_wrongwrong_zzzzzz')
        self.assertEqual(r.status_code, 401)

    def test_inactive_meter_returns_401(self):
        SmartMeter.objects.filter(pk=self.meter.pk).update(is_active=False)
        r = self._post({'readings': [{'recorded_at': '2026-05-14T10:00:00Z',
                                      'cumulative_kwh': '1.0'}]})
        self.assertEqual(r.status_code, 401)


class LastUsedThrottleTests(_Base):
    def test_second_auth_within_hour_does_not_update(self):
        rot = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        plaintext = rot.json()['key']

        SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='X', label='X',
        )
        body = {'readings': [{'device_id': 'X',
                              'recorded_at': '2026-05-14T10:00:00Z',
                              'cumulative_kwh': '1.0'}]}
        self.client.credentials()

        self.client.post('/api/v1/utilities/webhook/readings/',
                         body, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        row = MarinaMeterWebhookKey.objects.get(marina=self.marina)
        first = row.last_used_at
        self.assertIsNotNone(first)

        self.client.post('/api/v1/utilities/webhook/readings/',
                         body, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        row.refresh_from_db()
        self.assertEqual(row.last_used_at, first)

    def test_auth_after_an_hour_updates(self):
        rot = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        plaintext = rot.json()['key']

        SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='X', label='X',
        )
        body = {'readings': [{'device_id': 'X',
                              'recorded_at': '2026-05-14T10:00:00Z',
                              'cumulative_kwh': '1.0'}]}
        self.client.credentials()

        self.client.post('/api/v1/utilities/webhook/readings/',
                         body, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        MarinaMeterWebhookKey.objects.filter(marina=self.marina).update(
            last_used_at=timezone.now() - timedelta(hours=2),
        )
        self.client.post('/api/v1/utilities/webhook/readings/',
                         body, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        row = MarinaMeterWebhookKey.objects.get(marina=self.marina)
        self.assertGreater(row.last_used_at, timezone.now() - timedelta(seconds=5))
