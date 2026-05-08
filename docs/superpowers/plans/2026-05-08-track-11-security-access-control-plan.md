# Track 11 — Security & Physical Access Control: Implementation Plan

**Date:** 2026-05-08
**Spec:** `docs/superpowers/specs/2026-05-07-track-11-security-access-control-design.md`
**App name:** `access_control` (folder: `backend/apps/access_control/`)
**Phase:** 5 (after billing, boatyard)

---

## Overview

Track 11 adds physical security as a first-class DocksBase module: RFID card access, ANPR vehicle recognition, CCTV registry, biometric enrolments (schema now, SDK in v2), and a fraud/spend-authorisation workflow. The entire hardware side is isolated behind a **Hardware Abstraction Layer (HAL)** so vendor-specific SDKs never touch business logic. All write paths that touch hardware are dispatched via `transaction.on_commit()` to prevent hardware commands firing during a rolled-back transaction.

**Key invariants:**
- `AccessCard.member` FK is immutable once a row is created. Card recycling creates a new row (new PK), preserving the `AccessEvent` audit chain.
- `BiometricEnrolment` with `pending_deletion=True` is invisible to the default manager immediately on DELETE request; physical terminal wipe is async.
- Hardware revoke is always dispatched inside `transaction.on_commit()`, never inline.
- All endpoints filter by `request.user.marina`.

---

## Prerequisites (must exist before Track 11 migrations run)

1. `berths.Berth` must have a `pier_label = CharField(max_length=50, blank=True)` field. This field is set by the map editor's pier grouping. Without it, `member_can_access_zone()` cannot perform the spatial pier check. Add a migration to `apps/berths/` before generating the `access_control` initial migration.
2. `billing.Invoice` must exist (already present).
3. `staff.StaffMember` must exist (already present).
4. Install `django-encrypted-model-fields` (`pip install django-encrypted-model-fields`). Add `BIOMETRIC_FIELD_KEY` to `.env` and `settings/base.py`.

---

## File Structure

```
backend/apps/access_control/
    __init__.py
    apps.py
    models.py
    serializers.py
    views/
        __init__.py
        zones.py
        readers.py
        cards.py
        events.py
        anpr.py
        cctv.py
        biometric.py
        fraud.py
        ingest.py          # webhook ingest for RFID, ANPR, biometric
    services/
        __init__.py
        zone_engine.py     # member_can_access_zone()
        fraud_detector.py  # anomaly detection rules
        card_lifecycle.py  # activate, deactivate, expire sweep
    hal/
        __init__.py
        base.py            # ABCs: AccessControlAdapter, ANPRAdapter, BiometricAdapter
        factory.py         # get_rfid_adapter(), get_anpr_adapter(), get_biometric_adapter()
        adapters/
            __init__.py
            demo.py        # DemoAccessAdapter, DemoANPRAdapter, DemoBiometricAdapter
    tasks.py               # Celery tasks
    signals.py
    admin.py
    urls.py
    migrations/
        0001_initial.py
        0002_seed_fraud_thresholds.py
```

---

## Models (`apps/access_control/models.py`)

Define all models in a single file in this exact order (respects FK dependencies):

### 1. `AccessZone`

```python
class AccessZone(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_zones')
    name         = models.CharField(max_length=100)         # e.g. "Pier A", "Shower Block"
    description  = models.CharField(max_length=300, blank=True)
    is_restricted = models.BooleanField(default=False)      # True = staff-only areas

    class Meta:
        ordering       = ['name']
        unique_together = ['marina', 'name']

    def __str__(self):
        return self.name
```

### 2. `AccessReader`

```python
class AccessReader(models.Model):
    HARDWARE_TYPE = [
        ('rfid',      'RFID/NFC Reader'),
        ('anpr',      'ANPR Camera'),
        ('biometric', 'Biometric Terminal'),
        ('keypad',    'PIN Keypad'),
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_readers')
    zone            = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='readers')
    reader_uid      = models.CharField(max_length=100)
    location_label  = models.CharField(max_length=200)
    hardware_type   = models.CharField(max_length=20, choices=HARDWARE_TYPE, default='rfid')
    ip_address      = models.GenericIPAddressField(null=True, blank=True)
    last_heartbeat  = models.DateTimeField(null=True, blank=True)
    is_active       = models.BooleanField(default=True)
    notes           = models.TextField(blank=True)

    class Meta:
        unique_together = ['marina', 'reader_uid']

    def __str__(self):
        return f"{self.location_label} ({self.reader_uid})"
```

### 3. `ZoneAccessRule`

```python
class ZoneAccessRule(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='zone_rules')
    member_type      = models.CharField(max_length=20, choices=Member.TYPE_CHOICES)
    zones            = models.ManyToManyField(AccessZone, blank=True, related_name='rules')
    link_to_berth_pier = models.BooleanField(
        default=False,
        help_text=(
            "When True, ignore zones M2M. Instead check whether the member's active "
            "Booking/Contract berth pier_label matches the AccessZone name."
        ),
    )

    class Meta:
        unique_together = ['marina', 'member_type']

    def __str__(self):
        return f"{self.marina} — {self.member_type}"
```

### 4. `AccessCard`

