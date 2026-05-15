import hashlib
import pytest
from rest_framework.test import APIClient
from django.urls import reverse

from apps.api_keys.models import APIKey, generate_key


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def owner_client(owner_user):
    c = APIClient()
    c.force_authenticate(user=owner_user)
    return c


@pytest.fixture
def manager_client(manager_user):
    c = APIClient()
    c.force_authenticate(user=manager_user)
    return c


@pytest.fixture
def staff_client(staff_user):
    c = APIClient()
    c.force_authenticate(user=staff_user)
    return c


LIST_URL = '/api/v1/api-keys/'


class TestAPIKeyListView:
    def test_owner_can_list_empty(self, owner_client, db):
        resp = owner_client.get(LIST_URL)
        assert resp.status_code == 200
        # Response may be paginated or a plain list
        results = resp.data.get('results', resp.data) if isinstance(resp.data, dict) else resp.data
        assert len(results) == 0

    def test_manager_gets_403(self, manager_client, db):
        resp = manager_client.get(LIST_URL)
        assert resp.status_code == 403

    def test_anonymous_gets_401(self, client, db):
        resp = client.get(LIST_URL)
        assert resp.status_code == 401

    def test_staff_gets_403(self, staff_client, db):
        resp = staff_client.get(LIST_URL)
        assert resp.status_code == 403


class TestAPIKeyCreateView:
    def test_owner_can_create(self, owner_client, db):
        resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        assert resp.status_code == 201
        assert 'key' in resp.data
        assert resp.data['key'].startswith('db_live_')
        assert 'last_four' in resp.data
        assert 'key_prefix' in resp.data

    def test_create_does_not_return_key_hash(self, owner_client, db):
        resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        assert resp.status_code == 201
        assert 'key_hash' not in resp.data

    def test_create_with_empty_name_returns_400(self, owner_client, db):
        resp = owner_client.post(LIST_URL, {'name': ''}, format='json')
        assert resp.status_code == 400

    def test_create_with_whitespace_name_returns_400(self, owner_client, db):
        resp = owner_client.post(LIST_URL, {'name': '   '}, format='json')
        assert resp.status_code == 400

    def test_manager_cannot_create(self, manager_client, db):
        resp = manager_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        assert resp.status_code == 403

    def test_staff_cannot_create(self, staff_client, db):
        resp = staff_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        assert resp.status_code == 403

    def test_last_four_matches_key_tail(self, owner_client, db):
        resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        assert resp.status_code == 201
        key = resp.data['key']
        last_four = resp.data['last_four']
        assert key.endswith(last_four)

    def test_raw_key_not_in_list_response(self, owner_client, db):
        # Create a key first
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        assert create_resp.status_code == 201
        raw_key = create_resp.data['key']

        # List should not include the raw key
        list_resp = owner_client.get(LIST_URL)
        assert list_resp.status_code == 200
        results = list_resp.data.get('results', list_resp.data) if isinstance(list_resp.data, dict) else list_resp.data
        assert len(results) == 1
        key_data = results[0]
        assert 'key' not in key_data
        assert 'key_hash' not in key_data


class TestAPIKeyAuthE2E:
    def test_created_key_can_authenticate_on_berths(self, owner_client, client, db):
        """Generated key can be used as Bearer token on other endpoints."""
        resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        assert resp.status_code == 201
        raw_key = resp.data['key']

        # Use the raw key to authenticate
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_key}')
        berths_resp = client.get('/api/v1/berths/')
        assert berths_resp.status_code == 200


class TestAPIKeyRevokeView:
    def test_owner_can_revoke_key(self, owner_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']

        resp = owner_client.post(f'{LIST_URL}{key_id}/revoke/')
        assert resp.status_code == 200
        assert resp.data['status'] == 'revoked'

    def test_revoke_is_idempotent(self, owner_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']

        # Revoke twice — both should return 200
        resp1 = owner_client.post(f'{LIST_URL}{key_id}/revoke/')
        assert resp1.status_code == 200
        resp2 = owner_client.post(f'{LIST_URL}{key_id}/revoke/')
        assert resp2.status_code == 200

    def test_revoked_key_shows_in_list(self, owner_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']
        owner_client.post(f'{LIST_URL}{key_id}/revoke/')

        list_resp = owner_client.get(LIST_URL)
        results = list_resp.data.get('results', list_resp.data) if isinstance(list_resp.data, dict) else list_resp.data
        assert results[0]['status'] == 'revoked'

    def test_revoked_key_cannot_authenticate(self, owner_client, client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']
        raw_key = create_resp.data['key']

        owner_client.post(f'{LIST_URL}{key_id}/revoke/')

        client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_key}')
        berths_resp = client.get('/api/v1/berths/')
        assert berths_resp.status_code == 401

    def test_manager_cannot_revoke(self, owner_client, manager_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']

        resp = manager_client.post(f'{LIST_URL}{key_id}/revoke/')
        assert resp.status_code == 403

    def test_staff_cannot_revoke(self, owner_client, staff_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']

        resp = staff_client.post(f'{LIST_URL}{key_id}/revoke/')
        assert resp.status_code == 403


class TestAPIKeyDeleteView:
    def test_owner_can_delete(self, owner_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']

        resp = owner_client.delete(f'{LIST_URL}{key_id}/')
        assert resp.status_code == 204

        list_resp = owner_client.get(LIST_URL)
        results = list_resp.data.get('results', list_resp.data) if isinstance(list_resp.data, dict) else list_resp.data
        assert len(results) == 0

    def test_manager_cannot_delete(self, owner_client, manager_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']

        resp = manager_client.delete(f'{LIST_URL}{key_id}/')
        assert resp.status_code == 403

    def test_staff_cannot_delete(self, owner_client, staff_client, db):
        create_resp = owner_client.post(LIST_URL, {'name': 'Integration'}, format='json')
        key_id = create_resp.data['id']

        resp = staff_client.delete(f'{LIST_URL}{key_id}/')
        assert resp.status_code == 403


class TestAPIKeyDocsView:
    def test_owner_can_get_docs(self, owner_client, db):
        resp = owner_client.get(f'{LIST_URL}docs/')
        assert resp.status_code == 200
        assert 'markdown' in resp.data
        assert isinstance(resp.data['markdown'], str)
        assert len(resp.data['markdown']) > 100

    def test_manager_cannot_get_docs(self, manager_client, db):
        resp = manager_client.get(f'{LIST_URL}docs/')
        assert resp.status_code == 403

    def test_anonymous_cannot_get_docs(self, client, db):
        resp = client.get(f'{LIST_URL}docs/')
        assert resp.status_code == 401
