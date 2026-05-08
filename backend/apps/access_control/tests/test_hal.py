"""
tests/test_hal.py

HAL factory and demo adapter tests.
"""

import pytest
from unittest.mock import MagicMock


class TestHALFactory:

    def _make_marina(self, features=None):
        m = MagicMock()
        m.pk = 1
        m.features = features or {}
        return m

    def test_factory_returns_demo_adapter_by_default(self):
        from apps.access_control.hal.factory import get_rfid_adapter
        from apps.access_control.hal.adapters.demo import DemoAccessAdapter
        marina = self._make_marina()
        adapter = get_rfid_adapter(marina)
        assert isinstance(adapter, DemoAccessAdapter)

    def test_factory_reads_rfid_adapter_from_marina_features(self):
        from apps.access_control.hal.factory import get_rfid_adapter, RFID_ADAPTERS
        from apps.access_control.hal.adapters.demo import DemoAccessAdapter
        # 'demo' key explicitly set
        marina = self._make_marina({'rfid_adapter': 'demo'})
        adapter = get_rfid_adapter(marina)
        assert isinstance(adapter, DemoAccessAdapter)

    def test_factory_unknown_key_falls_back_to_demo(self):
        from apps.access_control.hal.factory import get_rfid_adapter
        from apps.access_control.hal.adapters.demo import DemoAccessAdapter
        marina = self._make_marina({'rfid_adapter': 'nonexistent_vendor'})
        adapter = get_rfid_adapter(marina)
        assert isinstance(adapter, DemoAccessAdapter)

    def test_demo_adapter_grant_returns_true(self):
        from apps.access_control.hal.adapters.demo import DemoAccessAdapter
        from apps.access_control.hal.base import CardCredential
        marina  = self._make_marina()
        adapter = DemoAccessAdapter(marina)
        result  = adapter.grant_access('READER01', CardCredential(card_uid='AABB'))
        assert result is True

    def test_demo_adapter_revoke_returns_true(self):
        from apps.access_control.hal.adapters.demo import DemoAccessAdapter
        from apps.access_control.hal.base import CardCredential
        marina  = self._make_marina()
        adapter = DemoAccessAdapter(marina)
        result  = adapter.revoke_access('READER01', CardCredential(card_uid='AABB'))
        assert result is True

    def test_demo_biometric_revoke_returns_true(self):
        from apps.access_control.hal.adapters.demo import DemoBiometricAdapter
        marina  = self._make_marina()
        adapter = DemoBiometricAdapter(marina)
        result  = adapter.revoke_face('TERM01', 'handle_xyz')
        assert result is True
