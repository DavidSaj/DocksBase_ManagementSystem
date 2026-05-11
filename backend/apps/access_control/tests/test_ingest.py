"""
tests/test_ingest.py

HMAC validation tests for RFID, ANPR, and biometric ingest endpoints.
"""

import hashlib
import hmac
import json
import pytest


def _make_sig(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


@pytest.mark.django_db
class TestIngestHMAC:

    def _make_marina(self, secret='testsecret'):
        from apps.accounts.models import Marina
        return Marina.objects.create(
            name='Ingest Marina', slug='ingest-marina',
            features={'access_webhook_secret': secret, 'anpr_enabled': True},
        )

    def test_rfid_ingest_hmac_validation_rejects_bad_sig(self):
        from django.test import Client
        marina = self._make_marina('mysecret')
        c      = Client()
        body   = json.dumps({'reader_uid': 'R1', 'card_uid': 'AABB'}).encode()
        resp   = c.post(
            '/api/v1/access-control/ingest/rfid/',
            data=body,
            content_type='application/json',
            HTTP_X_DOCKSBASE_MARINA_ID=str(marina.pk),
            HTTP_X_DOCKSBASE_SIGNATURE='badsig',
        )
        assert resp.status_code == 403

    def test_rfid_ingest_hmac_validation_accepts_valid_sig(self):
        from django.test import Client
        from apps.access_control.models import AccessZone, AccessReader
        marina = self._make_marina('mysecret')
        zone   = AccessZone.objects.create(marina=marina, name='Gate')
        AccessReader.objects.create(marina=marina, zone=zone, reader_uid='R1', location_label='Main Gate')

        c      = Client()
        body   = json.dumps({'reader_uid': 'R1', 'card_uid': 'AABB', 'occurred_at': '2026-05-08T12:00:00Z'}).encode()
        sig    = _make_sig('mysecret', body)
        resp   = c.post(
            '/api/v1/access-control/ingest/rfid/',
            data=body,
            content_type='application/json',
            HTTP_X_DOCKSBASE_MARINA_ID=str(marina.pk),
            HTTP_X_DOCKSBASE_SIGNATURE=sig,
        )
        assert resp.status_code == 204

    def test_anpr_ingest_hmac_validation(self):
        from django.test import Client
        from unittest.mock import patch
        marina = self._make_marina('anprsecret')
        c      = Client()
        body   = json.dumps({'camera_uid': 'CAM1', 'plate': 'TEST01', 'confidence': 0.99}).encode()
        resp   = c.post(
            '/api/v1/access-control/ingest/anpr/',
            data=body,
            content_type='application/json',
            HTTP_X_DOCKSBASE_MARINA_ID=str(marina.pk),
            HTTP_X_DOCKSBASE_SIGNATURE='wrongsig',
        )
        assert resp.status_code == 403

    def test_biometric_ingest_hmac_validation(self):
        from django.test import Client
        marina = self._make_marina('biosecret')
        c      = Client()
        body   = json.dumps({'terminal_uid': 'T1', 'granted': True}).encode()
        resp   = c.post(
            '/api/v1/access-control/ingest/biometric/',
            data=body,
            content_type='application/json',
            HTTP_X_DOCKSBASE_MARINA_ID=str(marina.pk),
            HTTP_X_DOCKSBASE_SIGNATURE='badsig',
        )
        assert resp.status_code == 403

    def test_ingest_returns_403_without_marina_id(self):
        from django.test import Client
        c    = Client()
        resp = c.post(
            '/api/v1/access-control/ingest/rfid/',
            data=json.dumps({}),
            content_type='application/json',
        )
        assert resp.status_code == 403
