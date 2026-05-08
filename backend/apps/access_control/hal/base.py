"""
apps/access_control/hal/base.py

Hardware Abstraction Layer — Abstract Base Classes.
All vendor-specific SDK code lives in adapters/; business logic never imports from there directly.
Use the factory functions in hal/factory.py to get the right adapter for a marina.
"""

import abc
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CardCredential:
    """Normalised card credential passed to HAL methods."""
    card_uid:      str
    facility_code: str = ''
    member_id:     Optional[int] = None


@dataclass
class ReaderStatus:
    """Status snapshot returned by get_reader_status()."""
    reader_uid:    str
    online:        bool
    firmware:      str = ''
    last_seen_iso: str = ''
    extra:         dict = field(default_factory=dict)


class AccessControlAdapter(abc.ABC):
    """
    Abstract base for RFID/NFC access control hardware (Paxton Net2, Salto, HID Vertx, …).
    All methods must be idempotent — DocksBase may call them multiple times.
    """

    def __init__(self, marina):
        self.marina = marina

    @abc.abstractmethod
    def grant_access(self, reader_uid: str, credential: CardCredential) -> bool:
        """
        Add credential to reader's allow-list.
        Returns True on success, False on hardware failure (do NOT raise for hardware errors).
        """

    @abc.abstractmethod
    def revoke_access(self, reader_uid: str, credential: CardCredential) -> bool:
        """
        Remove credential from reader's allow-list.
        Returns True on success, False on hardware failure.
        """

    @abc.abstractmethod
    def sync_zone(self, reader_uid: str, allowed_credentials: list[CardCredential]) -> bool:
        """
        Full replace of the reader's credential table with allowed_credentials.
        Preferred over repeated grant/revoke when reader supports bulk sync.
        """

    @abc.abstractmethod
    def get_reader_status(self, reader_uid: str) -> ReaderStatus:
        """Return current status of the reader (online, firmware version, etc.)."""

    @abc.abstractmethod
    def register_webhook(self, reader_uid: str, webhook_url: str, secret: str) -> bool:
        """
        Register DocksBase ingest endpoint as the reader's event webhook.
        Called once during reader onboarding.
        """


class ANPRAdapter(abc.ABC):
    """Abstract base for ANPR camera systems (Genetec, Milestone, embedded cameras, …)."""

    def __init__(self, marina):
        self.marina = marina

    @abc.abstractmethod
    def get_recent_reads(self, camera_uid: str, limit: int = 50) -> list[dict]:
        """
        Poll the camera for recent plate reads.
        Each dict must have: plate (str), confidence (float 0–1), occurred_at (ISO-8601 str).
        """

    @abc.abstractmethod
    def register_webhook(self, camera_uid: str, webhook_url: str, secret: str) -> bool:
        """Register DocksBase ANPR ingest endpoint as the camera's push target."""

    def normalise(self, raw_payload: dict) -> dict:
        """
        Convert vendor webhook payload into the DocksBase normalised format:
        {'camera_uid': str, 'plate': str, 'confidence': float, 'occurred_at': str}
        Override in concrete adapters. Default: pass-through (for demo adapter).
        """
        return raw_payload


class BiometricAdapter(abc.ABC):
    """Abstract base for biometric terminal SDKs (ZKTeco, Suprema, Dahua, …)."""

    def __init__(self, marina):
        self.marina = marina

    @abc.abstractmethod
    def enrol_face(self, terminal_uid: str, member_id: int, image_bytes: bytes) -> str:
        """
        Enrol a face template on the terminal.
        Returns an opaque handle string to store in BiometricEnrolment.template_handle.
        Raises on failure.
        """

    @abc.abstractmethod
    def revoke_face(self, terminal_uid: str, template_handle: str) -> bool:
        """
        Delete the face template from the terminal.
        Returns True on success, False if terminal is unreachable (retriable).
        Raises only for unrecoverable errors.
        """

    @abc.abstractmethod
    def get_terminal_status(self, terminal_uid: str) -> dict:
        """Return {'online': bool, 'firmware': str, 'enrolled_count': int}."""