```python
class AccessCard(models.Model):
    SUBTYPE_CHOICES = [
        ('owner',      'Owner'),
        ('crew',       'Crew'),
        ('family',     'Family'),
        ('contractor', 'Contractor'),
    ]

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_cards')
    member              = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='access_cards')
    card_uid            = models.CharField(max_length=100)      # Physical RFID card UID (hex)
    facility_code       = models.CharField(max_length=20, blank=True)
    label               = models.CharField(max_length=100, blank=True)  # "Owner card", "Crew — John"
    sub_type            = models.CharField(max_length=20, choices=SUBTYPE_CHOICES, default='owner')
    is_active           = models.BooleanField(default=False)    # Activated on contract start
    zones_override      = models.ManyToManyField(
        AccessZone, blank=True, related_name='card_overrides',
        help_text="If set, overrides ZoneAccessRule for this card only.",
    )
    valid_from          = models.DateField(null=True, blank=True)
    valid_to            = models.DateField(null=True, blank=True)
    issued_at           = models.DateTimeField(auto_now_add=True)
    deactivated_at      = models.DateTimeField(null=True, blank=True)
    deactivation_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        # INVARIANT: member FK is NEVER changed on an existing row.
        # Recycled plastic cards get a NEW AccessCard row (new PK).
        # Only one ACTIVE card per (marina, card_uid) is permitted.
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

**Note:** Card limit is validated in the serializer: `AccessCard.objects.filter(member=card.member, is_active=True).count() >= marina.features.get('max_cards_per_member', 4)` → raise `ValidationError`.

### 5. `AccessEvent`

```python
class AccessEvent(models.Model):
    CREDENTIAL_TYPE = [
        ('card',  'RFID Card'),
        ('face',  'Biometric Face'),
        ('anpr',  'ANPR Plate'),
        ('pin',   'PIN Code'),
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_events')
    reader          = models.ForeignKey(AccessReader, on_delete=models.SET_NULL, null=True, related_name='events')
    credential_type = models.CharField(max_length=10, choices=CREDENTIAL_TYPE)
    card            = models.ForeignKey(AccessCard, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='access_events')
    raw_credential  = models.CharField(max_length=100, blank=True,
                                       help_text="Card UID, plate string, or 'biometric'. Never raw biometric data.")
    granted         = models.BooleanField()
    denial_reason   = models.CharField(max_length=200, blank=True)
    occurred_at     = models.DateTimeField(db_index=True)
    cctv_cameras    = models.ManyToManyField('CCTVCamera', blank=True, related_name='access_events')

    class Meta:
        ordering = ['-occurred_at']
        indexes  = [
            models.Index(fields=['marina', 'occurred_at']),
            models.Index(fields=['marina', 'member', 'occurred_at']),
            models.Index(fields=['marina', 'reader', 'occurred_at']),
        ]
```

### 6. `ANPRCamera`

```python
class ANPRCamera(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='anpr_cameras')
    zone           = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='anpr_cameras')
    camera_uid     = models.CharField(max_length=100)
    location_label = models.CharField(max_length=200)
    ip_address     = models.GenericIPAddressField(null=True, blank=True)
    last_frame_at  = models.DateTimeField(null=True, blank=True)
    is_active      = models.BooleanField(default=True)

    class Meta:
        unique_together = ['marina', 'camera_uid']
```

### 7. `VehicleRegistration`

```python
class VehicleRegistration(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='vehicle_registrations')
    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='vehicles')
    plate_number  = models.CharField(max_length=20)   # Normalised: uppercase, no spaces
    make          = models.CharField(max_length=100, blank=True)
    model         = models.CharField(max_length=100, blank=True)
    colour        = models.CharField(max_length=50, blank=True)
    is_active     = models.BooleanField(default=True)
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['marina', 'plate_number']

    def save(self, *args, **kwargs):
        self.plate_number = self.plate_number.upper().replace(' ', '')
        super().save(*args, **kwargs)
```

### 8. `ANPREvent`

```python
class ANPREvent(models.Model):
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='anpr_events')
    camera          = models.ForeignKey(ANPRCamera, on_delete=models.SET_NULL, null=True, related_name='events')
    plate_detected  = models.CharField(max_length=20)
    vehicle         = models.ForeignKey(VehicleRegistration, on_delete=models.SET_NULL, null=True, blank=True, related_name='anpr_events')
    matched_member  = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='anpr_events')
    access_granted  = models.BooleanField()
    confidence      = models.FloatField(default=1.0)
    occurred_at     = models.DateTimeField(db_index=True)
    staff_reviewed  = models.BooleanField(default=False)
    staff_reviewer  = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='reviewed_anpr_events')

    class Meta:
        ordering = ['-occurred_at']
        indexes  = [
            models.Index(fields=['marina', 'occurred_at']),
            models.Index(fields=['marina', 'plate_detected']),
        ]
```

### 9. `CCTVCamera`

```python
class CCTVCamera(models.Model):
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='cctv_cameras')
    zone                 = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='cctv_cameras')
    camera_uid           = models.CharField(max_length=100)    # NVR channel or RTSP stream ID
    location_label       = models.CharField(max_length=200)
    nvr_ip               = models.GenericIPAddressField(null=True, blank=True)
    nvr_channel          = models.IntegerField(null=True, blank=True)
    viewer_url_template  = models.CharField(max_length=500, blank=True,
                           help_text="URL template. Use {timestamp_iso} and {camera_uid} as placeholders.")
    is_active            = models.BooleanField(default=True)

    class Meta:
        unique_together = ['marina', 'camera_uid']
```

### 10. `BiometricEnrolmentManager` + `BiometricEnrolment`

```python
class BiometricEnrolmentManager(models.Manager):
    """Default manager — excludes rows pending GDPR deletion."""
    def get_queryset(self):
        return super().get_queryset().filter(pending_deletion=False)


