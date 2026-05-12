from django.test import TestCase
from unittest.mock import MagicMock
from rest_framework.exceptions import PermissionDenied
from apps.portal.permissions import require_feature


class RequireFeatureTest(TestCase):
    def _make_member(self, app_config):
        member = MagicMock()
        member.marina.app_config = app_config
        return member

    def test_passes_when_feature_enabled(self):
        member = self._make_member({'enable_boatyard': True})
        require_feature(member, 'enable_boatyard')  # Should not raise

    def test_raises_403_when_feature_disabled(self):
        member = self._make_member({'enable_boatyard': False})
        with self.assertRaises(PermissionDenied):
            require_feature(member, 'enable_boatyard')

    def test_raises_403_when_feature_missing_from_config(self):
        member = self._make_member({})
        with self.assertRaises(PermissionDenied):
            require_feature(member, 'enable_utilities')

    def test_passes_when_feature_missing_but_default_true(self):
        member = self._make_member({})
        require_feature(member, 'enable_boatyard', default=True)  # Should not raise
