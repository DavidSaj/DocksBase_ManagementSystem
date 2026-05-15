"""
Tests for Task 2: IP allowlist — model, permission enforcement, viewset.

TDD order:
  1. Model + migration tests
  2. IPAllowlistPermission unit tests (using synthesized requests)
  3. Viewset integration tests via APIClient
  4. Roaming-owner escape-hatch end-to-end
"""

import ipaddress

import pytest
from django.test import RequestFactory
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.security.models import MarinaIPAllowlist


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def marina(db):
    return Marina.objects.create(name='Test Marina')


@pytest.fixture
def owner_user(marina):
    return User.objects.create_user(
        email='owner@test.com',
        password='ownerpass123',
        marina=marina,
        role='owner',
    )


@pytest.fixture
def manager_user(marina):
    return User.objects.create_user(
        email='manager@test.com',
        password='managerpass123',
        marina=marina,
        role='manager',
    )


@pytest.fixture
def boater_user(marina):
    return User.objects.create_user(
        email='boater@test.com',
        password='boaterpass123',
        marina=marina,
        role='boater',
    )


# ---------------------------------------------------------------------------
# 1. Model tests
# ---------------------------------------------------------------------------

class TestMarinaIPAllowlistModel:
    def test_create_entry(self, db, marina, owner_user):
        entry = MarinaIPAllowlist.objects.create(
            marina=marina,
            cidr='203.0.113.0/24',
            label='Office',
            created_by=owner_user,
        )
        assert entry.pk is not None
        assert entry.marina == marina
        assert entry.cidr == '203.0.113.0/24'
        assert entry.label == 'Office'
        assert entry.created_by == owner_user
        assert entry.created_at is not None

    def test_unique_together_blocks_duplicate(self, db, marina, owner_user):
        from django.db import IntegrityError
        MarinaIPAllowlist.objects.create(
            marina=marina,
            cidr='203.0.113.0/24',
            created_by=owner_user,
        )
        with pytest.raises(IntegrityError):
            MarinaIPAllowlist.objects.create(
                marina=marina,
                cidr='203.0.113.0/24',
                created_by=owner_user,
            )

    def test_same_cidr_different_marina_allowed(self, db, marina, owner_user):
        marina2 = Marina.objects.create(name='Marina Two')
        owner2 = User.objects.create_user(
            email='owner2@test.com',
            password='pass',
            marina=marina2,
            role='owner',
        )
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/24', created_by=owner_user)
        entry2 = MarinaIPAllowlist.objects.create(marina=marina2, cidr='203.0.113.0/24', created_by=owner2)
        assert entry2.pk is not None


# ---------------------------------------------------------------------------
# 2. IPAllowlistPermission unit tests
# ---------------------------------------------------------------------------

def _make_request(user, path='/api/v1/berths/', remote_addr='1.2.3.4'):
    """Create a minimal DRF request object with user and META set."""
    factory = RequestFactory()
    raw = factory.get(path, REMOTE_ADDR=remote_addr)
    raw.user = user
    return raw