class BiometricEnrolment(models.Model):
    """
    Stores ONLY an opaque encrypted template handle from the biometric terminal SDK.
    No raw biometric data, no facial images, no feature vectors stored in DocksBase.
    Schema defined now; terminal SDK integration deferred to v2.
    """
    SUBJECT_TYPE = [('member', 'Member'), ('staff', 'Staff')]
    CONSENT_METHOD = [('portal', 'Boater Portal'), ('staff_app', 'Staff App'), ('admin', 'Admin UI')]

    marina                = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='biometric_enrolments')
    subject_type          = models.CharField(max_length=10, choices=SUBJECT_TYPE)
    member                = models.OneToOneField('members.Member', on_delete=models.CASCADE, null=True, blank=True, related_name='biometric_enrolment')
    staff_member          = models.OneToOneField('staff.StaffMember', on_delete=models.CASCADE, null=True, blank=True, related_name='biometric_enrolment')
    terminal_uid          = models.CharField(max_length=100)
    template_handle       = EncryptedCharField(max_length=500)   # from django-encrypted-model-fields; opaque SDK handle
    consent_given_at      = models.DateTimeField()
    consent_ip            = models.GenericIPAddressField(null=True, blank=True)
    consent_method        = models.CharField(max_length=20, choices=CONSENT_METHOD)
    enrolled_at           = models.DateTimeField(auto_now_add=True)
    revoked_at            = models.DateTimeField(null=True, blank=True)

    # GDPR Art. 17 resilient deletion fields
    pending_deletion       = models.BooleanField(default=False,
        help_text="Set True immediately on DELETE. Hidden from all UI via default manager.")
    pending_deletion_since = models.DateTimeField(null=True, blank=True,
        help_text="Timestamp of DELETE request. Task escalates after 24h stall.")

    objects     = BiometricEnrolmentManager()   # excludes pending_deletion=True
    all_objects = models.Manager()              # unfiltered — Celery deletion task only

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(subject_type='member', member__isnull=False, staff_member__isnull=True) |
                    models.Q(subject_type='staff',  staff_member__isnull=False, member__isnull=True)
                ),
                name='biometric_enrolment_subject_consistency',
            )
        ]
```

**Import:** `from encrypted_model_fields.fields import EncryptedCharField` at the top of `models.py`.

### 11. `SpendAuthorisationRule`

```python
class SpendAuthorisationRule(models.Model):
    ACTION_CHOICES = [
        ('discount',  'Discount'),
        ('write_off', 'Write-off'),
        ('refund',    'Refund'),
        ('override',  'Price Override'),
    ]
    ROLE_CHOICES = [('staff', 'Staff'), ('manager', 'Manager'), ('owner', 'Owner')]

    marina                  = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='spend_rules')
    role                    = models.CharField(max_length=20, choices=ROLE_CHOICES)
    action_type             = models.CharField(max_length=20, choices=ACTION_CHOICES)
    threshold_amount        = models.DecimalField(max_digits=10, decimal_places=2)
    requires_approver_role  = models.CharField(max_length=20, choices=[('manager', 'Manager'), ('owner', 'Owner')])

    class Meta:
        unique_together = ['marina', 'role', 'action_type']
```

### 12. `FraudAnomalyAlert`

Defined before `SpendAuthorisationRequest` because `SpendAuthorisationRequest` has a FK to it.

```python
class FraudAnomalyAlert(models.Model):
    ALERT_TYPE = [
        ('repeated_discount',          'Repeated Discounts'),
        ('large_write_off',            'Large Write-off'),
        ('unusual_refund',             'Unusual Refund Pattern'),
        ('after_hours_sale',           'After-hours Sale'),
        ('forced_override',            'Force-approved spend — retrospective sign-off required'),
        ('biometric_deletion_stalled', 'Biometric terminal unreachable — GDPR deletion pending > 24 h'),
    ]

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='fraud_alerts')
    alert_type         = models.CharField(max_length=30, choices=ALERT_TYPE)
    staff_member       = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, related_name='fraud_alerts')
    period_start       = models.DateTimeField()
    period_end         = models.DateTimeField()
    event_count        = models.IntegerField()
    total_amount       = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    threshold_exceeded = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    sent_at            = models.DateTimeField(auto_now_add=True)
    resolved_at        = models.DateTimeField(null=True, blank=True)
    resolved_by        = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='resolved_fraud_alerts')
    resolution_note    = models.TextField(blank=True)

    class Meta:
        ordering = ['-sent_at']
```

### 13. `SpendAuthorisationRequest`

```python
class SpendAuthorisationRequest(models.Model):
    STATUS_CHOICES = [
        ('pending',    'Pending — POS terminal blocked'),
        ('suspended',  'Parked — terminal freed, awaiting manager'),
        ('overridden', 'Force-approved by staff — retrospective sign-off required'),
        ('approved',   'Approved'),
        ('denied',     'Denied'),
        ('expired',    'Expired'),
    ]

    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='spend_requests')
    rule                 = models.ForeignKey(SpendAuthorisationRule, on_delete=models.PROTECT, related_name='requests')
    action_type          = models.CharField(max_length=20, choices=SpendAuthorisationRule.ACTION_CHOICES)
    amount               = models.DecimalField(max_digits=10, decimal_places=2)
    description          = models.TextField()
    requested_by         = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, related_name='spend_requests_made')
    approver             = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='spend_requests_actioned')
    status               = models.CharField(max_length=12, choices=STATUS_CHOICES, default='pending')
    requested_at         = models.DateTimeField(auto_now_add=True)
    actioned_at          = models.DateTimeField(null=True, blank=True)
    approver_note        = models.TextField(blank=True)

    # Path A — Park Transaction
    suspended_at         = models.DateTimeField(null=True, blank=True)

    # Path B — Force Override
    override_forced_by   = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='forced_spend_overrides')
    override_forced_at   = models.DateTimeField(null=True, blank=True)
    override_fraud_alert = models.OneToOneField(FraudAnomalyAlert, on_delete=models.SET_NULL, null=True, blank=True, related_name='spend_override_request')

    # Financial document references — explicit FKs, no GFK
    invoice              = models.ForeignKey('billing.Invoice', on_delete=models.CASCADE, null=True, blank=True, related_name='spend_requests')
    fuel_dock_entry      = models.ForeignKey('fuel_dock.FuelDockEntry', on_delete=models.CASCADE, null=True, blank=True, related_name='spend_requests')
    pos_order            = models.ForeignKey('sales.Sale', on_delete=models.CASCADE, null=True, blank=True, related_name='spend_requests')

    class Meta:
        ordering = ['-requested_at']
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(invoice__isnull=False) |
                    models.Q(fuel_dock_entry__isnull=False) |
                    models.Q(pos_order__isnull=False)
                ),
                name='spend_auth_requires_financial_reference',
            )
        ]
