# Track 11 — Security & Physical Access Control: Design Spec
Date: 2026-05-07
Scope: New `access_control` Django app — RFID multi-reader access control, ANPR vehicle recognition, searchable CCTV event-linking, biometric authentication (face enrolment + gate + staff clock-in), and fraud prevention / spend authorisation workflows. Covers hardware abstraction layer, GDPR-compliant biometric handling, API contract, and frontend architecture.

Reference: `new_features.md` §24.1–§24.5 and Track 11 model list.

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

Track 11 introduces physical security as a first-class DocksBase concern. The primary risk is **hardware lock-in**: RFID readers, ANPR cameras, and biometric terminals each ship with proprietary SDKs. The architectural goal is to ensure DocksBase never couples business logic to a specific vendor's SDK.

The solution is a **Hardware Abstraction Layer (HAL)**: a set of Python abstract base classes that every vendor adapter must implement. Core DocksBase code calls only the HAL interfaces. Swapping from Paxton to Salto, or from one ANPR vendor to another, requires writing a new adapter class — not modifying models, views, or services.

The secondary goal is **zero-configuration propagation**: when a member's contract activates, expires, or is suspended, access permissions update automatically without any manual re-programming of physical hardware. This is achieved by treating the `AccessCard` and `ZoneAccessRule` as the authority, and having the HAL push changes to readers on write.

The `access_control` app is a **new Django app** to be added to `INSTALLED_APPS`. All models carry the standard `marina = ForeignKey('accounts.Marina')` multi-tenancy FK.

---

## 2. Hardware Abstraction Layer

### 2.1 Design Principle

The HAL is a set of Python Abstract Base Classes in `backend/apps/access_control/hal/base.py`. No view, model, or service imports a vendor SDK directly. Vendor adapters live in `backend/apps/access_control/hal/adapters/` and are selected at runtime via `Marina.features['access_control_adapter']` (a string key such as `'paxton_net2'`, `'salto'`, `'hid_vertx'`, `'demo'`).

A factory function `get_adapter(marina: Marina) -> AccessControlAdapter` instantiates the correct adapter. If no adapter key is configured, it returns the `DemoAdapter` (logs all calls, always returns success — safe for development and demo marinas).

**Priority adapter build order:** Paxton Net2/10 first, Salto second. Paxton dominates the SME commercial space in the UK and Europe, which overlaps directly with marina offices and gatehouses. Salto is the gold standard for wireless, battery-operated door locks — critical for floating pontoons and shower blocks where running ethernet or power is impractical. HID Global adapters can follow in a later cycle.

### 2.2 RFID Reader Adapter ABC

```python
# backend/apps/access_control/hal/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class CardCredential:
    card_number: str          # Raw card UID as hex string
    facility_code: str = ''   # HID-style facility code, empty for simple UID systems


@dataclass
class ReaderStatus:
    reader_uid: str           # Matches AccessReader.reader_uid in DB
    online: bool
    last_seen: Optional[datetime]
    firmware_version: str = ''


class AccessControlAdapter(ABC):
    """
    Vendor-agnostic interface for RFID/NFC access control hardware.
    All methods are synchronous; callers run them in a thread pool via
    Django's async_to_sync or Celery tasks — never in a request/response cycle.
    """

    @abstractmethod
    def grant_access(self, reader_uid: str, card: CardCredential) -> bool:
        """
        Tell the physical reader to permit entry for this card credential.
        Returns True if the reader acknowledged the change.
        Should be called after an AccessCard is activated or a ZoneAccessRule changes.
        """

    @abstractmethod
    def revoke_access(self, reader_uid: str, card: CardCredential) -> bool:
        """
        Tell the physical reader to deny entry for this card credential.
        Should be called immediately when a card is deactivated or a contract lapses.
        """

    @abstractmethod
    def sync_zone(self, reader_uid: str, allowed_cards: list[CardCredential]) -> bool:
        """
        Full replace: push the complete set of allowed cards for a reader.
        Used on first configuration and periodic re-sync (nightly Celery task).
        Prefer grant_access/revoke_access for incremental changes.
        """

    @abstractmethod
    def get_reader_status(self, reader_uid: str) -> ReaderStatus:
        """
        Poll the reader for online/offline status and firmware version.
        Used by the health-check Celery beat task (every 5 minutes).
        """

    @abstractmethod
    def register_webhook(self, reader_uid: str, callback_url: str) -> bool:
        """
        Instruct the reader controller to POST access events to callback_url.
        Format of the POST body is vendor-specific; the adapter is responsible
        for normalising it into an AccessEvent record in the webhook view.
        """


class ANPRAdapter(ABC):
    """
    Vendor-agnostic interface for ANPR camera systems.
    DocksBase does not store images or video — only normalised plate strings.
    """

    @abstractmethod
    def get_recent_reads(
        self,
        camera_uid: str,
        since: datetime,
    ) -> list[dict]:
        """
        Returns a list of dicts: {plate: str, confidence: float, timestamp: datetime}.
        Confidence threshold filtering (e.g. < 0.85 discarded) is done inside the adapter.
        """

    @abstractmethod
    def register_webhook(self, camera_uid: str, callback_url: str) -> bool:
        """
        Instruct the ANPR camera to POST plate reads to callback_url.
        Adapter normalises vendor payload into ANPREvent records.
        """


class BiometricAdapter(ABC):
    """
    Vendor-agnostic interface for biometric terminal hardware (face recognition).
    CRITICAL: This interface NEVER transmits or receives raw biometric data.
    Enrolment happens on the terminal. DocksBase stores only an opaque
    encrypted template handle issued by the terminal SDK.
    """

    @abstractmethod
    def enrol_face(self, terminal_uid: str, subject_id: str) -> str:
        """
        Initiate face enrolment on the terminal for subject_id (member or staff UUID).
        Returns an opaque template_handle string issued by the terminal SDK.
        DocksBase stores template_handle in BiometricEnrolment.template_handle.
        Raw biometric data never leaves the terminal.
        """

    @abstractmethod
    def revoke_face(self, terminal_uid: str, template_handle: str) -> bool:
        """
        Delete the enrolment from the terminal.
        Called on member departure, right-to-erasure request, or manual revocation.
        After this call succeeds, the BiometricEnrolment record is also deleted from DB.
        """

    @abstractmethod
    def get_terminal_status(self, terminal_uid: str) -> ReaderStatus:
        """Poll terminal for health check."""
```

### 2.3 Adapter Factory

```python
# backend/apps/access_control/hal/factory.py
from .base import AccessControlAdapter, ANPRAdapter, BiometricAdapter
from .adapters.demo import DemoAccessAdapter, DemoANPRAdapter, DemoBiometricAdapter

RFID_ADAPTERS: dict[str, type[AccessControlAdapter]] = {
    'demo':        DemoAccessAdapter,
    # 'paxton_net2': PaxtonNet2Adapter,   # priority 1
    # 'salto':       SaltoAdapter,         # priority 2
    # 'hid_vertx':   HIDVertxAdapter,      # later cycle
}

ANPR_ADAPTERS: dict[str, type[ANPRAdapter]] = {
    'demo': DemoANPRAdapter,
}

BIOMETRIC_ADAPTERS: dict[str, type[BiometricAdapter]] = {
    'demo': DemoBiometricAdapter,
}


def get_rfid_adapter(marina) -> AccessControlAdapter:
    key = (marina.features or {}).get('rfid_adapter', 'demo')
    cls = RFID_ADAPTERS.get(key, DemoAccessAdapter)
    return cls(marina)


def get_anpr_adapter(marina) -> ANPRAdapter:
    key = (marina.features or {}).get('anpr_adapter', 'demo')
    cls = ANPR_ADAPTERS.get(key, DemoANPRAdapter)
    return cls(marina)


def get_biometric_adapter(marina) -> BiometricAdapter:
    key = (marina.features or {}).get('biometric_adapter', 'demo')
    cls = BIOMETRIC_ADAPTERS.get(key, DemoBiometricAdapter)
    return cls(marina)
```