class TestIPAllowlistPermission:
    """Unit-tests the IPAllowlistPermission DRF permission class directly."""

    def _perm(self):
        from apps.security.permissions import IPAllowlistPermission
        return IPAllowlistPermission()

    def test_empty_allowlist_allows_all(self, db, marina, owner_user):
        """Empty allowlist = feature off, any request passes."""
        request = _make_request(owner_user, remote_addr='10.0.0.1')
        perm = self._perm()
        assert perm.has_permission(request, view=None) is True

    def test_exact_ipv4_match_allowed(self, db, marina, owner_user):
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.5/32', created_by=owner_user)
        request = _make_request(owner_user, remote_addr='203.0.113.5')
        assert self._perm().has_permission(request, None) is True

    def test_cidr24_match_allowed(self, db, marina, owner_user):
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/24', created_by=owner_user)
        request = _make_request(owner_user, remote_addr='203.0.113.99')
        assert self._perm().has_permission(request, None) is True

    def test_non_matching_ip_rejected(self, db, marina, owner_user):
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/24', created_by=owner_user)
        request = _make_request(owner_user, remote_addr='198.51.100.1')
        result = self._perm().has_permission(request, None)
        assert result is False

    def test_ipv6_match_allowed(self, db, marina, owner_user):
        MarinaIPAllowlist.objects.create(marina=marina, cidr='2001:db8::/32', created_by=owner_user)
        request = _make_request(owner_user, remote_addr='2001:db8::1')
        assert self._perm().has_permission(request, None) is True

    def test_ipv6_non_match_rejected(self, db, marina, owner_user):
        MarinaIPAllowlist.objects.create(marina=marina, cidr='2001:db8::/32', created_by=owner_user)
        request = _make_request(owner_user, remote_addr='2001:db9::1')
        assert self._perm().has_permission(request, None) is False

    def test_boater_bypasses_allowlist(self, db, marina, boater_user):
        """Boaters are exempt from IP allowlist regardless of marina config."""
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/32', created_by=boater_user)
        request = _make_request(boater_user, remote_addr='198.51.100.1')
        assert self._perm().has_permission(request, None) is True

    def test_anonymous_user_passes_through(self, db):
        """Anonymous users are not blocked by the IP permission (DRF IsAuthenticated handles that)."""
        from django.contrib.auth.models import AnonymousUser
        factory = RequestFactory()
        raw = factory.get('/api/v1/berths/', REMOTE_ADDR='1.2.3.4')
        raw.user = AnonymousUser()
        assert self._perm().has_permission(raw, None) is True

    def test_user_without_marina_passes_through(self, db):
        """Platform admins (no marina) are not blocked."""
        user = User.objects.create_user(email='admin@plat.com', password='pass')
        # no marina FK
        request = _make_request(user, remote_addr='1.2.3.4')
        assert self._perm().has_permission(request, None) is True

    def test_exempt_path_auth_token(self, db, marina, owner_user):
        """Auth token endpoint bypasses IP check."""
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/32', created_by=owner_user)
        request = _make_request(owner_user, path='/api/v1/auth/token/', remote_addr='198.51.100.1')
        assert self._perm().has_permission(request, None) is True

    def test_exempt_path_ip_allowlist_list(self, db, marina, owner_user):
        """IP allowlist management endpoint bypasses IP check (escape hatch)."""
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/32', created_by=owner_user)
        request = _make_request(owner_user, path='/api/v1/security/ip-allowlist/', remote_addr='198.51.100.1')
        assert self._perm().has_permission(request, None) is True

    def test_exempt_path_ip_allowlist_detail(self, db, marina, owner_user):
        """IP allowlist detail (DELETE) endpoint bypasses IP check (escape hatch)."""
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/32', created_by=owner_user)
        request = _make_request(owner_user, path='/api/v1/security/ip-allowlist/3/', remote_addr='198.51.100.1')
        assert self._perm().has_permission(request, None) is True

    def test_non_exempt_path_blocked(self, db, marina, owner_user):
        """A normal berths endpoint from outside the allowlist is blocked."""
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/24', created_by=owner_user)
        request = _make_request(owner_user, path='/api/v1/berths/', remote_addr='198.51.100.1')
        assert self._perm().has_permission(request, None) is False

    def test_blocked_response_has_correct_code(self, db, marina, owner_user):
        """When blocked, the permission's message carries code 'ip_not_allowed'."""
        MarinaIPAllowlist.objects.create(marina=marina, cidr='203.0.113.0/24', created_by=owner_user)
        request = _make_request(owner_user, path='/api/v1/berths/', remote_addr='198.51.100.1')
        perm = self._perm()
        result = perm.has_permission(request, None)
        assert result is False
        assert 'ip_not_allowed' in str(perm.message)


# ---------------------------------------------------------------------------
# 3. Viewset tests via APIClient
# ---------------------------------------------------------------------------