```

**Note on `pos_order` FK:** The spec references `pos.POSOrder`. In the existing codebase the POS model lives in `apps/sales`. Verify the exact model name (`Sale` or `POSOrder`) in `apps/sales/models.py` and adjust the FK app label accordingly.

---

## Hardware Abstraction Layer

### `hal/base.py`

Define three abstract base classes exactly as the spec Section 2.2:
- `AccessControlAdapter` — `grant_access`, `revoke_access`, `sync_zone`, `get_reader_status`, `register_webhook`
- `ANPRAdapter` — `get_recent_reads`, `register_webhook`
- `BiometricAdapter` — `enrol_face`, `revoke_face`, `get_terminal_status`

Also define `CardCredential` and `ReaderStatus` dataclasses in this file.

### `hal/adapters/demo.py`

`DemoAccessAdapter`, `DemoANPRAdapter`, `DemoBiometricAdapter` — each inherits from the corresponding ABC. All methods log their call via `logging.getLogger(__name__).debug(...)` and return `True` / appropriate success values. These are the only adapters shipped in v1; Paxton Net2 and Salto stubs are commented in the factory.

### `hal/factory.py`

```python
from .base import AccessControlAdapter, ANPRAdapter, BiometricAdapter
from .adapters.demo import DemoAccessAdapter, DemoANPRAdapter, DemoBiometricAdapter

RFID_ADAPTERS = {
    'demo': DemoAccessAdapter,
    # 'paxton_net2': PaxtonNet2Adapter,   # priority 1 — Paxton dominates UK/EU SME market
    # 'salto':       SaltoAdapter,         # priority 2 — wireless, battery-powered pontoon locks
    # 'hid_vertx':   HIDVertxAdapter,      # later cycle
}

ANPR_ADAPTERS = {'demo': DemoANPRAdapter}
BIOMETRIC_ADAPTERS = {'demo': DemoBiometricAdapter}

def get_rfid_adapter(marina) -> AccessControlAdapter:
    key = (marina.features or {}).get('rfid_adapter', 'demo')
    return RFID_ADAPTERS.get(key, DemoAccessAdapter)(marina)

def get_anpr_adapter(marina) -> ANPRAdapter:
    key = (marina.features or {}).get('anpr_adapter', 'demo')
    return ANPR_ADAPTERS.get(key, DemoANPRAdapter)(marina)

def get_biometric_adapter(marina) -> BiometricAdapter:
    key = (marina.features or {}).get('biometric_adapter', 'demo')
    return BIOMETRIC_ADAPTERS.get(key, DemoBiometricAdapter)(marina)
```

---

## Services

### `services/zone_engine.py` — `member_can_access_zone(member, zone, as_of=None) -> bool`

Resolution order (must match this exactly, no changes):

1. Check `AccessCard.zones_override` M2M for the presented card — if the zone is in the override set, return `True`. (Caller passes the card object separately when known.)
2. Look up `ZoneAccessRule` for `marina=member.marina, member_type=member.member_type`. If none exists, return `False`.
3. If `rule.link_to_berth_pier=True`: query active `Booking` (status='confirmed', arrival_date<=as_of, departure_date>=as_of) and `Contract` (status='active', date range) for `berth__pier_label`. Return `zone.name in active_berth_zone_names`.
4. Otherwise: return `rule.zones.filter(pk=zone.pk).exists()`.

```python
def member_can_access_zone(member, zone, as_of=None) -> bool:
    from datetime import date
    from reservations.models import Booking
    from members.models import Contract   # adjust import if Contract lives elsewhere

    as_of = as_of or date.today()
    rule = ZoneAccessRule.objects.filter(marina=member.marina, member_type=member.member_type).first()
    if rule is None:
        return False
    if rule.link_to_berth_pier:
        pier_labels = set(
            Booking.objects.filter(
                member=member, status='confirmed',
                arrival_date__lte=as_of, departure_date__gte=as_of,
            ).values_list('berth__pier_label', flat=True)
        )
        # Add Contract pier labels here once Contract model is confirmed
        return zone.name in pier_labels
    return rule.zones.filter(pk=zone.pk).exists()