### 2.4 Event Ingestion Webhook View

The hardware pushes events to DocksBase via webhooks. Each adapter normalises its vendor payload before saving. The ingest endpoint is:

```
POST /api/v1/access-control/ingest/rfid/
POST /api/v1/access-control/ingest/anpr/
POST /api/v1/access-control/ingest/biometric/
```

These endpoints are authenticated by a per-marina HMAC secret (`Marina.features['access_webhook_secret']`). The view calls the appropriate adapter's normalisation method and writes the relevant event model. All three endpoints return `204 No Content` on success to minimise reader retry logic.

**ANPR ingest debounce (mandatory):** ANPR cameras fire 15–30 webhook frames per vehicle pass over a 5-second window as the car moves toward the gate. The ingest view must suppress duplicates using a Redis debounce cache before creating any `ANPREvent` row or triggering gate logic:

```python
# access_control/views/ingest.py  — ANPR ingest handler
import redis
from django.conf import settings

def anpr_ingest(request, marina):
    payload = anpr_adapter.normalise(request.data)
    camera_uid   = payload['camera_uid']
    plate        = payload['plate'].upper().replace(' ', '')
    confidence   = payload['confidence']

    if confidence < marina.features.get('anpr_confidence_threshold', 0.85):
        return Response(status=204)   # below confidence floor — drop silently

    debounce_key = f"anpr:{marina.pk}:{camera_uid}:{plate}"
    r = redis.from_url(settings.REDIS_URL)
    if r.exists(debounce_key):
        return Response(status=204)   # duplicate frame — drop silently
    r.setex(debounce_key, 60, '1')   # 60-second debounce window per (camera, plate) pair

    # First read in this window — create the ANPREvent and trigger gate logic
    ANPREvent.objects.create(...)
    trigger_gate_if_authorised(marina, plate)
    return Response(status=204)
```

The 60-second TTL is configurable via `Marina.features['anpr_debounce_seconds']` (default `60`). If the same plate re-enters the frame after 60 seconds (a second genuine pass, e.g. circling the car park), the key has expired and a new `ANPREvent` is created normally.

---

## 3. Data Models

All models live in `backend/apps/access_control/models.py`. All carry `marina = ForeignKey('accounts.Marina', on_delete=models.CASCADE)`.

### 3.1 Access Zones and Readers

```python
class AccessZone(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_zones')
    name = models.CharField(max_length=100)          # e.g. "Pier A", "Shower Block", "Boatyard"
    description = models.CharField(max_length=300, blank=True)
    is_restricted = models.BooleanField(default=False)  # True = staff-only areas

    class Meta:
        ordering = ['name']
        unique_together = ['marina', 'name']

    def __str__(self):
        return self.name


class AccessReader(models.Model):
    HARDWARE_TYPE = [
        ('rfid',      'RFID/NFC Reader'),
        ('anpr',      'ANPR Camera'),
        ('biometric', 'Biometric Terminal'),
        ('keypad',    'PIN Keypad'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_readers')
    zone = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='readers')
    reader_uid = models.CharField(max_length=100)    # Vendor-assigned hardware UID
    location_label = models.CharField(max_length=200)  # Human label: "Main Gate — Entry"
    hardware_type = models.CharField(max_length=20, choices=HARDWARE_TYPE, default='rfid')
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    last_heartbeat = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        unique_together = ['marina', 'reader_uid']

    def __str__(self):
        return f"{self.location_label} ({self.reader_uid})"
```

### 3.2 Zone Access Rules (Membership Type → Zone Mapping)

```python
class ZoneAccessRule(models.Model):
    """
    Maps a member_type to the set of zones it can access.
    One rule per member_type per marina. Zones is an M2M.

    GRANULARITY WARNING: A flat member_type → zones mapping grants the same set
    of zones to every member of that type. At a marina with 15 piers, this means
    every Seasonal member would get every pier gate — or the manager must manually
    override thousands of cards using AccessCard.zones_override.

    Use link_to_berth_pier=True for zone types that must be spatially scoped to the
    member's actual berth location. The access engine then performs a spatial check
    instead of a flat member_type lookup.
    """
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='zone_rules')
    member_type = models.CharField(
        max_length=20,
        choices=Member.TYPE_CHOICES,   # seasonal / transient / associate
    )
    zones = models.ManyToManyField(AccessZone, blank=True, related_name='rules')

    link_to_berth_pier = models.BooleanField(
        default=False,
        help_text=(
            "When True, the zones M2M above is ignored for access evaluation. "
            "Access is granted dynamically: the engine checks whether the member's "
            "active Booking or Contract berth physically resides inside the requested "
            "AccessZone (matched by AccessZone.name == Berth.pier_label). "
            "This prevents Pier A seasonal members from presenting a card at Pier F. "
            "AccessCard.zones_override still takes precedence over this flag."
        ),
    )

    class Meta:
        unique_together = ['marina', 'member_type']

    def __str__(self):
        return f"{self.marina} — {self.member_type}"
```

**Spatial access evaluation engine** (`access_control/services/zone_engine.py`):

```python
def member_can_access_zone(member, zone, as_of=None) -> bool:
    """
    Resolve whether a member is permitted to enter zone at the given moment.
    Called by the RFID ingest view for every card presentation.

    Resolution order:
    1. AccessCard.zones_override (if set on the presented card) — always wins.
    2. ZoneAccessRule.link_to_berth_pier=True — spatial pier check:
       does the member's active berth reside inside this zone?
    3. ZoneAccessRule.zones M2M flat list — member_type membership check.
    4. Default deny.
    """
    from datetime import date
    as_of = as_of or date.today()

    rule = ZoneAccessRule.objects.filter(
        marina=member.marina, member_type=member.member_type
    ).first()
    if rule is None:
        return False

    if rule.link_to_berth_pier:
        # Spatial check: member's active berth pier must match this zone's name.
        # Berth.pier_label is the short pier identifier, e.g. "Pier A".
        # AccessZone.name is set to the same value, e.g. "Pier A".
        from reservations.models import Booking
        from members.models import Contract
        active_berth_zone_names = set(
            Booking.objects.filter(
                member=member,
                status='confirmed',
                arrival_date__lte=as_of,
                departure_date__gte=as_of,
            ).values_list('berth__pier_label', flat=True)
        ) | set(
            Contract.objects.filter(
                member=member,
                status='active',
                start_date__lte=as_of,
                end_date__gte=as_of,
            ).values_list('berth__pier_label', flat=True)
        )
        return zone.name in active_berth_zone_names

    # Flat member_type zone list
    return rule.zones.filter(pk=zone.pk).exists()
```

`Berth.pier_label` is a `CharField(max_length=50, blank=True)` addition to the existing `Berth` model — populated from the map editor's pier grouping data. The migration for this field must precede the `access_control` app migration.

### 3.3 Access Cards