class TestIPAllowlistViewSet:
    LIST_URL = '/api/v1/security/ip-allowlist/'

    def detail_url(self, pk):
        return f'/api/v1/security/ip-allowlist/{pk}/'

    # -- GET list
    def _results(self, resp):
        """Extract list from paginated or plain response."""
        data = resp.data
        if isinstance(data, dict) and 'results' in data:
            return data['results']
        return data

    def test_get_list_owner(self, db, api_client, owner_user, marina):
        api_client.force_authenticate(user=owner_user)
        MarinaIPAllowlist.objects.create(marina=marina, cidr='10.0.0.0/8', created_by=owner_user)
        resp = api_client.get(self.LIST_URL)
        assert resp.status_code == status.HTTP_200_OK
        results = self._results(resp)
        assert len(results) == 1
        assert results[0]['cidr'] == '10.0.0.0/8'

    def test_get_list_manager_forbidden(self, db, api_client, manager_user):
        api_client.force_authenticate(user=manager_user)
        resp = api_client.get(self.LIST_URL)
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_get_list_anonymous_unauthorized(self, db, api_client):
        resp = api_client.get(self.LIST_URL)
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    # -- POST create
    def test_post_creates_entry(self, db, api_client, owner_user, marina):
        api_client.force_authenticate(user=owner_user)
        resp = api_client.post(
            self.LIST_URL,
            {'cidr': '203.0.113.0/24', 'label': 'Office'},
            format='json',
            REMOTE_ADDR='203.0.113.1',
        )
        assert resp.status_code == status.HTTP_201_CREATED
        assert MarinaIPAllowlist.objects.filter(marina=marina, cidr='203.0.113.0/24').exists()

    def test_post_lockout_guard_rejects_when_ip_not_covered(self, db, api_client, owner_user, marina):
        """POST refuses if caller's IP would not be covered by the new full allowlist."""
        api_client.force_authenticate(user=owner_user)
        resp = api_client.post(
            self.LIST_URL,
            {'cidr': '203.0.113.0/24', 'label': 'Office'},
            format='json',
            REMOTE_ADDR='198.51.100.1',  # NOT in 203.0.113.0/24
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert 'ip_not_allowed' in str(resp.data).lower() or 'not covered' in str(resp.data).lower() or 'lock' in str(resp.data).lower()

    def test_post_lockout_guard_allows_when_ip_is_covered(self, db, api_client, owner_user, marina):
        """POST succeeds when the caller's IP IS covered by the new entry."""
        # pre-existing entry for a different range (not covering our IP)
        # caller is 203.0.113.5 — new entry 203.0.113.0/24 covers it → OK
        api_client.force_authenticate(user=owner_user)
        resp = api_client.post(
            self.LIST_URL,
            {'cidr': '203.0.113.0/24', 'label': 'Office'},
            format='json',
            REMOTE_ADDR='203.0.113.5',
        )
        assert resp.status_code == status.HTTP_201_CREATED

    def test_post_manager_forbidden(self, db, api_client, manager_user):
        api_client.force_authenticate(user=manager_user)
        resp = api_client.post(
            self.LIST_URL,
            {'cidr': '203.0.113.0/24'},
            format='json',
            REMOTE_ADDR='203.0.113.1',
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    # -- DELETE
    def test_delete_owner_succeeds(self, db, api_client, owner_user, marina):
        entry = MarinaIPAllowlist.objects.create(marina=marina, cidr='10.0.0.0/8', created_by=owner_user)
        api_client.force_authenticate(user=owner_user)
        resp = api_client.delete(self.detail_url(entry.pk), REMOTE_ADDR='10.0.0.1')
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not MarinaIPAllowlist.objects.filter(pk=entry.pk).exists()

    def test_delete_manager_forbidden(self, db, api_client, manager_user, marina, owner_user):
        entry = MarinaIPAllowlist.objects.create(marina=marina, cidr='10.0.0.0/8', created_by=owner_user)
        api_client.force_authenticate(user=manager_user)
        resp = api_client.delete(self.detail_url(entry.pk))
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_delete_anonymous_unauthorized(self, db, api_client, marina, owner_user):
        entry = MarinaIPAllowlist.objects.create(marina=marina, cidr='10.0.0.0/8', created_by=owner_user)
        resp = api_client.delete(self.detail_url(entry.pk))
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    # -- Roaming owner: DELETE from outside the allowlist
    def test_roaming_owner_delete_from_outside_allowlist_succeeds(self, db, api_client, owner_user, marina):
        """
        Owner adds a /32 entry for IP 203.0.113.0 from that same IP.
        Then simulates a DELETE from 198.51.100.0 (outside the allowlist).
        The DELETE must succeed — this is the explicit escape hatch.
        """
        # The ip-allowlist endpoint is exempt, so no IP blocking on these requests
        # even if the allowlist were enforced.
        entry = MarinaIPAllowlist.objects.create(
            marina=marina,
            cidr='203.0.113.0/32',
            created_by=owner_user,
        )
        api_client.force_authenticate(user=owner_user)
        # DELETE from an IP outside the allowlist — must succeed
        resp = api_client.delete(
            self.detail_url(entry.pk),
            REMOTE_ADDR='198.51.100.0',
        )
        assert resp.status_code == status.HTTP_204_NO_CONTENT
        assert not MarinaIPAllowlist.objects.filter(pk=entry.pk).exists()

    def test_roaming_owner_get_list_from_outside_allowlist_succeeds(self, db, api_client, owner_user, marina):
        """Owner can still GET the list from outside the allowlist (exempt path)."""
        MarinaIPAllowlist.objects.create(
            marina=marina,
            cidr='203.0.113.0/32',
            created_by=owner_user,
        )
        api_client.force_authenticate(user=owner_user)
        resp = api_client.get(self.LIST_URL, REMOTE_ADDR='198.51.100.0')
        assert resp.status_code == status.HTTP_200_OK

    def test_serializer_includes_created_by_email(self, db, api_client, owner_user, marina):
        MarinaIPAllowlist.objects.create(marina=marina, cidr='10.0.0.1/32', created_by=owner_user)
        api_client.force_authenticate(user=owner_user)
        resp = api_client.get(self.LIST_URL)
        assert resp.status_code == 200
        results = self._results(resp)
        assert results[0]['created_by_email'] == owner_user.email


# ---------------------------------------------------------------------------
# 4. WhoamiIPView
# ---------------------------------------------------------------------------

class TestWhoamiIPView:
    URL = '/api/v1/security/whoami-ip/'

    def test_returns_client_ip(self, db, api_client, owner_user):
        api_client.force_authenticate(user=owner_user)
        resp = api_client.get(self.URL, REMOTE_ADDR='203.0.113.42')
        assert resp.status_code == 200
        assert resp.data['ip'] == '203.0.113.42'

    def test_anonymous_unauthorized(self, db, api_client):
        resp = api_client.get(self.URL)
        assert resp.status_code == 401