```

### `services/fraud_detector.py` — `detect_fraud_for_marina(marina)`

Reads thresholds from `marina.features` with these defaults (seeded in migration 0002):
- `fraud_discount_count_threshold`: `3`
- `fraud_writeoff_threshold_amount`: `200.00`
- `fraud_after_hours_start`: `"22:00"`
- `fraud_after_hours_end`: `"06:00"`

Three rules:
1. Count discounts by staff member in a rolling 24h window. If count > threshold → create `FraudAnomalyAlert(alert_type='repeated_discount')`.
2. Any single write-off `amount > fraud_writeoff_threshold_amount` by a non-manager → create `FraudAnomalyAlert(alert_type='large_write_off')`.
3. Sales timestamped between `fraud_after_hours_start` and `fraud_after_hours_end` → create `FraudAnomalyAlert(alert_type='after_hours_sale')`.

All created alerts check first whether an identical unresolved alert already exists to prevent duplicate rows.

### `services/card_lifecycle.py` — `deactivate_expired_cards_for_marina(marina)`

Used by the daily Celery task. Queries `AccessCard.objects.filter(marina=marina, is_active=True, valid_to__lt=today)`, sets `is_active=False`, `deactivated_at=now()`, `deactivation_reason='Expired (valid_to date passed)'`, saves each individually (to trigger the post_save signal), then dispatches `revoke_access_on_card_deactivate.delay(card_id=card.pk)`.

---

## Signals (`signals.py`)

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.db import transaction

@receiver(post_save, sender='access_control.AccessCard')
def on_access_card_saved(sender, instance, created, **kwargs):
    """
    When a card transitions to is_active=False, dispatch hardware revoke
    inside on_commit so the hardware call fires only after the DB write commits.
    Uses django-model-utils FieldTracker if available; otherwise checks deactivated_at.
    """
    if not instance.is_active and instance.deactivated_at:
        transaction.on_commit(
            lambda card_id=instance.pk: revoke_access_on_card_deactivate.delay(card_id=card_id)
        )
```

Register signals in `apps.py`:

```python
class AccessControlConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.access_control'

    def ready(self):
        import apps.access_control.signals  # noqa
```

---

## API Endpoints

Base path: `/api/v1/access-control/`

All ViewSets inherit from a `MarinaFilteredViewSet` mixin that:
1. Filters `get_queryset()` to `marina=request.user.marina`.
2. Injects `marina` on `perform_create()`.

### Access Zones

| Method | URL | Notes |
|---|---|---|
| GET | `/zones/` | List all zones |
| POST | `/zones/` | Create zone |
| PATCH | `/zones/{id}/` | Update |
| DELETE | `/zones/{id}/` | Blocked if readers/rules reference it (Django `PROTECT` FK raises `ProtectedError` → return 409) |

### Access Readers

| Method | URL | Notes |
|---|---|---|
| GET/POST/PATCH/DELETE | `/readers/` | CRUD |
| POST | `/readers/{id}/sync/` | Dispatches `sync_zone_task.delay(reader_id)` → 202 Accepted |

### Zone Access Rules

| Method | URL | Notes |
|---|---|---|
| GET/POST/PATCH | `/zone-rules/` | CRUD |

PATCH triggers a background Celery task that calls `grant_access`/`revoke_access` on all affected readers. Returns 202.

### Access Cards

| Method | URL | Notes |
|---|---|---|
| GET | `/cards/?member={id}` | Filtered list |
| POST | `/cards/` | Serializer validates card limit |
| PATCH | `/cards/{id}/` | |
| POST | `/cards/{id}/activate/` | Sets `is_active=True`, dispatches `grant_access` HAL call |
| POST | `/cards/{id}/deactivate/` | Sets `is_active=False`, `deactivated_at`, reason required |

### Access Events (read-only)

| Method | URL | Notes |
|---|---|---|
| GET | `/events/` | Filter by `?member`, `?reader`, `?zone`, `?granted`, `?from`, `?to`, `?credential_type` |

Response includes `cctv_cameras[].viewer_url` (substituted from `viewer_url_template`) and `cctv_cameras[].copy_label` (formatted timestamp + camera UID for clipboard fallback). Computed in `AccessEventSerializer`.

### ANPR (feature-gated: `marina.features['anpr_enabled'] == True`)

All ANPR endpoints check `marina.features.get('anpr_enabled', False)` in a permission class. Return `403 {"detail": "ANPR module not enabled for this marina."}` if flag is false.

| Method | URL |
|---|---|
| GET/POST/PATCH | `/anpr-cameras/` |
| GET/POST/PATCH/DELETE | `/vehicles/?member={id}` |
| GET | `/anpr-events/?plate=&member=&camera=&access_granted=&unrecognised=true&from=&to=` |

### CCTV Registry

| Method | URL |
|---|---|
| GET/POST/PATCH/DELETE | `/cctv-cameras/` |

### Biometric Enrolments (feature-gated: `marina.features['biometric_enabled'] == True`)

| Method | URL | Notes |
|---|---|---|
| GET | `/biometric-enrolments/` | Lists active enrolments (pending_deletion excluded by default manager) |
| POST | `/biometric-enrolments/` | Creates enrolment record (v2: triggers terminal SDK; v1: creates record only) |
| DELETE | `/biometric-enrolments/{id}/` | GDPR Art. 17 — see deletion flow below |

**DELETE flow:**
1. Set `pending_deletion=True`, `pending_deletion_since=now()`. Save.
2. Return `202 Accepted` immediately.
3. Dispatch `revoke_biometric_enrolment.apply_async(args=[enrolment.pk])`.
The enrolment is now invisible to all UI (default manager filters it out).

### Fraud Prevention

| Method | URL | Notes |
|---|---|---|
| GET/POST/PATCH | `/spend-rules/` | CRUD |
| GET/POST | `/spend-requests/` | |
| POST | `/spend-requests/{id}/approve/` | Requires `approver_role` check |
| POST | `/spend-requests/{id}/deny/` | Requires `approver_role` check |
| POST | `/spend-requests/{id}/suspend/` | Path A — Park Transaction |
| POST | `/spend-requests/{id}/force-override/` | Path B — auto-creates `FraudAnomalyAlert(alert_type='forced_override')` |
| GET | `/fraud-alerts/` | Unresolved alerts |
| POST | `/fraud-alerts/{id}/resolve/` | Requires resolution note |