Card issuance uses the **USB keyboard-wedge pattern**: the marina purchases pre-encoded RFID cards with the facility code and UID already printed on them. To register a card, the staff member clicks "Add Card" in the React UI, focuses the cursor on the `card_uid` text input, and taps the physical card on a generic USB RFID reader (acting as a USB HID keyboard). The reader types the hex UID string into the input and submits. No WebUSB integration, no local bridge agent, no vendor SDK required for issuance.

```python
class AccessCard(models.Model):
    SUBTYPE_CHOICES = [
        ('owner',      'Owner'),
        ('crew',       'Crew'),
        ('family',     'Family'),
        ('contractor', 'Contractor'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_cards')
    member = models.ForeignKey(
        'members.Member',
        on_delete=models.CASCADE,
        related_name='access_cards',
    )
    card_uid = models.CharField(max_length=100)         # Physical card UID (hex)
    facility_code = models.CharField(max_length=20, blank=True)
    label = models.CharField(max_length=100, blank=True)   # e.g. "Owner card", "Crew — John"
    sub_type = models.CharField(max_length=20, choices=SUBTYPE_CHOICES, default='owner')
    is_active = models.BooleanField(default=False)      # Activated on contract start
    zones_override = models.ManyToManyField(
        AccessZone,
        blank=True,
        related_name='card_overrides',
        help_text="If set, overrides the member_type ZoneAccessRule for this card only.",
    )
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    deactivated_at = models.DateTimeField(null=True, blank=True)
    deactivation_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        # IMMUTABILITY INVARIANT: once a card row is created, the member FK is NEVER
        # changed. Physical plastic cards are recycled by creating a NEW AccessCard row
        # with the same card_uid but a new PK. This preserves the full AccessEvent audit
        # trail — every historical event links to the exact card/member state at the time.
        #
        # Uniqueness: only one ACTIVE card per (marina, card_uid) is allowed.
        # Multiple inactive rows sharing the same card_uid are legal (recycled plastic).
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'card_uid'],
                condition=models.Q(is_active=True),
                name='unique_active_card_uid_per_marina',
            )
        ]

    def __str__(self):
        return f"{self.member.name} — {self.label or self.card_uid}"
```

**Physical card recycling lifecycle:**
1. Member returns physical card → staff calls `deactivate/` endpoint: `is_active=False`, `deactivated_at=now()`, reason recorded. Row is **frozen — the `member` FK must never be changed on an existing row.**
2. Same physical card handed to a new customer → staff calls `POST /access-control/cards/` with the same `card_uid`. A **brand-new `AccessCard` row** is created (new PK). All historical `AccessEvent` records referencing the old row's PK continue to correctly attribute to the previous holder.
3. `AccessEvent.card` always links to the `AccessCard` primary key, not to `card_uid`. History is immutable.

**Automatic activation/deactivation:** A Django signal on `Member` status changes (and on contract expiry via Celery beat) calls `AccessCard.objects.filter(member=member).update(is_active=False)`. The HAL `revoke_access` hardware command **must be dispatched inside `transaction.on_commit()`** — the hardware must not receive the revoke signal before the `is_active=False` state is fully committed to the database. If the revoke fires mid-transaction and the transaction is later rolled back, the card would be physically blocked but remain `is_active=True` in the DB, causing phantom access denials:

```python
from django.db import transaction

@receiver(post_save, sender=AccessCard)
def on_access_card_saved(sender, instance, **kwargs):
    if not instance.is_active and instance.tracker.has_changed('is_active'):
        transaction.on_commit(
            lambda: revoke_access_on_card_deactivate.delay(card_id=instance.pk)
        )
```

No manual re-programming required.

**Card limit enforcement:** `Marina.features['max_cards_per_member']` (default `4`). Validated at the serializer level before issuing a new card. Only counts `is_active=True` cards for the member.

### 3.4 Access Events

```python
class AccessEvent(models.Model):
    CREDENTIAL_TYPE = [
        ('card',      'RFID Card'),
        ('face',      'Biometric Face'),
        ('anpr',      'ANPR Plate'),
        ('pin',       'PIN Code'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_events')
    reader = models.ForeignKey(AccessReader, on_delete=models.SET_NULL, null=True, related_name='events')
    credential_type = models.CharField(max_length=10, choices=CREDENTIAL_TYPE)
    card = models.ForeignKey(
        AccessCard,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='events',
    )
    member = models.ForeignKey(
        'members.Member',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='access_events',
    )
    raw_credential = models.CharField(
        max_length=100, blank=True,
        help_text="Card UID, plate string, or 'biometric' (never raw biometric data).",
    )
    granted = models.BooleanField()
    denial_reason = models.CharField(max_length=200, blank=True)
    occurred_at = models.DateTimeField(db_index=True)
    cctv_cameras = models.ManyToManyField(
        'CCTVCamera',
        blank=True,
        related_name='access_events',
        help_text="Cameras covering this reader's location — used for CCTV footage jump.",
    )

    class Meta:
        ordering = ['-occurred_at']
        indexes = [
            models.Index(fields=['marina', 'occurred_at']),
            models.Index(fields=['marina', 'member', 'occurred_at']),
            models.Index(fields=['marina', 'reader', 'occurred_at']),
        ]
```

### 3.5 ANPR

ANPR is an **optional module** gated by `Marina.features['anpr_enabled']`. The models are defined in the schema for all marinas, but the UI, processing logic, and API write paths are hidden behind the feature flag. This allows ANPR to be sold as a premium add-on to marinas with gated car parks, without affecting pontoon-only marinas.

```python
class ANPRCamera(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='anpr_cameras')
    zone = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='anpr_cameras')
    camera_uid = models.CharField(max_length=100)
    location_label = models.CharField(max_length=200)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    last_frame_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ['marina', 'camera_uid']


class VehicleRegistration(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='vehicle_registrations')
    member = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='vehicles')
    plate_number = models.CharField(max_length=20)    # Normalised: uppercase, no spaces
    make = models.CharField(max_length=100, blank=True)
    model = models.CharField(max_length=100, blank=True)
    colour = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['marina', 'plate_number']

    def save(self, *args, **kwargs):
        self.plate_number = self.plate_number.upper().replace(' ', '')
        super().save(*args, **kwargs)


class ANPREvent(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='anpr_events')
    camera = models.ForeignKey(ANPRCamera, on_delete=models.SET_NULL, null=True, related_name='events')
    plate_detected = models.CharField(max_length=20)
    vehicle = models.ForeignKey(
        VehicleRegistration,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='anpr_events',
        help_text="Null if plate is unrecognised.",
    )
    matched_member = models.ForeignKey(
        'members.Member',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='anpr_events',
    )
    access_granted = models.BooleanField()
    confidence = models.FloatField(default=1.0)
    occurred_at = models.DateTimeField(db_index=True)
    staff_reviewed = models.BooleanField(default=False)
    staff_reviewer = models.ForeignKey(
        'staff.StaffMember',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reviewed_anpr_events',
    )

    class Meta:
        ordering = ['-occurred_at']
        indexes = [
            models.Index(fields=['marina', 'occurred_at']),
            models.Index(fields=['marina', 'plate_detected']),
        ]
```

### 3.6 CCTV Registry

