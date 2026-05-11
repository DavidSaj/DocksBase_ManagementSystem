"""
apps/access_control/hal/adapters/demo.py

Demo/simulator adapters for development and testing.
All methods log their call and return success values.
These are the only adapters shipped in v1.

Vendor stubs (commented out — priority order for v2):
  - PaxtonNet2Adapter   — dominates UK/EU SME market
  - SaltoAdapter        — wireless, battery-powered pontoon locks
  - HIDVertxAdapter     — enterprise / larger marinas
"""

import logging

from apps.access_control.hal.base import (
    AccessControlAdapter,
    ANPRAdapter,
    BiometricAdapter,
    CardCredential,
    ReaderStatus,
)

logger = logging.getLogger(__name__)


class DemoAccessAdapter(AccessControlAdapter):
    """
    Simulates an RFID access control system.
    All calls are logged at DEBUG level and return True (success).
    """

    def grant_access(self, reader_uid: str, credential: CardCredential) -> bool:
        logger.debug(
            "[DEMO] grant_access marina=%s reader=%s card_uid=%s",
            self.marina.pk, reader_uid, credential.card_uid,
        )
        return True

    def revoke_access(self, reader_uid: str, credential: CardCredential) -> bool:
        logger.debug(
            "[DEMO] revoke_access marina=%s reader=%s card_uid=%s",
            self.marina.pk, reader_uid, credential.card_uid,
        )
        return True

    def sync_zone(self, reader_uid: str, allowed_credentials: list[CardCredential]) -> bool:
        logger.debug(
            "[DEMO] sync_zone marina=%s reader=%s credentials_count=%d",
            self.marina.pk, reader_uid, len(allowed_credentials),
        )
        return True

    def get_reader_status(self, reader_uid: str) -> ReaderStatus:
        logger.debug(
            "[DEMO] get_reader_status marina=%s reader=%s",
            self.marina.pk, reader_uid,
        )
        return ReaderStatus(
            reader_uid=reader_uid,
            online=True,
            firmware='demo-v1.0',
            last_seen_iso='',
        )

    def register_webhook(self, reader_uid: str, webhook_url: str, secret: str) -> bool:
        logger.debug(
            "[DEMO] register_webhook marina=%s reader=%s url=%s",
            self.marina.pk, reader_uid, webhook_url,
        )
        return True


class DemoANPRAdapter(ANPRAdapter):
    """Simulates an ANPR camera system."""

    def get_recent_reads(self, camera_uid: str, limit: int = 50) -> list[dict]:
        logger.debug(
            "[DEMO] get_recent_reads marina=%s camera=%s limit=%d",
            self.marina.pk, camera_uid, limit,
        )
        return []

    def register_webhook(self, camera_uid: str, webhook_url: str, secret: str) -> bool:
        logger.debug(
            "[DEMO] ANPR register_webhook marina=%s camera=%s url=%s",
            self.marina.pk, camera_uid, webhook_url,
        )
        return True

    def normalise(self, raw_payload: dict) -> dict:
        # Demo adapter: payload is already in DocksBase format
        return raw_payload


class DemoBiometricAdapter(BiometricAdapter):
    """Simulates a biometric terminal SDK."""

    def enrol_face(self, terminal_uid: str, member_id: int, image_bytes: bytes) -> str:
        logger.debug(
            "[DEMO] enrol_face marina=%s terminal=%s member=%s",
            self.marina.pk, terminal_uid, member_id,
        )
        return f"demo_handle_{member_id}_{terminal_uid}"

    def revoke_face(self, terminal_uid: str, template_handle: str) -> bool:
        logger.debug(
            "[DEMO] revoke_face marina=%s terminal=%s handle=%s",
            self.marina.pk, terminal_uid, template_handle,
        )
        return True

    def get_terminal_status(self, terminal_uid: str) -> dict:
        logger.debug(
            "[DEMO] get_terminal_status marina=%s terminal=%s",
            self.marina.pk, terminal_uid,
        )
        return {'online': True, 'firmware': 'demo-v1.0', 'enrolled_count': 0}