### Ingest Webhooks (hardware → DocksBase)

| Method | URL | Auth |
|---|---|---|
| POST | `/ingest/rfid/` | HMAC-SHA256 `X-DocksBase-Signature` against `marina.features['access_webhook_secret']` |
| POST | `/ingest/anpr/` | Same HMAC auth |
| POST | `/ingest/biometric/` | Same HMAC auth |

All three return `204 No Content`. ANPR ingest applies Redis debounce (see below).

**ANPR ingest debounce implementation:**

```python
# views/ingest.py
import hashlib, hmac
from django.core.cache import cache
from django.conf import settings

def anpr_ingest(request, marina):
    # 1. Validate HMAC signature
    secret = marina.features.get('access_webhook_secret', '')
    sig    = request.headers.get('X-DocksBase-Signature', '')
    expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return Response(status=403)

    payload    = get_anpr_adapter(marina).normalise(request.data)
    camera_uid = payload['camera_uid']
    plate      = payload['plate'].upper().replace(' ', '')
    confidence = payload['confidence']

    # 2. Confidence floor
    threshold = marina.features.get('anpr_confidence_threshold', 0.85)
    if confidence < threshold:
        return Response(status=204)

    # 3. Redis debounce — suppress duplicate frames from the same vehicle pass
    ttl           = marina.features.get('anpr_debounce_seconds', 60)
    debounce_key  = f"anpr:{marina.pk}:{camera_uid}:{plate}"
    if not cache.add(debounce_key, '1', timeout=ttl):
        return Response(status=204)   # duplicate frame within window — drop silently

    # 4. First frame — create ANPREvent, trigger gate logic
    ANPREvent.objects.create(
        marina=marina, camera_uid=camera_uid,
        plate_detected=plate, confidence=confidence,
        access_granted=False, occurred_at=now(),
    )
    trigger_gate_if_authorised(marina, plate)
    return Response(status=204)
```

`cache.add()` is atomic — it sets the key only if it does not already exist and returns `True` on success, `False` if the key was already present. Use `django.core.cache.cache` (configured as Redis in settings).

---

## Celery Tasks (`tasks.py`)

All tasks are written as regular functions now. When Celery is introduced, decorate with `@shared_task`. Until then, call `transaction.on_commit(lambda: task_function(args))` for deferred work.

| Task | Schedule | Description |
|---|---|---|
| `sync_zone_task(reader_id)` | On-demand | Calls `adapter.sync_zone(reader_uid, allowed_cards)` for all active cards with access to the reader's zone |
| `revoke_access_on_card_deactivate(card_id)` | On-demand (via signal on_commit) | Calls `adapter.revoke_access(reader_uid, card_credential)` for each reader in all zones the card had access to |
| `deactivate_expired_access_cards()` | Daily at 01:00 | Queries `AccessCard.objects.filter(is_active=True, valid_to__lt=today)`, deactivates each, dispatches hardware revoke |
| `detect_fraud_anomalies()` | Daily at 03:00 | Calls `fraud_detector.detect_fraud_for_marina(marina)` for each marina |
| `purge_old_access_events()` | Nightly at 02:00 | Deletes `AccessEvent` records older than `marina.features.get('access_log_retention_days', 730)` days; pseudonymises `ANPREvent` records (set `matched_member=None`, hash `plate_detected`) |
| `revoke_biometric_enrolment(enrolment_pk)` | On-demand, exponential backoff | Calls `BiometricAdapter.revoke_face(terminal_uid, template_handle)`. On success: hard-deletes `BiometricEnrolment` row. On failure after 24h: creates `FraudAnomalyAlert(alert_type='biometric_deletion_stalled')`. `max_retries=20`, doubling from 30s to ~6h max interval. Uses `all_objects` manager (unfiltered). |

**`revoke_biometric_enrolment` implementation notes:**

```python
def revoke_biometric_enrolment(enrolment_pk):
    from django.utils import timezone
    enrolment = BiometricEnrolment.all_objects.filter(pk=enrolment_pk).first()
    if enrolment is None:
        return  # already deleted — idempotent

    adapter = get_biometric_adapter(enrolment.marina)
    try:
        success = adapter.revoke_face(enrolment.terminal_uid, enrolment.template_handle)
    except Exception:
        success = False

    if success:
        enrolment.delete()   # hard delete — no residual biometric handle in DB
        return

    # Failed — check staleness
    if enrolment.pending_deletion_since:
        elapsed = timezone.now() - enrolment.pending_deletion_since
        if elapsed.total_seconds() > 86400:  # 24 hours
            FraudAnomalyAlert.objects.get_or_create(
                marina=enrolment.marina,
                alert_type='biometric_deletion_stalled',
                resolved_at__isnull=True,
                defaults={...}  # include terminal_uid and subject name in details
            )

    # Re-queue with exponential backoff (when Celery is available)
    raise Exception("Terminal unreachable — will retry")
```

---

## Admin (`admin.py`)

Register all models with at minimum:
- `AccessZone` — list_display: name, marina, is_restricted
- `AccessReader` — list_display: location_label, zone, hardware_type, is_active, last_heartbeat
- `ZoneAccessRule` — list_display: marina, member_type, link_to_berth_pier; inline for zones M2M
- `AccessCard` — list_display: member, card_uid, sub_type, is_active, valid_from, valid_to; search_fields: card_uid, member__name; list_filter: is_active, marina
- `AccessEvent` — read-only; list_display: occurred_at, reader, credential_type, granted, member; no add/change (immutable log)
- `ANPRCamera`, `VehicleRegistration`, `ANPREvent` — read-only event log
- `CCTVCamera`
- `BiometricEnrolment` — list_display: subject_type, terminal_uid, enrolled_at, pending_deletion; hide `template_handle` in readonly_fields (never show raw value)
- `SpendAuthorisationRule`, `SpendAuthorisationRequest`, `FraudAnomalyAlert`