```python
class CCTVCamera(models.Model):
    """
    Registry of cameras on the marina's NVR.
    DocksBase stores no video footage — only metadata for timestamp-based navigation.
    """
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='cctv_cameras')
    zone = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='cctv_cameras')
    camera_uid = models.CharField(max_length=100)     # NVR channel ID or RTSP stream ID
    location_label = models.CharField(max_length=200)
    nvr_ip = models.GenericIPAddressField(null=True, blank=True)
    nvr_channel = models.IntegerField(null=True, blank=True)
    viewer_url_template = models.CharField(
        max_length=500, blank=True,
        help_text=(
            "URL template for deep-linking into the marina's NVR viewer. "
            "Use {timestamp_iso} as placeholder. "
            "Example: http://nvr.local/view?cam={camera_uid}&t={timestamp_iso}"
        ),
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ['marina', 'camera_uid']
```

**CCTV search:** The `AccessEvent.cctv_cameras` M2M is populated when the event is ingested: the ingest service queries `CCTVCamera.objects.filter(zone=reader.zone)`. The frontend "Review footage" button constructs the NVR deep-link URL from `viewer_url_template` substituting `occurred_at`. For NVR systems that do not support browser deep-linking (e.g. older Hikvision setups that require a thick Windows client), the UI always shows a one-click "Copy timestamp & camera UID" button so the harbour master can paste the exact values into their proprietary desktop viewer. DocksBase never proxies video.

### 3.7 Biometric Enrolments

Biometric face authentication ships as a **deferred feature (v2)**. The DB schema and HAL interfaces are defined now to avoid a future breaking migration, but the terminal SDK integration, the Staff App clock-in flow, and the boater portal enrolment flow are not built until v2. The `biometric_enabled` feature flag gates all biometric UI and processing paths.

When biometric enrolment is built in v2, the physical enrolment flow is: the member signs the GDPR consent form digitally in the boater portal, then presents themselves at the biometric terminal at the harbour master's office where a staff member operates the terminal on their behalf. There is no browser-webcam enrolment path — proprietary terminals (Suprema, ZKTeco) cannot be driven from a web PWA without a dedicated local bridge service.

```python
class BiometricEnrolment(models.Model):
    """
    Stores only an opaque encrypted handle issued by the biometric terminal SDK.
    No raw biometric data, no facial images, no feature vectors are stored in DocksBase.
    See Section 4 (GDPR) for legal basis and deletion mechanism.
    """
    SUBJECT_TYPE = [
        ('member', 'Member'),
        ('staff',  'Staff'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='biometric_enrolments')
    subject_type = models.CharField(max_length=10, choices=SUBJECT_TYPE)
    member = models.OneToOneField(
        'members.Member',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='biometric_enrolment',
    )
    staff_member = models.OneToOneField(
        'staff.StaffMember',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='biometric_enrolment',
    )
    terminal_uid = models.CharField(max_length=100)    # Which terminal holds the template
    template_handle = models.CharField(max_length=500) # Opaque SDK handle — NOT raw biometric
    consent_given_at = models.DateTimeField()
    consent_ip = models.GenericIPAddressField(null=True, blank=True)
    consent_method = models.CharField(
        max_length=20,
        choices=[('portal', 'Boater Portal'), ('staff_app', 'Staff App'), ('admin', 'Admin UI')],
    )
    enrolled_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    # GDPR resilient deletion fields.
    # When the DELETE endpoint is hit, these are set IMMEDIATELY — the record is
    # hidden from all UI and API responses at once. A Celery task with exponential
    # backoff then attempts the physical terminal wipe. The DB row is hard-deleted
    # only once the terminal acknowledges. This satisfies the GDPR Art. 17 deadline
    # even when the physical terminal is temporarily offline (network fault, power cut).
    pending_deletion = models.BooleanField(
        default=False,
        help_text="Set True immediately on DELETE request. Hidden from all queries via default manager filter.",
    )
    pending_deletion_since = models.DateTimeField(
        null=True, blank=True,
        help_text="Timestamp of DELETE request — used by the Celery task to escalate if unreachable too long.",
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(subject_type='member', member__isnull=False, staff_member__isnull=True) |
                    models.Q(subject_type='staff', staff_member__isnull=False, member__isnull=True)
                ),
                name='biometric_enrolment_subject_consistency',
            )
        ]

    objects = BiometricEnrolmentManager()   # default manager excludes pending_deletion=True
    all_objects = models.Manager()          # unfiltered — used only by the Celery deletion task
```

### 3.8 Fraud Prevention

The fraud detection thresholds are stored in `Marina.features` so that each marina can calibrate them independently. The initial migration seeds the following defaults (appropriate for a mid-size marina):

- `fraud_discount_count_threshold`: `3` — more than 3 discounts by the same staff member in a single day triggers an alert.
- `fraud_writeoff_threshold_amount`: `200.00` — any single write-off above €200 by a non-manager triggers an alert.
- `fraud_after_hours_start`: `"22:00"` — sales after this time trigger an after-hours alert.
- `fraud_after_hours_end`: `"06:00"` — sales before this time trigger an after-hours alert.

A marina settings UI (Section 6.6) exposes these thresholds so managers can tune them to avoid alert fatigue.

`SpendAuthorisationRequest` uses **explicit foreign keys** to the specific billing models that require authorisation, rather than a Django Generic Foreign Key. This preserves SQL-level referential integrity, enables safe cascading deletes, and makes reverse lookups performant. Nullable FKs cover each financial model type:

