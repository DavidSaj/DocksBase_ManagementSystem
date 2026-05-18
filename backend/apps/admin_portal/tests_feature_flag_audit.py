"""Tests for per-flag audit logging when admin toggles marina feature flags."""

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.admin_portal.models import AuditLog


def make_marina(**kwargs):
    defaults = dict(name='Test Marina', status='active', currency='EUR', features={})
    defaults.update(kwargs)
    return Marina.objects.create(**defaults)


def make_admin():
    return User.objects.create_user(
        email='admin@test.com', password='pass',
        is_platform_admin=True, platform_role='admin',
    )


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    refresh['is_platform_admin'] = user.is_platform_admin
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


class FeatureFlagAuditLogTest(TestCase):
    def setUp(self):
        self.admin = make_admin()
        self.marina = make_marina(features={'guest_booking': True, 'esign': False})
        self.client = APIClient()
        auth(self.client, self.admin)

    def test_toggle_single_flag_off_creates_audit(self):
        resp = self.client.patch(
            f'/api/v1/admin/marinas/{self.marina.pk}/',
            {'features': {'guest_booking': False, 'esign': False}},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        logs = AuditLog.objects.filter(
            action='toggle_feature_flag', target_marina=self.marina
        )
        self.assertEqual(logs.count(), 1)
        log = logs.first()
        self.assertEqual(log.detail['flag'], 'guest_booking')
        self.assertTrue(log.detail['before'])
        self.assertFalse(log.detail['after'])

    def test_toggle_multiple_flags_creates_one_audit_per_flag(self):
        resp = self.client.patch(
            f'/api/v1/admin/marinas/{self.marina.pk}/',
            {'features': {'guest_booking': False, 'esign': True, 'loyalty': True}},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        logs = AuditLog.objects.filter(
            action='toggle_feature_flag', target_marina=self.marina
        )
        # guest_booking: T→F, esign: F→T, loyalty: undef→T — three flips
        self.assertEqual(logs.count(), 3)
        flipped = {log.detail['flag'] for log in logs}
        self.assertEqual(flipped, {'guest_booking', 'esign', 'loyalty'})

    def test_no_audit_when_flag_value_unchanged(self):
        resp = self.client.patch(
            f'/api/v1/admin/marinas/{self.marina.pk}/',
            {'features': {'guest_booking': True, 'esign': False}},  # identical
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            AuditLog.objects.filter(action='toggle_feature_flag').exists()
        )

    def test_reason_field_is_captured(self):
        resp = self.client.patch(
            f'/api/v1/admin/marinas/{self.marina.pk}/',
            {
                'features': {'guest_booking': False, 'esign': False},
                'reason': 'Customer requested',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        log = AuditLog.objects.get(action='toggle_feature_flag')
        self.assertEqual(log.detail['reason'], 'Customer requested')

    def test_non_features_patch_still_uses_update_marina_action(self):
        resp = self.client.patch(
            f'/api/v1/admin/marinas/{self.marina.pk}/',
            {'plan': 'enterprise'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(action='update_marina', target_marina=self.marina).exists()
        )
        self.assertFalse(
            AuditLog.objects.filter(action='toggle_feature_flag').exists()
        )

    def test_non_admin_cannot_toggle(self):
        regular = User.objects.create_user(email='u@test.com', password='pass')
        auth(self.client, regular)
        resp = self.client.patch(
            f'/api/v1/admin/marinas/{self.marina.pk}/',
            {'features': {'guest_booking': False}},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(AuditLog.objects.filter(action='toggle_feature_flag').exists())