---

## Settings & URL Wiring

### `config/settings/base.py`

```python
LOCAL_APPS = [
    ...
    'apps.access_control',
]

# Encryption key for BiometricEnrolment.template_handle
FIELD_ENCRYPTION_KEY = os.environ.get('BIOMETRIC_FIELD_KEY', '')

# Redis cache (must be configured for ANPR debounce)
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': os.environ.get('REDIS_URL', 'redis://localhost:6379/1'),
    }
}
```

### `config/urls.py`

```python
path('api/v1/access-control/', include('apps.access_control.urls')),
```

Place after existing ERP track includes.

### `apps/access_control/urls.py`

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import zones, readers, cards, events, anpr, cctv, biometric, fraud, ingest

router = DefaultRouter()
router.register(r'zones',                zones.AccessZoneViewSet,          basename='accesszone')
router.register(r'readers',             readers.AccessReaderViewSet,       basename='accessreader')
router.register(r'zone-rules',          zones.ZoneAccessRuleViewSet,       basename='zoneaccessrule')
router.register(r'cards',               cards.AccessCardViewSet,           basename='accesscard')
router.register(r'events',              events.AccessEventViewSet,         basename='accessevent')
router.register(r'anpr-cameras',        anpr.ANPRCameraViewSet,            basename='anprcamera')
router.register(r'vehicles',            anpr.VehicleRegistrationViewSet,   basename='vehicleregistration')
router.register(r'anpr-events',         anpr.ANPREventViewSet,             basename='anprevent')
router.register(r'cctv-cameras',        cctv.CCTVCameraViewSet,            basename='cctvcamera')
router.register(r'biometric-enrolments', biometric.BiometricEnrolmentViewSet, basename='biometricenrolment')
router.register(r'spend-rules',         fraud.SpendAuthorisationRuleViewSet, basename='spendrule')
router.register(r'spend-requests',      fraud.SpendAuthorisationRequestViewSet, basename='spendrequest')
router.register(r'fraud-alerts',        fraud.FraudAnomalyAlertViewSet,    basename='fraudalert')

urlpatterns = [
    path('', include(router.urls)),
    path('ingest/rfid/',      ingest.rfid_ingest,      name='ingest-rfid'),
    path('ingest/anpr/',      ingest.anpr_ingest,      name='ingest-anpr'),
    path('ingest/biometric/', ingest.biometric_ingest, name='ingest-biometric'),
]
```

---

## Migration Notes

### Migration 0001 — initial models

One migration for all 13 models. Check for cross-app FK availability:
- `billing.Invoice` — must exist (it does)
- `staff.StaffMember` — must exist (it does)
- `berths.Berth.pier_label` — must exist (add to berths app first)

### Migration 0002 — seed default fraud thresholds

Data migration that updates `Marina.features` for all existing marinas with the fraud detection defaults:

```python
def seed_fraud_defaults(apps, schema_editor):
    Marina = apps.get_model('accounts', 'Marina')
    defaults = {
        'fraud_discount_count_threshold': 3,
        'fraud_writeoff_threshold_amount': '200.00',
        'fraud_after_hours_start': '22:00',
        'fraud_after_hours_end': '06:00',
        'max_cards_per_member': 4,
        'anpr_debounce_seconds': 60,
        'anpr_confidence_threshold': 0.85,
        'access_log_retention_days': 730,
    }
    for marina in Marina.objects.all():
        for key, val in defaults.items():
            marina.features.setdefault(key, val)
        marina.save(update_fields=['features'])
```

---

## Implementation Order (Numbered Steps)

Execute in this order. Do not reorder — each step depends on the previous.

**Step 1 — Prerequisite: `berths.Berth.pier_label`**
- File: `apps/berths/models.py`
- Add `pier_label = models.CharField(max_length=50, blank=True)` to `Berth` model.
- Run `python manage.py makemigrations berths`.
- Run `python manage.py migrate berths`.

**Step 2 — Install encryption library**
- `pip install django-encrypted-model-fields`
- Add `FIELD_ENCRYPTION_KEY` to `.env` and `config/settings/base.py`.
- Add `encrypted_model_fields` to `THIRD_PARTY_APPS` in `settings/base.py`.

**Step 3 — Create the `access_control` Django app**
- `python manage.py startapp access_control apps/access_control`
- Create `apps/access_control/apps.py` with `AccessControlConfig` class (including `ready()` to import signals).
- Create all directories: `views/`, `services/`, `hal/`, `hal/adapters/`, `migrations/`.
- Add `'apps.access_control'` to `LOCAL_APPS` in `config/settings/base.py`.

**Step 4 — Write HAL base classes and demo adapters**
- Files: `hal/base.py`, `hal/adapters/demo.py`, `hal/factory.py`
- Copy ABC definitions verbatim from spec Section 2.2.
- Write `DemoAccessAdapter`, `DemoANPRAdapter`, `DemoBiometricAdapter` — log calls, return `True`.
- Write factory functions.
- No migrations needed for this step.

**Step 5 — Write all models**
- File: `apps/access_control/models.py`
- Write models in the order defined above (respects FK dependencies).
- Import `EncryptedCharField` from `encrypted_model_fields.fields`.
- Import `Member.TYPE_CHOICES` from `members.models` at the top (or inline in the field).

**Step 6 — Generate and run migrations**
- `python manage.py makemigrations access_control`
- Inspect the generated migration — confirm all FKs resolve correctly.
- `python manage.py migrate access_control`

**Step 7 — Write data migration for fraud threshold defaults**
- File: `apps/access_control/migrations/0002_seed_fraud_thresholds.py`
- Implement `seed_fraud_defaults` as shown above.
- Run `python manage.py migrate access_control`.

**Step 8 — Wire URLs**
- File: `apps/access_control/urls.py` — create with router registration as shown.
- File: `config/urls.py` — add `path('api/v1/access-control/', include('apps.access_control.urls'))`.

**Step 9 — Write service layer**
- File: `services/zone_engine.py` — `member_can_access_zone()` as described.
- File: `services/fraud_detector.py` — three anomaly rules.
- File: `services/card_lifecycle.py` — `deactivate_expired_cards_for_marina()`.

**Step 10 — Write signals**
- File: `apps/access_control/signals.py`
- `post_save` on `AccessCard` → dispatch hardware revoke inside `transaction.on_commit()` when `is_active` is False and `deactivated_at` is set.
- Confirm `apps.py` `ready()` imports signals.

**Step 11 — Write Celery tasks**
- File: `apps/access_control/tasks.py`
- Implement all six tasks as described.
- For now, write as plain functions. Decorator stub: `# @shared_task` commented above each def.
- Register `deactivate_expired_access_cards`, `detect_fraud_anomalies`, `purge_old_access_events` in Celery beat schedule (comment in `settings/base.py` until Celery is wired).