```python
class SpendAuthorisationRule(models.Model):
    """
    Defines the maximum value a staff role can apply without manager approval.
    """
    ACTION_CHOICES = [
        ('discount',  'Discount'),
        ('write_off', 'Write-off'),
        ('refund',    'Refund'),
        ('override',  'Price Override'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='spend_rules')
    role = models.CharField(
        max_length=20,
        choices=[('staff', 'Staff'), ('manager', 'Manager'), ('owner', 'Owner')],
    )
    action_type = models.CharField(max_length=20, choices=ACTION_CHOICES)
    threshold_amount = models.DecimalField(max_digits=10, decimal_places=2)
    requires_approver_role = models.CharField(
        max_length=20,
        choices=[('manager', 'Manager'), ('owner', 'Owner')],
    )

    class Meta:
        unique_together = ['marina', 'role', 'action_type']


class SpendAuthorisationRequest(models.Model):
    STATUS_CHOICES = [
        ('pending',    'Pending — POS terminal blocked'),
        ('suspended',  'Parked — terminal freed, awaiting manager'),
        ('overridden', 'Force-approved by staff — retrospective sign-off required'),
        ('approved',   'Approved'),
        ('denied',     'Denied'),
        ('expired',    'Expired'),
    ]
    # OPERATIONAL REALITY: Hard-blocking a live POS terminal while waiting for a manager
    # who may be on the docks or at lunch paralyzes the fuel dock and creates customer queues.
    # Two escape paths are provided so dockhands are never trapped:
    #
    # Path A — "Park Transaction" (preferred): dockhand suspends the ticket,
    #   freeing the terminal to ring up the next customer. The suspended ticket
    #   is resumed and completed once the manager approves.
    #
    # Path B — "Force Override": dockhand forces the transaction through immediately.
    #   A FraudAnomalyAlert (alert_type='forced_override') is auto-created requiring
    #   retrospective manager sign-off. This path leaves a hard audit trail.

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='spend_requests')
    rule = models.ForeignKey(SpendAuthorisationRule, on_delete=models.PROTECT, related_name='requests')
    action_type = models.CharField(max_length=20, choices=SpendAuthorisationRule.ACTION_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField()
    requested_by = models.ForeignKey(
        'staff.StaffMember',
        on_delete=models.SET_NULL,
        null=True,
        related_name='spend_requests_made',
    )
    approver = models.ForeignKey(
        'staff.StaffMember',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='spend_requests_actioned',
    )
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default='pending')
    requested_at = models.DateTimeField(auto_now_add=True)
    actioned_at = models.DateTimeField(null=True, blank=True)
    approver_note = models.TextField(blank=True)

    # Park Transaction fields (Path A)
    suspended_at = models.DateTimeField(null=True, blank=True)

    # Force Override fields (Path B)
    override_forced_by = models.ForeignKey(
        'staff.StaffMember',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='forced_spend_overrides',
    )
    override_forced_at = models.DateTimeField(null=True, blank=True)
    # FraudAnomalyAlert is auto-created on force-override; FK links the two for the manager review UI.
    override_fraud_alert = models.OneToOneField(
        'FraudAnomalyAlert',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='spend_override_request',
    )
    # Explicit FKs to each financial model type that may require authorisation.
    # Add a new nullable FK here when a new billing model requires spend authorisation.
    invoice = models.ForeignKey(
        'billing.Invoice',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='spend_requests',
    )
    fuel_dock_entry = models.ForeignKey(
        'fuel.FuelDockEntry',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='spend_requests',
    )
    pos_order = models.ForeignKey(
        'pos.POSOrder',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='spend_requests',
    )

    class Meta:
        ordering = ['-requested_at']
        constraints = [
            # A spend authorisation with no financial document attached is meaningless —
            # there is no way to audit what the approval or denial relates to.
            models.CheckConstraint(
                check=(
                    models.Q(invoice__isnull=False) |
                    models.Q(fuel_dock_entry__isnull=False) |
                    models.Q(pos_order__isnull=False)
                ),
                name='spend_auth_requires_financial_reference',
            )
        ]


class FraudAnomalyAlert(models.Model):
    ALERT_TYPE = [
        ('repeated_discount',        'Repeated Discounts'),
        ('large_write_off',          'Large Write-off'),
        ('unusual_refund',           'Unusual Refund Pattern'),
        ('after_hours_sale',         'After-hours Sale'),
        ('forced_override',          'Force-approved spend — retrospective sign-off required'),
        ('biometric_deletion_stalled','Biometric terminal unreachable — GDPR deletion pending > 24 h'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='fraud_alerts')
    alert_type = models.CharField(max_length=30, choices=ALERT_TYPE)
    staff_member = models.ForeignKey(
        'staff.StaffMember',
        on_delete=models.SET_NULL,
        null=True,
        related_name='fraud_alerts',
    )
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    event_count = models.IntegerField()
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    threshold_exceeded = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        'staff.StaffMember',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='resolved_fraud_alerts',
    )
    resolution_note = models.TextField(blank=True)

    class Meta:
        ordering = ['-sent_at']
```

---

## 4. GDPR / Privacy Architecture

### 4.1 Data Classification

| Data element | Classification | Storage location | Retention |
|---|---|---|---|
| AccessCard UID (hex string) | Personal data | DocksBase DB | Duration of membership + 3 years |
| AccessEvent log | Personal data | DocksBase DB | 2 years rolling, then purged |
| ANPREvent plate string | Personal data | DocksBase DB | 2 years rolling, then purged |
| VehicleRegistration | Personal data | DocksBase DB | Duration of membership + 1 year |
| BiometricEnrolment.template_handle | Biometric data (special category, Art. 9 GDPR) | DocksBase DB (encrypted at rest) | Deleted on revocation or right-to-erasure; max = duration of membership |
| Raw facial images / biometric vectors | Not stored | N/A — never transmitted to DocksBase | N/A |
| CCTV video footage | Special category (third-party NVR) | Marina's own NVR — DocksBase has no access | Marina's own retention policy (typically 30 days) |

### 4.2 Biometric Data — Legal Basis

Biometric data processing requires an **explicit legal basis** under GDPR Art. 9(2). DocksBase supports:

- **Art. 9(2)(a) — Explicit consent**: the subject opts in via a specific, granular consent step (not bundled with general T&Cs).
- **Art. 9(2)(b) — Employment** (staff clock-in only): subject to local law; the marina's HR team must verify this basis is valid in their jurisdiction before enabling.

The default and only permissible basis for **member** biometric enrolment is explicit consent.

### 4.3 Consent Flow (v2 implementation)

Biometric enrolment is a two-step process combining a digital consent record with physical terminal enrolment:

**Step 1 — Digital consent (boater portal, v2):**

