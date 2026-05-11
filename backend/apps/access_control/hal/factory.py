"""
apps/access_control/hal/factory.py

Factory functions that return the correct HAL adapter for a given marina.
The adapter key is read from marina.features (a JSONField on the Marina model):
  - marina.features['rfid_adapter']       → RFID_ADAPTERS key
  - marina.features['anpr_adapter']       → ANPR_ADAPTERS key
  - marina.features['biometric_adapter']  → BIOMETRIC_ADAPTERS key

If the key is absent or unrecognised, the Demo adapter is used (safe fallback for dev/test).
"""

from apps.access_control.hal.base import AccessControlAdapter, ANPRAdapter, BiometricAdapter
from apps.access_control.hal.adapters.demo import DemoAccessAdapter, DemoANPRAdapter, DemoBiometricAdapter

# ---------------------------------------------------------------------------
# Adapter registries
# Add vendor adapters here as they are implemented (import them above first).
# ---------------------------------------------------------------------------

RFID_ADAPTERS: dict[str, type[AccessControlAdapter]] = {
    'demo': DemoAccessAdapter,
    # 'paxton_net2': PaxtonNet2Adapter,   # priority 1 — Paxton dominates UK/EU SME market
    # 'salto':       SaltoAdapter,        # priority 2 — wireless, battery-powered pontoon locks
    # 'hid_vertx':   HIDVertxAdapter,     # later cycle
}

ANPR_ADAPTERS: dict[str, type[ANPRAdapter]] = {
    'demo': DemoANPRAdapter,
    # 'genetec':    GenetecANPRAdapter,
    # 'milestone':  MilestoneANPRAdapter,
}

BIOMETRIC_ADAPTERS: dict[str, type[BiometricAdapter]] = {
    'demo': DemoBiometricAdapter,
    # 'zkteco':  ZKTecoAdapter,
    # 'suprema': SupremaAdapter,
}


def get_rfid_adapter(marina) -> AccessControlAdapter:
    """Return the RFID/NFC adapter configured for this marina."""
    key = (marina.features or {}).get('rfid_adapter', 'demo')
    cls = RFID_ADAPTERS.get(key, DemoAccessAdapter)
    return cls(marina)


def get_anpr_adapter(marina) -> ANPRAdapter:
    """Return the ANPR camera adapter configured for this marina."""
    key = (marina.features or {}).get('anpr_adapter', 'demo')
    cls = ANPR_ADAPTERS.get(key, DemoANPRAdapter)
    return cls(marina)


def get_biometric_adapter(marina) -> BiometricAdapter:
    """Return the biometric terminal adapter configured for this marina."""
    key = (marina.features or {}).get('biometric_adapter', 'demo')
    cls = BIOMETRIC_ADAPTERS.get(key, DemoBiometricAdapter)
    return cls(marina)