**Step 12 — Write serializers**
- File: `apps/access_control/serializers.py` (one serializer class per model).
- `AccessEventSerializer.to_representation()` must compute `cctv_cameras[].viewer_url` and `cctv_cameras[].copy_label`.
- `AccessCardSerializer.validate()` must enforce `max_cards_per_member` limit.
- `ANPRCameraSerializer`, `VehicleRegistrationSerializer` — check `marina.features.get('anpr_enabled')` in `validate()`.

**Step 13 — Write ViewSets**
- One file per resource group in `views/`.
- All inherit from `MarinaFilteredViewSet` mixin.
- `AccessCardViewSet` — add `activate` and `deactivate` `@action` decorators.
- `AccessReaderViewSet` — add `sync` `@action`.
- `SpendAuthorisationRequestViewSet` — add `approve`, `deny`, `suspend`, `force_override` actions.
- `FraudAnomalyAlertViewSet` — add `resolve` action.
- `BiometricEnrolmentViewSet` — override `destroy()` to implement async GDPR deletion flow.

**Step 14 — Write ingest webhook views**
- File: `views/ingest.py`
- Implement HMAC validation helper.
- Implement `rfid_ingest`, `anpr_ingest`, `biometric_ingest` views.
- `anpr_ingest` must apply the Redis debounce as shown in the API section.
- All return `204 No Content`.

**Step 15 — Write admin registrations**
- File: `apps/access_control/admin.py`
- Register all models. Mark `AccessEvent` and `ANPREvent` as read-only (no add/change permission). Never display `template_handle` raw value.

**Step 16 — Write tests**

Write these test cases:

```
tests/test_zone_engine.py
    - test_link_to_berth_pier_allows_correct_pier
    - test_link_to_berth_pier_denies_wrong_pier
    - test_flat_zone_rule_allows_member_type
    - test_no_rule_denies

tests/test_card_lifecycle.py
    - test_card_reissue_preserves_access_event_history
    - test_unique_active_card_uid_per_marina_constraint
    - test_deactivate_expired_cards_task

tests/test_anpr.py
    - test_anpr_debounce_20_identical_webhooks_creates_one_event
    - test_anpr_confidence_floor_drops_low_confidence
    - test_plate_normalisation_uppercase_no_spaces
    - test_anpr_disabled_feature_flag_returns_403

tests/test_biometric.py
    - test_delete_sets_pending_deletion_immediately
    - test_pending_deletion_hidden_from_default_manager
    - test_revoke_task_hard_deletes_on_success
    - test_revoke_task_creates_stall_alert_after_24h

tests/test_spend_auth.py
    - test_suspend_sets_suspended_at_no_fraud_alert
    - test_force_override_creates_fraud_anomaly_alert
    - test_approve_requires_correct_role

tests/test_hal.py
    - test_factory_returns_demo_adapter_by_default
    - test_factory_reads_rfid_adapter_from_marina_features

tests/test_ingest.py
    - test_rfid_ingest_hmac_validation
    - test_anpr_ingest_hmac_validation
    - test_biometric_ingest_hmac_validation
```

---

## Frontend Notes (for frontend developers)

These are reference notes only — backend plan does not implement frontend.

- Sidebar group: "Security" — visible to `owner`/`manager` roles only.
- Main screen: `SecurityAccessScreen.jsx` — four tabs: Zones & Rules, Readers, Cards, Event Log.
- `card_uid` input field: plain text input that receives USB HID keyboard-wedge RFID reader input. No WebUSB API required.
- ANPR screen: `SecurityANPRScreen.jsx` — hidden when `marina.features.anpr_enabled` is false.
- Biometric screen: `SecurityBiometricScreen.jsx` — oversight/revocation only; no enrolment in v1.
- Fraud screen: `SecurityFraudScreen.jsx` — Spend Rules matrix, Pending Approvals (30s polling), Anomaly Alerts.
- React Query hooks: `useAccessZones`, `useAccessCards`, `useAccessEvents`, `useANPREvents`, `useVehicleRegistrations`, `useCCTVCameras`, `useBiometricEnrolments`, `useSpendRules`, `useSpendRequests`, `useFraudAlerts`.