1. Member navigates to Portal > Account > Security > Face Authentication.
2. DocksBase presents a standalone consent screen (not embedded in any other form):
   - What data is processed (encrypted template handle only, no image stored by DocksBase)
   - Who processes it (the marina's biometric terminal vendor)
   - How long it is retained (until membership ends or withdrawn)
   - How to withdraw (instant deletion on request)
3. Member taps "I agree and want to enrol". `BiometricEnrolment.consent_given_at` and `consent_method` are recorded server-side at this moment.
4. The member receives instructions to visit the harbour master's office for physical enrolment.
5. Consent screen is accessible at any time from the portal for withdrawal.

**Step 2 — Physical enrolment (harbour master's office):**

A staff member operates the biometric terminal on behalf of the member. The terminal (e.g. Suprema or ZKTeco) issues a `template_handle`. DocksBase stores only the handle. Raw biometric data never leaves the terminal.

**Staff enrolment (Staff App, v2):**

1. Manager or staff member opens Staff App > My Profile > Clock-in Method.
2. Separate consent screen with the same elements as above, plus a note that the legal basis may be employment-based (jurisdiction-dependent).
3. Consent recorded in `BiometricEnrolment.consent_method = 'staff_app'`.
4. Physical enrolment proceeds at a terminal by the manager.

### 4.4 Right to Erasure (Art. 17 GDPR)

When a member or staff member exercises the right to erasure, or when a membership ends and the retention period lapses:

1. `BiometricAdapter.revoke_face(terminal_uid, template_handle)` is called — the template is deleted from the physical terminal.
2. The `BiometricEnrolment` record is hard-deleted from DocksBase DB (not soft-deleted — there must be no residual handle).
3. `AccessCard` records are deactivated (soft-delete: `is_active=False`, `deactivated_at=now()`). The card UID is retained for the audit log period because `AccessEvent` records reference it.
4. `AccessEvent` records are pseudonymised after the retention period (2 years) by a Celery beat task: `member_id` and `card_id` are set to null, `raw_credential` is hashed. The event record itself is kept for operational security auditing.

### 4.5 Encryption at Rest

`BiometricEnrolment.template_handle` must be stored encrypted using Django's `django-encrypted-model-fields` (or equivalent). The encryption key is stored in environment variable `BIOMETRIC_FIELD_KEY`, separate from `SECRET_KEY`. Key rotation procedure must be documented in the marina's deployment runbook.

### 4.6 Access Log Retention Automation

A Celery periodic task (`access_control.tasks.purge_old_access_events`) runs nightly at 02:00 marina local time:

1. Deletes `AccessEvent` records older than `Marina.features.get('access_log_retention_days', 730)` (default 2 years).
2. Pseudonymises `ANPREvent` records older than the same threshold.
3. Logs a summary to `FraudAnomalyAlert`-adjacent audit log for GDPR accountability records.

---

## 5. API Contract

All endpoints are under `/api/v1/access-control/`. All ViewSets filter by `marina` from the authenticated user's JWT. Roles `owner` and `manager` have full write access; `staff` has read-only access to their own events; `boater` has read-only access to their own cards and events.

### 5.1 Access Zones

```
GET    /api/v1/access-control/zones/
POST   /api/v1/access-control/zones/
PATCH  /api/v1/access-control/zones/{id}/
DELETE /api/v1/access-control/zones/{id}/   (blocked if readers or rules reference it)
```

### 5.2 Access Readers

```
GET    /api/v1/access-control/readers/
POST   /api/v1/access-control/readers/
PATCH  /api/v1/access-control/readers/{id}/
DELETE /api/v1/access-control/readers/{id}/

POST   /api/v1/access-control/readers/{id}/sync/
```

`sync/` triggers `AccessControlAdapter.sync_zone()` via a Celery task. Returns `202 Accepted` with a task ID.

### 5.3 Zone Access Rules

```
GET    /api/v1/access-control/zone-rules/
POST   /api/v1/access-control/zone-rules/
PATCH  /api/v1/access-control/zone-rules/{id}/
```

`PATCH` triggers a background Celery task that calls `grant_access` / `revoke_access` on all affected readers. Returns `202 Accepted`.

### 5.4 Access Cards

```
GET    /api/v1/access-control/cards/?member={id}
POST   /api/v1/access-control/cards/
PATCH  /api/v1/access-control/cards/{id}/
POST   /api/v1/access-control/cards/{id}/activate/
POST   /api/v1/access-control/cards/{id}/deactivate/
```

`activate/` and `deactivate/` call the HAL and write `is_active`, `deactivated_at`, `deactivation_reason`. Both return `200 OK` with the updated card object.

The card UID input field in the React UI is designed to receive input from a USB HID keyboard-wedge RFID reader: when the staff member taps a card on the reader while the field is focused, the reader types the UID and submits. No special browser API or driver is required.

### 5.5 Access Events

```
GET    /api/v1/access-control/events/
```

Query params: `?member={id}`, `?reader={id}`, `?zone={id}`, `?granted=true|false`, `?from={iso_date}`, `?to={iso_date}`, `?credential_type=card|face|anpr|pin`.

Response includes `cctv_cameras` array with `viewer_url` (pre-substituted from template) and `copy_label` (formatted string of timestamp and camera UID for clipboard fallback) for each camera covering the event's reader zone.

### 5.6 ANPR

All ANPR endpoints require `Marina.features['anpr_enabled'] = True`. Requests to these endpoints from marinas without the flag return `403 Forbidden` with `{"detail": "ANPR module not enabled for this marina."}`.

```
GET    /api/v1/access-control/anpr-cameras/
POST   /api/v1/access-control/anpr-cameras/
PATCH  /api/v1/access-control/anpr-cameras/{id}/

GET    /api/v1/access-control/vehicles/?member={id}
POST   /api/v1/access-control/vehicles/
PATCH  /api/v1/access-control/vehicles/{id}/
DELETE /api/v1/access-control/vehicles/{id}/

GET    /api/v1/access-control/anpr-events/
```

ANPR events query params: `?plate={string}`, `?member={id}`, `?camera={id}`, `?access_granted=true|false`, `?unrecognised=true`, `?from={iso_date}`, `?to={iso_date}`.

`?unrecognised=true` filters to events where `matched_member` is null — the daily unrecognised plates review list for the harbour master.

### 5.7 CCTV Registry

```
GET    /api/v1/access-control/cctv-cameras/
POST   /api/v1/access-control/cctv-cameras/
PATCH  /api/v1/access-control/cctv-cameras/{id}/
DELETE /api/v1/access-control/cctv-cameras/{id}/
```

No video is proxied. The `viewer_url` field in `AccessEvent` responses is computed from `CCTVCamera.viewer_url_template` on the fly. When `viewer_url_template` is blank for a camera, the response omits `viewer_url` and the frontend shows only the clipboard copy fallback.

### 5.8 Biometric Enrolments

These endpoints are gated behind `Marina.features['biometric_enabled']`. They are defined now so the schema is stable for v2, but the frontend enrolment initiation flow is not built until v2.

```
GET    /api/v1/access-control/biometric-enrolments/
POST   /api/v1/access-control/biometric-enrolments/        # Initiates enrolment, returns enrolment_id
DELETE /api/v1/access-control/biometric-enrolments/{id}/   # Right-to-erasure — hard delete
```

`DELETE` **must not block on hardware availability.** Under GDPR Art. 17, the deletion obligation exists the moment the request is received — an offline terminal is not a legal excuse for indefinite retention. The correct flow:

1. Immediately set `enrolment.pending_deletion = True` and `enrolment.pending_deletion_since = now()`. Save. Return `202 Accepted` — the record is now invisible to all UI and all API endpoints (default manager excludes `pending_deletion=True`).
2. Dispatch `revoke_biometric_enrolment.apply_async(args=[enrolment.pk])` — a Celery task using exponential backoff (`max_retries=20`, doubling from 30 s to a max interval of ~6 hours).
3. The task calls `BiometricAdapter.revoke_face(terminal_uid, template_handle)` via `all_objects` (the unfiltered manager). On success: hard-delete the `BiometricEnrolment` row from the DB.
4. If the terminal is still unreachable after 24 hours (`pending_deletion_since` threshold), the task creates a `FraudAnomalyAlert`-adjacent notification (new `alert_type='biometric_deletion_stalled'`) so the marina manager can physically power-cycle or factory-reset the terminal. The notification text must include the `terminal_uid` and the subject's name for manual follow-up.

```python
class BiometricEnrolmentManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(pending_deletion=False)
```

This pattern guarantees the data is de-facto inaccessible (hidden from subject, hidden from staff UI) immediately on request, while the physical terminal wipe completes asynchronously as soon as hardware is reachable.

### 5.9 Fraud Prevention

```
GET    /api/v1/access-control/spend-rules/
POST   /api/v1/access-control/spend-rules/
PATCH  /api/v1/access-control/spend-rules/{id}/

GET    /api/v1/access-control/spend-requests/
POST   /api/v1/access-control/spend-requests/
POST   /api/v1/access-control/spend-requests/{id}/approve/
POST   /api/v1/access-control/spend-requests/{id}/deny/
POST   /api/v1/access-control/spend-requests/{id}/suspend/
POST   /api/v1/access-control/spend-requests/{id}/force-override/

GET    /api/v1/access-control/fraud-alerts/
POST   /api/v1/access-control/fraud-alerts/{id}/resolve/
```

`approve/` and `deny/` require the authenticated user's role to satisfy `rule.requires_approver_role`. They write `actioned_at`, `approver`, and `status`. The billing or POS action that was pending is unblocked by a signal on `SpendAuthorisationRequest` save.

`suspend/` (Path A — Park Transaction): available to the dockhand who created the request (`requested_by` only). Sets `status='suspended'` and `suspended_at=now()`. The linked POS terminal or billing object is freed immediately so the next customer can be served. The request remains in the Pending Approvals panel as `Parked` — the manager approves or denies it later, and the original ticket is then completed or reversed. No `FraudAnomalyAlert` is created.

`force-override/` (Path B — Override & Flag): available to any authenticated staff member. Sets `status='overridden'`, `override_forced_by`, `override_forced_at=now()`. The transaction completes immediately. The endpoint then auto-creates a `FraudAnomalyAlert` with `alert_type='forced_override'` and links it to the request via `override_fraud_alert`. The manager sees this alert in the Anomaly Alerts tab and must mark it resolved with a sign-off note. This path leaves a hard audit trail; it cannot be used without creating a visible, unresolved alert.

### 5.10 Ingest Webhooks (Hardware → DocksBase)

```
POST   /api/v1/access-control/ingest/rfid/
POST   /api/v1/access-control/ingest/anpr/
POST   /api/v1/access-control/ingest/biometric/
```

Authentication: HMAC-SHA256 signature in `X-DocksBase-Signature` header. Secret is `Marina.features['access_webhook_secret']` (generated on reader registration). All three return `204 No Content`.

---

## 6. Frontend Architecture

### 6.1 Navigation

Add a **"Security"** group to the sidebar (visible to `owner` and `manager` roles only, or `staff` with `module_permissions.security` not set to false).

Sidebar items:
- Access Control → `/security/access-control`
- ANPR & Vehicles → `/security/anpr` (hidden if `Marina.features.anpr_enabled` is false)
- CCTV Registry → `/security/cctv`
- Biometric Enrolments → `/security/biometric` (hidden if `Marina.features.biometric_enabled` is false)
- Fraud & Authorisations → `/security/fraud`

### 6.2 Screen: Access Control (`SecurityAccessScreen.jsx`)

Four-tab layout: **Zones & Rules | Readers | Cards | Event Log**

**Zones & Rules tab:**
- Left panel: zone list with `+ Add Zone` button. Click a zone to edit name/description/is_restricted in a side drawer.
- Right panel: `ZoneRuleMatrix` — a table where rows are `member_type` values and columns are zones. Each cell is a checkbox. Saving fires `PATCH /access-control/zone-rules/{id}/` with the updated zones array.

**Readers tab:**
- Data table: Location, Zone, Hardware Type, IP Address, Last Heartbeat (colour-coded: green < 5 min, amber < 30 min, red > 30 min or null).
- Row action: opens `ReaderDrawer` (edit label, zone, IP, notes). Includes `[ Sync Now ]` button that calls `POST .../readers/{id}/sync/`.

**Cards tab:**
- Search bar (by member name or card UID). Results list.
- Card row shows: Member, Card Label, Sub-type, Status badge (Active/Inactive), Valid From/To.
- `+ Issue Card` button opens `CardFormDrawer`. The `card_uid` input field is a plain text input that accepts keyboard-wedge RFID reader input: the staff member taps the card on the USB reader while the field is focused, and the UID is typed in automatically. Drawer validates card limit against `Marina.features.max_cards_per_member`.
- Row action: `Activate` / `Deactivate` buttons call the respective endpoints. Deactivate asks for a reason (required).

**Event Log tab:**
- Filter bar: Zone, Reader, Member, Date range, Credential type, Granted/Denied toggle.
- Paginated table: Timestamp, Reader, Member (or "Unknown"), Credential type badge, Granted badge.
- Row action: if `cctv_cameras.length > 0`, show `[ View Footage ]` button. If `viewer_url` is present, clicking opens the NVR deep-link in a new tab. Always show a `[ Copy timestamp & camera ]` button (copies the formatted timestamp and camera UID to the clipboard) so the harbour master can paste into a desktop NVR viewer. No video is embedded in DocksBase.

### 6.3 Screen: ANPR & Vehicles (`SecurityANPRScreen.jsx`)

This screen is only rendered when `Marina.features.anpr_enabled` is true. If the flag is false, the sidebar item is hidden and direct navigation redirects to a "module not enabled" notice.

Two-tab layout: **Vehicle Registrations | ANPR Event Log**

**Vehicle Registrations:**
- Member search → shows their registered plates. `+ Register Plate` opens inline form (plate, make, model, colour). Limit enforced by `Marina.features.max_plates_per_member` (default `3`).

**ANPR Event Log:**
- Filter by plate, member, camera, date range, access granted, unrecognised-only.
- Unrecognised events show a `[ Flag for Review ]` button that marks `staff_reviewed=True` and records the reviewer.

### 6.4 Screen: CCTV Registry (`SecurityCCTVScreen.jsx`)

Simple CRUD table: Camera UID, Location, Zone, NVR IP, Channel. `+ Add Camera` button. Edit inline. `viewer_url_template` field with placeholder documentation tooltip explaining the `{timestamp_iso}` and `{camera_uid}` substitution syntax. A note in the UI explains that leaving this field blank enables clipboard-copy-only mode for NVRs without web deep-link support.

### 6.5 Screen: Biometric Enrolments (`SecurityBiometricScreen.jsx`)

This screen is only rendered when `Marina.features.biometric_enabled` is true.

- Tabs: **Members | Staff**
- Table: Subject name, Terminal, Enrolled at, Consent method, Status (Active / Revoked).
- `[ Revoke ]` button calls `DELETE /biometric-enrolments/{id}/`. Requires confirmation modal with GDPR deletion warning text.
- No enrolment is initiated from this screen. Member enrolment begins in the Boater Portal (digital consent), then completes at the physical terminal with a staff member present. Staff enrolment begins in the Staff App. This screen is for manager oversight and revocation only.

### 6.6 Screen: Fraud & Authorisations (`SecurityFraudScreen.jsx`)

Three-tab layout: **Spend Rules | Pending Approvals | Anomaly Alerts**

**Spend Rules:**
- Matrix table: rows = role (Staff / Manager), columns = action type. Each cell shows threshold and required approver, or "—" if no rule set. Clicking a cell opens `SpendRuleDrawer`.
- A **"Detection Thresholds"** section below the matrix exposes the marina-level fraud detection settings (`fraud_discount_count_threshold`, `fraud_writeoff_threshold_amount`, `fraud_after_hours_start`, `fraud_after_hours_end`) as editable fields. Changes update `Marina.features` via `PATCH /api/v1/marinas/{id}/`. This allows each marina to calibrate thresholds to their operational baseline and reduce alert fatigue.

**Pending Approvals:**
- Live-polling list (React Query with `refetchInterval: 30_000`) of `SpendAuthorisationRequest` with `status=pending`.
- Each row shows: requested by, action type, amount, description, time pending, and a link to the related billing object (Invoice, FuelDockEntry, or POSOrder) if set.
- `[ Approve ]` and `[ Deny ]` buttons with a note field. Calls `approve/` or `deny/` endpoint.
- Approved/denied rows are removed from the list on the next refetch.

**Anomaly Alerts:**
- List of unresolved `FraudAnomalyAlert` records. Each shows: alert type, staff member, period, event count.
- `[ Mark Resolved ]` button opens a note input then calls `POST .../fraud-alerts/{id}/resolve/`.

### 6.7 Data Hooks

Follow the same React Query + Axios pattern as `useStaff.js` and `useMembers.js`:

```
hooks/useAccessZones.js
hooks/useAccessReaders.js
hooks/useAccessCards.js
hooks/useAccessEvents.js
hooks/useANPREvents.js
hooks/useVehicleRegistrations.js
hooks/useCCTVCameras.js
hooks/useBiometricEnrolments.js
hooks/useSpendRules.js
hooks/useSpendRequests.js
hooks/useFraudAlerts.js
```

Each hook exposes the query result and relevant mutations (create, update, activate, deactivate, etc.). Mutations invalidate related query keys on success. Toast notifications on success and error follow the existing pattern.

---

## 7. Implementation Steps (Ordered)

Steps respect Django migration dependencies and avoid circular imports. Do not reorder.

1. **Create `access_control` app** — `python manage.py startapp access_control`. Add to `INSTALLED_APPS`. Create `urls.py`, wire into root `urls.py` under `/api/v1/access-control/`.

2. **Write HAL base classes** — `hal/base.py` with `AccessControlAdapter`, `ANPRAdapter`, `BiometricAdapter` ABCs exactly as Section 2.2. Write `DemoAdapter` implementations that log all calls and return success. Write `hal/factory.py` (Section 2.3). Stub out adapter slots for Paxton Net2/10 and Salto in the factory registry (commented) so they are the obvious next step.

2a. **Add `Berth.pier_label` field** — `CharField(max_length=50, blank=True)` on the existing `Berth` model, populated from the map editor pier grouping. Migration required before `access_control` app references it. Without this field, `member_can_access_zone()` cannot perform the spatial pier check.

3. **Write all models** — Section 3 in order: `AccessZone`, `AccessReader`, `ZoneAccessRule` (with `link_to_berth_pier` field), `AccessCard` (with partial `UniqueConstraint` on active cards only — not `unique_together`), `AccessEvent`, `ANPRCamera`, `VehicleRegistration`, `ANPREvent`, `CCTVCamera`, `BiometricEnrolment` (with `pending_deletion`, `pending_deletion_since` fields and `BiometricEnrolmentManager` excluding `pending_deletion=True`), `SpendAuthorisationRule`, `SpendAuthorisationRequest` (with `suspended_at`, `override_forced_by`, `override_forced_at`, `override_fraud_alert` fields), `FraudAnomalyAlert` (with `forced_override` and `biometric_deletion_stalled` alert types). Run `makemigrations access_control`. Seed default fraud detection threshold values in the initial data migration.

4. **Install `django-encrypted-model-fields`** — configure `BIOMETRIC_FIELD_KEY` in `.env` and `settings.py`. Apply encryption to `BiometricEnrolment.template_handle`.

5. **Write serializers** — one serializer per model. `AccessEventSerializer` must compute `cctv_cameras[].viewer_url` (substituting `occurred_at` into `viewer_url_template`) and `cctv_cameras[].copy_label` for clipboard fallback. `AccessCardSerializer` must validate card count against `Marina.features.max_cards_per_member`. ANPR serializers must check `Marina.features.anpr_enabled`.

6. **Write ViewSets** — one ModelViewSet per resource group (Section 5). All filtered by `marina`. Implement `activate/`, `deactivate/`, `sync/`, `approve/`, `deny/`, `resolve/` actions as `@action` decorators. ANPR and biometric ViewSets enforce the respective feature flags.

7. **Write ingest webhook views** — Section 2.4. Implement HMAC validation. Wire into `urls.py`.

7a. **ANPR ingest debounce** — configure Redis debounce cache in the ANPR ingest view before any `ANPREvent` write. Key: `anpr:{marina_pk}:{camera_uid}:{plate}`. TTL: `Marina.features.get('anpr_debounce_seconds', 60)`. Silently return `204` if key exists. Integration test: send 20 rapid identical webhooks, assert exactly one `ANPREvent` row is created.

8. **Write Celery tasks** — `sync_zone_task`, `revoke_access_on_card_deactivate`, `purge_old_access_events`, `detect_fraud_anomalies`, `revoke_biometric_enrolment` (exponential backoff, `max_retries=20`; hard-deletes `BiometricEnrolment` row on terminal ACK; creates `biometric_deletion_stalled` alert after 24 h), `deactivate_expired_access_cards` (see below). Register `purge_old_access_events`, `detect_fraud_anomalies`, and `deactivate_expired_access_cards` in the Celery beat schedule.

   **`deactivate_expired_access_cards` — mandatory daily cleanup:** Without this task, cards with a `valid_to` date in the past remain `is_active=True` indefinitely — any boater whose seasonal contract ended months ago can still badge through the gate. The task runs daily at 01:00 and deactivates all overdue cards:

   ```python
   # In Celery beat schedule (settings.py):
   'deactivate-expired-access-cards': {
       'task': 'access_control.tasks.deactivate_expired_access_cards',
       'schedule': crontab(hour=1, minute=0),  # daily at 01:00
   }
   ```

   Task implementation:
   ```python
   @app.task(name='access_control.tasks.deactivate_expired_access_cards')
   def deactivate_expired_access_cards():
       from django.utils import timezone
       expired = AccessCard.objects.filter(
           is_active=True,
           valid_to__lt=timezone.now().date(),
       )
       for card in expired:
           card.is_active = False
           card.deactivation_reason = 'Expired (valid_to date passed)'
           card.deactivated_at = timezone.now()
           card.save(update_fields=['is_active', 'deactivation_reason', 'deactivated_at'])
           # on_commit is not needed here — we are already outside any request transaction.
           revoke_access_on_card_deactivate.delay(card_id=card.pk)
   ```

9. **Write Django signals** — on `Member` status change (or `AccessCard.valid_to` lapse), trigger `revoke_access_on_card_deactivate` Celery task.

10. **Fraud anomaly detection service** — `services/fraud_detector.py`. Implements rules: (a) more than N discounts by same staff in a day, (b) any single write-off above threshold, (c) after-hours sales. N and thresholds read from `Marina.features` with the seeded defaults as fallback. Called by the Celery beat task.

11. **Add "Security" sidebar nav group** — add to sidebar config, gated on role and `module_permissions.security`. Hide ANPR item when `anpr_enabled` is false; hide Biometric item when `biometric_enabled` is false.

12. **Build frontend screens** — in order: `SecurityAccessScreen.jsx` (largest, build tabs independently), `SecurityANPRScreen.jsx`, `SecurityCCTVScreen.jsx`, `SecurityBiometricScreen.jsx` (manager oversight/revocation only — no enrolment initiation), `SecurityFraudScreen.jsx` (including the detection thresholds settings panel).

13. **Create all data hooks** — Section 6.7. One hook file per resource.

14. **Portal: Biometric consent form** — add "Face Authentication" section to boater portal account page. Implement the digital consent screen (Section 4.3 Step 1). Gate behind `Marina.features.biometric_enabled`. This is the consent record only; physical terminal enrolment happens offline at the harbour master's office. (v2 deliverable — schema defined now.)

15. **Staff App: Biometric clock-in** — add clock-in via biometric option to Staff App. Gated behind `Marina.features.biometric_enabled`. Sends `AccessEvent` with `credential_type='face'`, links to the relevant `Shift`. (v2 deliverable.)

16. **Write tests** — unit tests for:
    - `SpendAuthorisationRule` threshold logic
    - `suspend/` and `force-override/` endpoints — assert `suspended_at` populated; assert `FraudAnomalyAlert(alert_type='forced_override')` auto-created on force-override
    - `purge_old_access_events` pseudonymisation
    - HAL factory adapter selection
    - HMAC webhook validation
    - ANPR debounce: 20 identical rapid webhooks → exactly one `ANPREvent` row created
    - ANPR plate normalisation
    - `anpr_enabled` / `biometric_enabled` feature flag enforcement
    - `member_can_access_zone()` spatial pier logic: member on Pier A cannot access Pier F zone when `link_to_berth_pier=True`
    - `AccessCard` reissue: after deactivating a card, a new `AccessCard` row can be created with the same `card_uid`; historical `AccessEvent` still references the original row's PK
    - Biometric DELETE: assert `pending_deletion=True` immediately, `BiometricEnrolment` hidden from default manager, `revoke_biometric_enrolment` task dispatched; on task success assert row hard-deleted
