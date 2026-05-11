# Track 9 — Charter & Commercial Harbour: Implementation Plan
Date: 2026-05-08
Based on spec: `docs/superpowers/specs/2026-05-07-track-09-charter-commercial-harbour-design.md`

---

## Overview

Two new Django apps:
- `apps/charter/` — charter fleet, rental units, OTA webhook integration
- `apps/harbour/` — commercial vessel movements, tariff engine, port reports

Feature-flagged at marina level: `marina.charter_enabled` / `marina.harbour_enabled`. All monetary flows route through `billing.ChargeableItem` → `billing.InvoiceLineItem` → `billing.Invoice`. No prices are stored directly in charter or harbour fields.

---

## Part 1: Pre-App Changes to Existing Models

### 1.1 Extend `billing.ChargeableItem`

**File:** `apps/billing/models.py`

Add to `ChargeableItem.Category`:
```python
CHARTER       = 'charter',        'Charter Fee'         # already exists — VERIFY, do not duplicate
HARBOUR_TARIFF = 'harbour_tariff', 'Harbour Tariff'
```

Add to `ChargeableItem.PricingModel`:
```python
PER_WEEK         = 'per_week',         'Per Week'
PER_PASSENGER    = 'per_passenger',    'Per Passenger'
PER_GROSS_TON    = 'per_gross_ton',    'Per Gross Ton'
PER_TON_DISTANCE = 'per_ton_distance', 'Per Ton × Distance'
```

> NOTE: Checking `billing/models.py` — `CHARTER = 'charter', 'Charter Fee'` is already present in the codebase. Only add `HARBOUR_TARIFF` and the four new `PricingModel` choices. Run `makemigrations billing` after.

### 1.2 Extend `billing.Invoice`

**File:** `apps/billing/models.py`

Add these two fields to `Invoice`:
```python
invoice_type = models.CharField(
    max_length=20,
    choices=[('invoice', 'Invoice'), ('credit_note', 'Credit Note')],
    default='invoice',
)
related_invoice = models.ForeignKey(
    'self',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='credit_notes',
    help_text='For credit notes: points to the original invoice being neutralised.',
)
```

Also add the `tenant` FK (needed by both Track 9 harbour invoices and Track 10 tenants — add once):
```python
tenant = models.ForeignKey(
    'tenants.TenantContact',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='invoices',
)
```

> If Track 10 has not merged yet, use `'tenants.TenantContact'` string reference — Django resolves lazily. Add the field now; it stays null for all existing invoices.

Add `shipping_agent` FK for consolidated harbour agency billing:
```python
shipping_agent = models.ForeignKey(
    'harbour.ShippingAgent',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='invoices',
)
```

Run `makemigrations billing` after all four field additions.

### 1.3 Extend `staff.StaffMember`

**File:** `apps/staff/models.py`

Add:
```python
is_contractor = models.BooleanField(
    default=False,
    help_text='Contractor skippers appear in charter assignments but are excluded from payroll views.',
)
```

Run `makemigrations staff`.

Update existing payroll/HR list views to add `is_contractor=False` as a default queryset filter with a toggle to show all.

### 1.4 Extend `documents.DocTemplate`

**File:** `apps/documents/models.py`

The `CATEGORY` list needs `'charter_agreement'` so the booking wizard can filter templates:
```python
CATEGORY = [
    ('lease',             'Lease'),
    ('insurance',         'Insurance'),
    ('waiver',            'Waiver'),
    ('charter_agreement', 'Charter Agreement'),
    ('other',             'Other'),
]
```

Run `makemigrations documents`.

---

## Part 2: `charter` App

### 2.1 App Skeleton

```
apps/charter/
    __init__.py
    apps.py
    models.py
    serializers.py
    views.py
    urls.py
    admin.py
    signals.py
    services.py
    ota/
        __init__.py
        base.py          # OTAAdapter abstract interface
        zizoo.py
        click_and_boat.py
```

**`apps/charter/apps.py`:**
```python
from django.apps import AppConfig

class CharterConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.charter'

    def ready(self):
        import apps.charter.signals  # noqa: F401
```

### 2.2 Models (`apps/charter/models.py`)

Install `django-model-utils` if not already present (`pip install django-model-utils`). Add to `requirements.txt`.

```python
from decimal import Decimal
from datetime import timedelta
from django.db import models
from model_utils import FieldTracker


class CharterVessel(models.Model):
    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_vessels')
    vessel             = models.OneToOneField('vessels.Vessel', on_delete=models.CASCADE, related_name='charter_profile')
    hourly_rate_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_hourly')
    daily_rate_item    = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_daily')
    weekly_rate_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_weekly')
    cleaning_fee_item  = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_cleaning')
    skipper_fee_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_skipper')
    fuel_inclusive     = models.BooleanField(default=False)
    skipper_required   = models.BooleanField(default=False)
    min_charterer_qual = models.CharField(max_length=200, blank=True)
    security_deposit   = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    max_duration_days  = models.IntegerField(null=True, blank=True)
    is_available       = models.BooleanField(default=True)
    notes              = models.TextField(blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['vessel__name']

    def __str__(self):
        return f'Charter: {self.vessel.name}'


class CharterManagementAgreement(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_management_agreements')
    charter_vessel   = models.ForeignKey(CharterVessel, on_delete=models.CASCADE, related_name='management_agreements')
    member           = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_management_agreements')
    owner_label      = models.CharField(max_length=200, blank=True)
    split_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    commission_rate  = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    valid_from       = models.DateField()
    valid_to         = models.DateField(null=True, blank=True)
    notes            = models.TextField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['charter_vessel', 'valid_from']

    def __str__(self):
        return f'{self.charter_vessel.vessel.name} — {self.owner_label or "Marina"} {self.split_percentage}%'


class CharterBooking(models.Model):
    class Status(models.TextChoices):
        ENQUIRY   = 'enquiry',   'Enquiry'
        CONFIRMED = 'confirmed', 'Confirmed'
        ACTIVE    = 'active',    'Active (On Charter)'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    class DepositStatus(models.TextChoices):
        PENDING   = 'pending',   'Pending'
        HELD      = 'held',      'Held'
        RELEASED  = 'released',  'Released'
        WITHHELD  = 'withheld',  'Partially/Fully Withheld'

    class DepositMechanism(models.TextChoices):
        AUTH_HOLD = 'auth_hold', 'Stripe Auth & Hold (< 7 days)'
        CAPTURED  = 'captured',  'Captured to Card + Credit Account Liability (>= 7 days)'

    class DurationUnit(models.TextChoices):
        HOURLY = 'hourly', 'Hourly'
        DAILY  = 'daily',  'Daily'
        WEEKLY = 'weekly', 'Weekly'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_bookings')
    charter_vessel      = models.ForeignKey(CharterVessel, on_delete=models.PROTECT, related_name='bookings')
    charterer           = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_bookings')
    charterer_name      = models.CharField(max_length=200, blank=True)
    charterer_email     = models.EmailField(blank=True)
    charterer_phone     = models.CharField(max_length=30, blank=True)
    skipper             = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_assignments')
    start_dt            = models.DateTimeField()
    end_dt              = models.DateTimeField()
    duration_unit       = models.CharField(max_length=10, choices=DurationUnit.choices, default=DurationUnit.DAILY)
    rate_applied        = models.DecimalField(max_digits=10, decimal_places=2)
    fuel_inclusive      = models.BooleanField(default=False)
    cleaning_fee        = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    skipper_fee         = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    deposit_amount      = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    deposit_status      = models.CharField(max_length=20, choices=DepositStatus.choices, default=DepositStatus.PENDING)
    deposit_mechanism   = models.CharField(max_length=20, choices=DepositMechanism.choices, blank=True)
    deposit_stripe_payment_intent = models.CharField(max_length=200, blank=True)
    subtotal            = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total               = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    channel             = models.CharField(max_length=50, blank=True)
    channel_ref         = models.CharField(max_length=200, blank=True)
    channel_commission  = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    invoice             = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_bookings')
    status              = models.CharField(max_length=20, choices=Status.choices, default=Status.ENQUIRY)
    internal_notes      = models.TextField(blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    tracker = FieldTracker(fields=['subtotal'])

    class Meta:
        ordering = ['-start_dt']
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'channel', 'channel_ref'],
                condition=models.Q(channel_ref__gt=''),
                name='unique_ota_charter_booking_per_marina_channel',
            )
        ]

    def __str__(self):
        return f'Charter #{self.pk} — {self.charter_vessel.vessel.name} ({self.start_dt.date()})'


class CharterAgreement(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_agreements')
    booking     = models.OneToOneField(CharterBooking, on_delete=models.CASCADE, related_name='agreement')
    envelope    = models.ForeignKey('documents.Envelope', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_agreements')
    signed_at   = models.DateTimeField(null=True, blank=True)
    charterer_ip = models.GenericIPAddressField(null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Agreement — Charter #{self.booking_id}'


class CharterAgentCommission(models.Model):
    class PaymentStatus(models.TextChoices):
        PENDING  = 'pending',  'Pending'
        APPROVED = 'approved', 'Approved'
        PAID     = 'paid',     'Paid'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_agent_commissions')
    booking           = models.ForeignKey(CharterBooking, on_delete=models.CASCADE, related_name='agent_commissions')
    agent_name        = models.CharField(max_length=200)
    agent_email       = models.EmailField(blank=True)
    commission_rate   = models.DecimalField(max_digits=5, decimal_places=2)
    commission_amount = models.DecimalField(max_digits=8, decimal_places=2)
    payment_status    = models.CharField(max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING)
    paid_at           = models.DateField(null=True, blank=True)
    notes             = models.TextField(blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Commission — {self.agent_name} / Charter #{self.booking_id}'


class RentalUnit(models.Model):
    class UnitType(models.TextChoices):
        ELECTRIC_BOAT  = 'electric_boat',  'Electric Day Boat'
        PEDAL_BOAT     = 'pedal_boat',     'Pedal Boat'
        KAYAK          = 'kayak',          'Kayak'
        PADDLEBOARD    = 'paddleboard',    'Paddleboard'
        SAILING_DINGHY = 'sailing_dinghy', 'Sailing Dinghy'
        OTHER          = 'other',          'Other'

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rental_units')
    name               = models.CharField(max_length=200)
    unit_type          = models.CharField(max_length=30, choices=UnitType.choices)
    colour             = models.CharField(max_length=7, default='#3b82f6')
    hourly_rate_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='rental_hourly')
    halfday_rate_item  = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='rental_halfday')
    fullday_rate_item  = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='rental_fullday')
    turnaround_minutes = models.PositiveIntegerField(default=15)
    is_active          = models.BooleanField(default=True)
    notes              = models.TextField(blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['unit_type', 'name']

    def __str__(self):
        return self.name


class RentalBooking(models.Model):
    class Status(models.TextChoices):
        RESERVED  = 'reserved',  'Reserved'
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    marina                = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rental_bookings')
    rental_unit           = models.ForeignKey(RentalUnit, on_delete=models.PROTECT, related_name='bookings')
    member                = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='rental_bookings')
    customer_name         = models.CharField(max_length=200, blank=True)
    customer_email        = models.EmailField(blank=True)
    customer_phone        = models.CharField(max_length=30, blank=True)
    start_dt              = models.DateTimeField()
    end_dt                = models.DateTimeField()
    duration_minutes      = models.IntegerField()
    rate_applied          = models.DecimalField(max_digits=8, decimal_places=2)
    total                 = models.DecimalField(max_digits=8, decimal_places=2)
    invoice               = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='rental_bookings')
    status                = models.CharField(max_length=20, choices=Status.choices, default=Status.RESERVED)
    online_booking        = models.BooleanField(default=False)
    stripe_payment_intent = models.CharField(max_length=200, blank=True)
    notes                 = models.TextField(blank=True)
    created_at            = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_dt']

    def __str__(self):
        return f'Rental #{self.pk} — {self.rental_unit.name} ({self.start_dt.strftime("%Y-%m-%d %H:%M")})'
```

**Mutual-exclusion constraint (CharterVessel ↔ RentalUnit):** Enforced in serializer validation — see Serializers section. No DB-level constraint is possible across two tables in standard Django; the serializer check is the enforcement point.

### 2.3 Signals (`apps/charter/signals.py`)

```python
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from apps.charter.models import CharterBooking


@receiver(post_save, sender=CharterBooking)
def recompute_commission_on_subtotal_change(sender, instance, created, **kwargs):
    if created:
        return
    if not instance.tracker.has_changed('subtotal'):
        return

    def _recalc():
        pending = instance.agent_commissions.filter(payment_status='pending')
        for commission in pending:
            commission.commission_amount = instance.subtotal * (commission.commission_rate / 100)
            commission.save(update_fields=['commission_amount'])

        already_approved = instance.agent_commissions.filter(payment_status__in=['approved', 'paid'])
        if already_approved.exists():
            # Import send_alert from accounts or a shared utils module
            from apps.accounts.utils import send_staff_alert
            send_staff_alert(
                marina_id=instance.marina_id,
                subject=f'Commission already approved — Charter #{instance.pk} subtotal changed',
            )

    transaction.on_commit(_recalc)
```

### 2.4 Services (`apps/charter/services.py`)

```python
from datetime import timedelta
from django.db import transaction
from apps.charter.models import CharterBooking, CharterManagementAgreement, RentalBooking


def calculate_commission(charter_booking_id: int) -> None:
    """
    Called via transaction.on_commit when a CharterBooking is confirmed.
    Creates CharterAgentCommission records for all active management agreements
    on the booking's vessel, splitting revenue by split_percentage.
    """
    from apps.charter.models import CharterAgentCommission
    booking = CharterBooking.objects.select_related('charter_vessel').get(pk=charter_booking_id)
    vessel = booking.charter_vessel
    active_agreements = CharterManagementAgreement.objects.filter(
        charter_vessel=vessel,
        valid_from__lte=booking.start_dt.date(),
    ).filter(
        models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=booking.start_dt.date())
    )
    for agreement in active_agreements:
        owner_revenue = booking.subtotal * (agreement.split_percentage / 100)
        marina_commission = owner_revenue * (agreement.commission_rate / 100)
        CharterAgentCommission.objects.get_or_create(
            booking=booking,
            agent_name=agreement.owner_label or 'Marina',
            defaults={
                'marina': booking.marina,
                'agent_email': agreement.member.email if agreement.member else '',
                'commission_rate': agreement.commission_rate,
                'commission_amount': marina_commission,
            }
        )


def check_rental_availability(unit, start_dt, end_dt) -> bool:
    """
    Returns True if the rental unit is available for [start_dt, end_dt]
    accounting for turnaround_minutes buffer on either side.
    Uses select_for_update — must be called inside transaction.atomic().
    """
    buffer = timedelta(minutes=unit.turnaround_minutes)
    conflict = RentalBooking.objects.select_for_update().filter(
        rental_unit=unit,
    ).exclude(status='cancelled').filter(
        start_dt__lt=end_dt + buffer,
        end_dt__gt=start_dt - buffer,
    )
    return not conflict.exists()


def create_charter_invoice(booking: CharterBooking):
    """
    Builds a billing.Invoice for a confirmed CharterBooking.
    Called after booking is confirmed and pricing is finalised.
    """
    from billing.models import Invoice, InvoiceLineItem
    from apps.accounts.utils import generate_invoice_number

    with transaction.atomic():
        invoice = Invoice.objects.create(
            marina=booking.marina,
            member=booking.charterer,
            source_type='charter_booking',
            source_id=str(booking.pk),
            invoice_number=generate_invoice_number(booking.marina),
            status='draft',
        )
        vessel = booking.charter_vessel
        # Base rate line item
        if vessel.daily_rate_item and booking.duration_unit == 'daily':
            rate_item = vessel.daily_rate_item
        elif vessel.hourly_rate_item and booking.duration_unit == 'hourly':
            rate_item = vessel.hourly_rate_item
        elif vessel.weekly_rate_item and booking.duration_unit == 'weekly':
            rate_item = vessel.weekly_rate_item
        else:
            rate_item = None

        if rate_item:
            InvoiceLineItem.objects.create(
                invoice=invoice,
                description=f'Charter — {vessel.vessel.name}',
                chargeable_item=rate_item,
                quantity=1,
                unit_price=booking.subtotal,
                total_price=booking.subtotal,
                tax_rate=rate_item.tax_rate,
            )

        booking.invoice = invoice
        booking.save(update_fields=['invoice'])
    return invoice
```

### 2.5 Serializers (`apps/charter/serializers.py`)

Key validation rules — implement as `validate()` / `validate_<field>()` methods:

**`CharterVesselSerializer`:**
- `validate_hourly_rate_item` / `daily_rate_item` / `weekly_rate_item` / `cleaning_fee_item` / `skipper_fee_item`: each must have `category='charter'` when set. Raise `ValidationError(f"{field} must have category='charter'.")`.
- `validate(data)`: if `vessel` is already linked to a `RentalUnit`, raise `ValidationError('This vessel is already registered as a RentalUnit. A vessel cannot be both.')`.

**`CharterManagementAgreementSerializer`:**
- `validate(data)`: Query all other active agreements for `data['charter_vessel']` (excluding self on update). Sum their `split_percentage` + `data['split_percentage']`. If total != 100 for all currently-open agreements, raise `ValidationError('Active agreements for this vessel must sum to exactly 100%.')`. Check "active" as: `valid_to IS NULL OR valid_to >= today`.

**`CharterBookingSerializer`:**
- `validate(data)`: check `start_dt < end_dt`. Check vessel overlap (non-cancelled bookings for same vessel overlapping the date range). If `charter_vessel.skipper_required` and status is being set to `confirmed` and `skipper` is not set, raise error.
- `validate_skipper(skipper)`: check `Certification` records — the assigned staff member must have a cert with `name` matching `charter_vessel.min_charterer_qual` and `status='valid'`.
- `create(validated_data)`: server calculates `rate_applied`, `cleaning_fee`, `skipper_fee`, `deposit_amount`, `subtotal`, `total` from `CharterVessel`'s `ChargeableItem` records. Determine `deposit_mechanism`: if duration < 7 days → `auth_hold`; >= 7 days → `captured`. Initiate Stripe flow (call Stripe service). For `captured` deposits, also post a liability credit to the charterer's `MemberCreditAccount`. Return `price_breakdown` in the response.

**`CharterAgentCommissionSerializer`:**
- `validate(data)`: if `payment_status` is being set to `'approved'`, check `self.instance.booking.status == 'completed'`. Raise `ValidationError('Commission cannot be approved until the charter is completed.')` if not.

**`RentalBookingSerializer`:**
- `validate(data)`: full overlap + turnaround check using `select_for_update()` (see spec §3.6). Must be inside `transaction.atomic()`.
- `validate_hourly_rate_item` / `halfday_rate_item` / `fullday_rate_item` on `RentalUnitSerializer`: must have `category='charter'`.

**`RentalUnitSerializer`:**
- `validate(data)`: if `vessel` FK is added in future, check mutual exclusion with `CharterVessel`. Currently `RentalUnit` has no `vessel` FK — check is on creation if vessel is supplied.

### 2.6 Views (`apps/charter/views.py`)

Use `generics.ListCreateAPIView` / `RetrieveUpdateDestroyAPIView` pattern matching `apps/revenue/views.py`. All querysets filtered by `marina=self.request.user.marina`.

Custom actions (use `@action` decorator with `detail=True`):

**`CharterBookingViewSet`:**
- `send_agreement(self, request, pk)` — POST: creates `CharterAgreement`, calls Dropbox Sign send-for-signature flow reusing existing `documents` app envelope creation. Sets `envelope.vessel = booking.charter_vessel.vessel`, `envelope.recipient = booking.charterer`.
- `release_deposit(self, request, pk)` — POST: body `{"action": "release"|"withhold", "amount": <decimal>}`. For `auth_hold` deposits: calls `stripe.PaymentIntent.cancel()` (release) or `stripe.PaymentIntent.capture(amount_to_capture=...)` (withhold). For `captured` deposits: issues `stripe.Refund` (release) or partial refund + debit from `MemberCreditAccount` (withhold).

**`RentalBookingViewSet`:**
- `availability(self, request)` — GET with `?unit=<id>&date=<YYYY-MM-DD>`: returns occupied time slots and turnaround buffer windows for that day, plus `rate_preview` computed from the unit's `ChargeableItem` unit_prices. Wrap conflict check in `transaction.atomic()` + `select_for_update()`.

**OTA Webhook views:**
- `ZizooWebhookView(APIView)` — POST `/charter/webhooks/zizoo/`. No JWT auth (`permission_classes = [AllowAny]`). Call `charter.ota.zizoo.verify_signature(request)` first; return 401 if fails. Then `parse_booking` → `map_vessel` → create or update `CharterBooking`. Cancellation: look up by `channel_ref`, set `status='cancelled'`.
- `ClickAndBoatWebhookView(APIView)` — same pattern with `charter.ota.click_and_boat`.
- Dropbox Sign webhook: POST `/charter/webhooks/dropboxsign/` — when `signature_request_signed`, find `CharterAgreement` by `envelope.dropboxsign_request_id`, set `agreement.signed_at = now()`. If `booking.status == 'enquiry'`, advance to `'confirmed'` and call `transaction.on_commit(lambda: calculate_commission(booking.pk))`.

### 2.7 OTA Adapters (`apps/charter/ota/`)

**`base.py`:**
```python
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

@dataclass
class CharterBookingData:
    ota_booking_ref: str
    ota_vessel_id: str
    start_dt: datetime
    end_dt: datetime
    charterer_name: str
    charterer_email: str
    charterer_phone: str
    channel_commission: float
    is_cancellation: bool = False

class OTAAdapter:
    channel_name: str

    def verify_signature(self, request) -> bool:
        raise NotImplementedError

    def parse_booking(self, payload: dict) -> CharterBookingData:
        raise NotImplementedError

    def map_vessel(self, ota_vessel_id: str, marina) -> 'CharterVessel | None':
        raise NotImplementedError
```

**`zizoo.py`:** Implement `verify_signature` using `X-Zizoo-Signature` HMAC-SHA256 header against `settings.ZIZOO_WEBHOOK_SECRET`. Implement `parse_booking` mapping Zizoo payload fields to `CharterBookingData`. Implement `map_vessel` looking up a marina-level mapping table (store OTA vessel ID → `CharterVessel` PK in a `JSONField` on `OTAConnection` or a separate `CharterVesselOTAMapping` model — use the latter for clarity).

**`click_and_boat.py`:** Same pattern with Click&Boat's HMAC header name and payload structure.

### 2.8 URLs (`apps/charter/urls.py`)

```python
from django.urls import path
from apps.charter import views

urlpatterns = [
    # Charter Vessels
    path('charter/vessels/',                           views.CharterVesselListCreateView.as_view(),      name='charter-vessel-list'),
    path('charter/vessels/<int:pk>/',                  views.CharterVesselDetailView.as_view(),          name='charter-vessel-detail'),
    # Management Agreements
    path('charter/agreements/',                        views.CharterManagementAgreementListCreateView.as_view(), name='charter-agreement-list'),
    path('charter/agreements/<int:pk>/',               views.CharterManagementAgreementDetailView.as_view(),     name='charter-agreement-detail'),
    # Charter Bookings
    path('charter/bookings/',                          views.CharterBookingListCreateView.as_view(),     name='charter-booking-list'),
    path('charter/bookings/<int:pk>/',                 views.CharterBookingDetailView.as_view(),         name='charter-booking-detail'),
    path('charter/bookings/<int:pk>/send-agreement/',  views.CharterBookingSendAgreementView.as_view(),  name='charter-booking-send-agreement'),
    path('charter/bookings/<int:pk>/release-deposit/', views.CharterBookingReleaseDepositView.as_view(), name='charter-booking-release-deposit'),
    # Agent Commissions
    path('charter/commissions/',                       views.CharterAgentCommissionListView.as_view(),   name='charter-commission-list'),
    path('charter/commissions/<int:pk>/',              views.CharterAgentCommissionDetailView.as_view(), name='charter-commission-detail'),
    # Rental Units
    path('charter/rental-units/',                      views.RentalUnitListCreateView.as_view(),         name='rental-unit-list'),
    path('charter/rental-units/<int:pk>/',             views.RentalUnitDetailView.as_view(),             name='rental-unit-detail'),
    # Rental Bookings
    path('charter/rental-bookings/',                   views.RentalBookingListCreateView.as_view(),      name='rental-booking-list'),
    path('charter/rental-bookings/<int:pk>/',          views.RentalBookingDetailView.as_view(),          name='rental-booking-detail'),
    path('charter/rental-bookings/availability/',      views.RentalBookingAvailabilityView.as_view(),    name='rental-booking-availability'),
    # OTA Webhooks (no JWT auth)
    path('charter/webhooks/zizoo/',                    views.ZizooWebhookView.as_view(),                 name='charter-webhook-zizoo'),
    path('charter/webhooks/click-and-boat/',           views.ClickAndBoatWebhookView.as_view(),          name='charter-webhook-click-and-boat'),
    path('charter/webhooks/dropboxsign/',              views.DropboxSignWebhookView.as_view(),           name='charter-webhook-dropboxsign'),
]
```

### 2.9 Admin (`apps/charter/admin.py`)

```python
from django.contrib import admin
from apps.charter.models import (
    CharterVessel, CharterManagementAgreement, CharterBooking,
    CharterAgreement, CharterAgentCommission, RentalUnit, RentalBooking,
)

@admin.register(CharterVessel)
class CharterVesselAdmin(admin.ModelAdmin):
    list_display = ['vessel', 'marina', 'is_available', 'skipper_required']
    list_filter = ['marina', 'is_available']
    raw_id_fields = ['vessel', 'hourly_rate_item', 'daily_rate_item', 'weekly_rate_item']

@admin.register(CharterManagementAgreement)
class CharterManagementAgreementAdmin(admin.ModelAdmin):
    list_display = ['charter_vessel', 'owner_label', 'split_percentage', 'valid_from', 'valid_to']
    list_filter = ['marina', 'charter_vessel']

@admin.register(CharterBooking)
class CharterBookingAdmin(admin.ModelAdmin):
    list_display = ['pk', 'charter_vessel', 'charterer_name', 'start_dt', 'end_dt', 'status', 'channel', 'deposit_mechanism']
    list_filter = ['marina', 'status', 'channel', 'deposit_mechanism']
    search_fields = ['charterer_name', 'charterer_email', 'channel_ref']

@admin.register(CharterAgentCommission)
class CharterAgentCommissionAdmin(admin.ModelAdmin):
    list_display = ['booking', 'agent_name', 'commission_rate', 'commission_amount', 'payment_status']
    list_filter = ['payment_status']

@admin.register(RentalUnit)
class RentalUnitAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'unit_type', 'turnaround_minutes', 'is_active']
    list_filter = ['marina', 'unit_type', 'is_active']

@admin.register(RentalBooking)
class RentalBookingAdmin(admin.ModelAdmin):
    list_display = ['pk', 'rental_unit', 'customer_name', 'start_dt', 'end_dt', 'status', 'total']
    list_filter = ['marina', 'status', 'online_booking']
```

---

## Part 3: `harbour` App

### 3.1 App Skeleton

```
apps/harbour/
    __init__.py
    apps.py
    models.py
    serializers.py
    views.py
    urls.py
    admin.py
    services/
        __init__.py
        tariff_engine.py
        report_builders.py
```

**`apps/harbour/apps.py`:**
```python
from django.apps import AppConfig

class HarbourConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.harbour'
```

### 3.2 Models (`apps/harbour/models.py`)

```python
from django.db import models


class ShippingAgent(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='shipping_agents')
    name         = models.CharField(max_length=200)
    contact_name = models.CharField(max_length=200, blank=True)
    email        = models.EmailField(blank=True)
    phone        = models.CharField(max_length=30, blank=True)
    address      = models.TextField(blank=True)
    vat_number   = models.CharField(max_length=50, blank=True)
    notes        = models.TextField(blank=True)
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class HarbourTariff(models.Model):
    class DueType(models.TextChoices):
        PILOTAGE          = 'pilotage',          'Pilotage'
        TUG               = 'tug',               'Tug'
        HARBOUR_DUES      = 'harbour_dues',      'Harbour Dues / Port Dues'
        PASSENGER_LANDING = 'passenger_landing', 'Passenger Landing'
        CARGO_HANDLING    = 'cargo_handling',    'Cargo Handling'

    class CommercialVesselType(models.TextChoices):
        FERRY         = 'ferry',         'Ferry'
        CARGO         = 'cargo',         'Cargo Vessel'
        FISHING       = 'fishing',       'Fishing Vessel (Commercial)'
        RESEARCH      = 'research',      'Research Vessel'
        PILOT         = 'pilot',         'Pilot Vessel'
        DREDGER       = 'dredger',       'Dredger'
        SUPPLY        = 'supply',        'Supply Vessel'
        CRUISE_TENDER = 'cruise_tender', 'Cruise Ship Tender'
        ALL           = 'all',           'All Types'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='harbour_tariffs')
    due_type        = models.CharField(max_length=30, choices=DueType.choices)
    vessel_type     = models.CharField(max_length=20, choices=CommercialVesselType.choices, default=CommercialVesselType.ALL)
    chargeable_item = models.ForeignKey('billing.ChargeableItem', on_delete=models.PROTECT, related_name='harbour_tariffs')
    base_fee        = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    multiplier_fee  = models.DecimalField(max_digits=10, decimal_places=6, default=0)
    flag_state      = models.CharField(max_length=3, blank=True)
    min_gt          = models.IntegerField(null=True, blank=True)
    max_gt          = models.IntegerField(null=True, blank=True)
    effective_from  = models.DateField()
    effective_to    = models.DateField(null=True, blank=True)
    is_active       = models.BooleanField(default=True)
    notes           = models.TextField(blank=True)

    class Meta:
        ordering = ['due_type', 'vessel_type', 'min_gt']

    def __str__(self):
        return f'{self.get_due_type_display()} — {self.get_vessel_type_display()} (from {self.effective_from})'


class CommercialMovement(models.Model):
    class MovementStatus(models.TextChoices):
        EXPECTED  = 'expected',  'Expected'
        ARRIVED   = 'arrived',   'Arrived'
        DEPARTED  = 'departed',  'Departed'
        CANCELLED = 'cancelled', 'Cancelled'

    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='commercial_movements')
    vessel_name          = models.CharField(max_length=200)
    imo_number           = models.CharField(max_length=20, blank=True)
    flag                 = models.CharField(max_length=3, blank=True)
    vessel_type          = models.CharField(max_length=20, choices=HarbourTariff.CommercialVesselType.choices)
    gross_tonnage        = models.IntegerField(null=True, blank=True)
    net_tonnage          = models.IntegerField(null=True, blank=True)
    cargo_type           = models.CharField(max_length=200, blank=True)
    cargo_weight_mt      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    crew_count           = models.IntegerField(default=0)
    passenger_count      = models.IntegerField(default=0)
    port_of_origin       = models.CharField(max_length=200, blank=True)
    next_port            = models.CharField(max_length=200, blank=True)
    shipping_agent       = models.ForeignKey(ShippingAgent, on_delete=models.SET_NULL, null=True, blank=True, related_name='movements')
    agent_name           = models.CharField(max_length=200, blank=True)
    agent_email          = models.EmailField(blank=True)
    berth_assigned       = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True, related_name='commercial_movements')
    berth_label          = models.CharField(max_length=100, blank=True)
    eta                  = models.DateTimeField(null=True, blank=True)
    etd                  = models.DateTimeField(null=True, blank=True)
    actual_arrival       = models.DateTimeField(null=True, blank=True)
    actual_departure     = models.DateTimeField(null=True, blank=True)
    pilotage_distance_nm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    tug_duration_hours   = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    status               = models.CharField(max_length=20, choices=MovementStatus.choices, default=MovementStatus.EXPECTED)
    psc_flag             = models.BooleanField(default=False)
    notes                = models.TextField(blank=True)
    created_at           = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-eta']

    def __str__(self):
        return f'{self.vessel_name} ({self.imo_number}) — ETA {self.eta}'


class HarbourDueInvoice(models.Model):
    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='harbour_due_invoices')
    movement          = models.ForeignKey(CommercialMovement, on_delete=models.CASCADE, related_name='due_invoices')
    due_type          = models.CharField(max_length=30, choices=HarbourTariff.DueType.choices)
    tariff            = models.ForeignKey(HarbourTariff, on_delete=models.PROTECT, related_name='due_invoices')
    quantity          = models.DecimalField(max_digits=10, decimal_places=4)
    calculated_amount = models.DecimalField(max_digits=10, decimal_places=2)
    invoice           = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='harbour_due_invoices')
    created_at        = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.get_due_type_display()} — {self.movement.vessel_name} (€{self.calculated_amount})'


class PortStateControlRecord(models.Model):
    class Outcome(models.TextChoices):
        NO_DEFICIENCIES = 'no_deficiencies', 'No Deficiencies'
        DEFICIENCIES    = 'deficiencies',    'Deficiencies Noted'
        DETAINED        = 'detained',        'Vessel Detained'

    marina                 = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='psc_records')
    movement               = models.ForeignKey(CommercialMovement, on_delete=models.CASCADE, related_name='psc_records')
    inspection_date        = models.DateField()
    inspector_name         = models.CharField(max_length=200, blank=True)
    authority              = models.CharField(max_length=200, blank=True)
    outcome                = models.CharField(max_length=20, choices=Outcome.choices)
    deficiency_codes       = models.TextField(blank=True)
    rectification_deadline = models.DateField(null=True, blank=True)
    notes                  = models.TextField(blank=True)
    created_at             = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'PSC — {self.movement.vessel_name} ({self.inspection_date})'
```

### 3.3 Tariff Engine (`apps/harbour/services/tariff_engine.py`)

```python
from decimal import Decimal
from django.db import transaction
from apps.harbour.models import HarbourTariff, HarbourDueInvoice, CommercialMovement
from billing.models import Invoice, InvoiceLineItem


def get_tariff(marina, due_type, vessel_type, flag, gross_tonnage, date):
    """
    Lookup order (most specific wins):
    1. due_type + vessel_type + flag + GT band + effective date
    2. Fallback: flag_state='' (all flags)
    3. Fallback: vessel_type='all'
    Returns HarbourTariff or None.
    """
    def _query(vt, fs):
        qs = HarbourTariff.objects.filter(
            marina=marina,
            due_type=due_type,
            vessel_type=vt,
            flag_state=fs,
            is_active=True,
            effective_from__lte=date,
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=date)
        )
        if gross_tonnage is not None:
            qs = qs.filter(
                models.Q(min_gt__isnull=True) | models.Q(min_gt__lte=gross_tonnage)
            ).filter(
                models.Q(max_gt__isnull=True) | models.Q(max_gt__gt=gross_tonnage)
            )
        return qs.first()

    return (
        _query(vessel_type, flag) or
        _query(vessel_type, '') or
        _query('all', flag) or
        _query('all', '')
    )


def _calculate_amount(tariff, quantity):
    return tariff.base_fee + (tariff.multiplier_fee * Decimal(str(quantity)))


def preview_dues(movement: CommercialMovement) -> dict:
    """
    Calculate dues without persisting. Returns preview dict for the API.
    """
    date = (movement.actual_arrival or movement.eta).date()
    results = []

    DUE_MAP = [
        ('harbour_dues',      movement.gross_tonnage,           movement.gross_tonnage),
        ('pilotage',          movement.pilotage_distance_nm,    (movement.gross_tonnage or 0) * float(movement.pilotage_distance_nm or 0)),
        ('tug',               movement.tug_duration_hours,      movement.tug_duration_hours),
        ('passenger_landing', movement.passenger_count if movement.passenger_count > 0 else None, movement.passenger_count),
        ('cargo_handling',    movement.cargo_weight_mt,         movement.cargo_weight_mt),
    ]

    for due_type, trigger, quantity in DUE_MAP:
        if not trigger:
            continue
        tariff = get_tariff(movement.marina, due_type, movement.vessel_type, movement.flag, movement.gross_tonnage, date)
        if not tariff:
            continue
        amount = _calculate_amount(tariff, quantity)
        results.append({
            'due_type': due_type,
            'tariff_id': tariff.pk,
            'quantity': str(quantity),
            'base_fee': str(tariff.base_fee),
            'multiplier_fee': str(tariff.multiplier_fee),
            'calculated_amount': str(amount),
        })

    total = sum(Decimal(r['calculated_amount']) for r in results)
    return {'movement_id': movement.pk, 'dues': results, 'total': str(total)}


def calculate_and_invoice(movement: CommercialMovement) -> Invoice:
    """
    Persist HarbourDueInvoice records and assemble a billing.Invoice.
    """
    from apps.accounts.utils import generate_invoice_number

    with transaction.atomic():
        invoice = Invoice.objects.create(
            marina=movement.marina,
            member=None,
            shipping_agent=movement.shipping_agent,
            source_type='commercial_movement',
            source_id=str(movement.pk),
            invoice_number=generate_invoice_number(movement.marina),
            status='draft',
        )

        date = (movement.actual_arrival or movement.eta).date()
        DUE_MAP = [
            ('harbour_dues',      movement.gross_tonnage,           movement.gross_tonnage),
            ('pilotage',          movement.pilotage_distance_nm,    (movement.gross_tonnage or 0) * float(movement.pilotage_distance_nm or 0)),
            ('tug',               movement.tug_duration_hours,      movement.tug_duration_hours),
            ('passenger_landing', movement.passenger_count if movement.passenger_count > 0 else None, movement.passenger_count),
            ('cargo_handling',    movement.cargo_weight_mt,         movement.cargo_weight_mt),
        ]

        for due_type, trigger, quantity in DUE_MAP:
            if not trigger:
                continue
            tariff = get_tariff(movement.marina, due_type, movement.vessel_type, movement.flag, movement.gross_tonnage, date)
            if not tariff:
                continue
            amount = _calculate_amount(tariff, quantity)

            due_invoice = HarbourDueInvoice.objects.create(
                marina=movement.marina,
                movement=movement,
                due_type=due_type,
                tariff=tariff,
                quantity=Decimal(str(quantity)),
                calculated_amount=amount,
                invoice=invoice,
            )

            InvoiceLineItem.objects.create(
                invoice=invoice,
                description=f'{tariff.get_due_type_display()} — {movement.vessel_name}',
                chargeable_item=tariff.chargeable_item,
                quantity=1,
                unit_price=amount,
                total_price=amount,
                tax_rate=tariff.chargeable_item.tax_rate,
            )

        # Recalculate invoice totals
        subtotal = sum(item.total_price for item in invoice.items.all())
        invoice.subtotal = subtotal
        invoice.total = subtotal  # tax calculated separately if needed
        invoice.save(update_fields=['subtotal', 'total'])

    return invoice


def recalculate_movement_invoice(movement: CommercialMovement):
    """
    When a movement is edited post-invoice, issue a Credit Note and generate a new Invoice.
    Never delete or void an issued invoice.
    """
    with transaction.atomic():
        first_due = movement.due_invoices.select_related('invoice').first()
        if not first_due or not first_due.invoice:
            return calculate_and_invoice(movement), None

        original_invoice = first_due.invoice
        if original_invoice.status == 'draft':
            # Not yet issued — safe to regenerate directly
            movement.due_invoices.all().delete()
            original_invoice.items.all().delete()
            original_invoice.delete()
            return calculate_and_invoice(movement), None

        # Issue credit note neutralising the original
        credit_note = _issue_credit_note(original_invoice, movement.marina)

        # Delete old HarbourDueInvoice records (new ones will be created)
        movement.due_invoices.all().delete()

        new_invoice = calculate_and_invoice(movement)
        return credit_note, new_invoice


def _issue_credit_note(original_invoice: Invoice, marina) -> Invoice:
    from apps.accounts.utils import generate_invoice_number

    credit_note = Invoice.objects.create(
        marina=marina,
        member=original_invoice.member,
        shipping_agent=original_invoice.shipping_agent,
        source_type='credit_note',
        source_id=str(original_invoice.pk),
        invoice_number=generate_invoice_number(marina),
        invoice_type='credit_note',
        related_invoice=original_invoice,
        status='issued',
        subtotal=-original_invoice.subtotal,
        total=-original_invoice.total,
    )

    for item in original_invoice.items.all():
        InvoiceLineItem.objects.create(
            invoice=credit_note,
            description=f'[Credit] {item.description}',
            chargeable_item=item.chargeable_item,
            quantity=-item.quantity,
            unit_price=item.unit_price,
            total_price=-item.total_price,
            tax_rate=item.tax_rate,
        )

    return credit_note
```

### 3.4 Report Builders (`apps/harbour/services/report_builders.py`)

```python
from apps.harbour.models import CommercialMovement


def vessel_traffic_report(marina, date_from, date_to) -> list:
    qs = CommercialMovement.objects.filter(
        marina=marina,
        eta__date__gte=date_from,
        eta__date__lte=date_to,
    ).exclude(status='cancelled').select_related('shipping_agent', 'berth_assigned')
    return list(qs.values(
        'vessel_name', 'imo_number', 'flag', 'vessel_type', 'gross_tonnage',
        'net_tonnage', 'port_of_origin', 'next_port', 'eta', 'etd',
        'actual_arrival', 'actual_departure', 'crew_count', 'passenger_count',
        'cargo_type', 'cargo_weight_mt', 'status', 'psc_flag',
    ))


def daily_port_report(marina, date) -> list:
    """Vessels in port at midnight snapshot: ETA <= date and (ETD > date or not yet departed)."""
    from datetime import datetime, time
    import pytz
    snapshot = datetime.combine(date, time(0, 0), tzinfo=pytz.UTC)
    qs = CommercialMovement.objects.filter(
        marina=marina,
        eta__lte=snapshot,
    ).filter(
        models.Q(etd__gt=snapshot) | models.Q(actual_departure__isnull=True)
    ).exclude(status__in=['cancelled', 'departed']).select_related('berth_assigned', 'shipping_agent')
    return list(qs.values(
        'vessel_name', 'imo_number', 'flag', 'vessel_type', 'gross_tonnage',
        'status', 'berth_label', 'berth_assigned__name', 'shipping_agent__name',
        'crew_count', 'passenger_count',
    ))
```

### 3.5 URLs (`apps/harbour/urls.py`)

```python
from django.urls import path
from apps.harbour import views

urlpatterns = [
    # Shipping Agents
    path('harbour/agents/',                              views.ShippingAgentListCreateView.as_view(),          name='harbour-agent-list'),
    path('harbour/agents/<int:pk>/',                     views.ShippingAgentDetailView.as_view(),              name='harbour-agent-detail'),
    # Tariffs
    path('harbour/tariffs/',                             views.HarbourTariffListCreateView.as_view(),          name='harbour-tariff-list'),
    path('harbour/tariffs/<int:pk>/',                    views.HarbourTariffDetailView.as_view(),              name='harbour-tariff-detail'),
    # Commercial Movements
    path('harbour/movements/',                           views.CommercialMovementListCreateView.as_view(),     name='harbour-movement-list'),
    path('harbour/movements/<int:pk>/',                  views.CommercialMovementDetailView.as_view(),         name='harbour-movement-detail'),
    path('harbour/movements/<int:pk>/calculate-dues/',   views.MovementCalculateDuesView.as_view(),            name='harbour-movement-calculate-dues'),
    path('harbour/movements/<int:pk>/generate-invoice/', views.MovementGenerateInvoiceView.as_view(),          name='harbour-movement-generate-invoice'),
    # PSC Records
    path('harbour/psc-records/',                         views.PortStateControlRecordListCreateView.as_view(), name='harbour-psc-list'),
    path('harbour/psc-records/<int:pk>/',                views.PortStateControlRecordDetailView.as_view(),     name='harbour-psc-detail'),
    # Reports
    path('harbour/reports/vessel-traffic/',              views.VesselTrafficReportView.as_view(),              name='harbour-report-vtr'),
    path('harbour/reports/daily-port-report/',           views.DailyPortReportView.as_view(),                  name='harbour-report-dpr'),
]
```

### 3.6 Admin (`apps/harbour/admin.py`)

```python
from django.contrib import admin
from apps.harbour.models import ShippingAgent, HarbourTariff, CommercialMovement, HarbourDueInvoice, PortStateControlRecord

@admin.register(ShippingAgent)
class ShippingAgentAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'contact_name', 'email', 'is_active']
    list_filter = ['marina', 'is_active']

@admin.register(HarbourTariff)
class HarbourTariffAdmin(admin.ModelAdmin):
    list_display = ['due_type', 'vessel_type', 'flag_state', 'min_gt', 'max_gt', 'base_fee', 'multiplier_fee', 'effective_from', 'is_active']
    list_filter = ['marina', 'due_type', 'vessel_type', 'is_active']

@admin.register(CommercialMovement)
class CommercialMovementAdmin(admin.ModelAdmin):
    list_display = ['vessel_name', 'imo_number', 'flag', 'vessel_type', 'gross_tonnage', 'eta', 'status', 'psc_flag']
    list_filter = ['marina', 'status', 'vessel_type', 'psc_flag']
    search_fields = ['vessel_name', 'imo_number']

@admin.register(HarbourDueInvoice)
class HarbourDueInvoiceAdmin(admin.ModelAdmin):
    list_display = ['movement', 'due_type', 'quantity', 'calculated_amount']
    list_filter = ['due_type']

@admin.register(PortStateControlRecord)
class PortStateControlRecordAdmin(admin.ModelAdmin):
    list_display = ['movement', 'inspection_date', 'outcome', 'authority']
    list_filter = ['outcome']
```

---

## Part 4: Settings & URL Wiring

### 4.1 `config/settings/base.py`

Add to `LOCAL_APPS`:
```python
'apps.charter',
'apps.harbour',
```

### 4.2 `config/urls.py`

Add to the `api/v1/` include block:
```python
path('', include('apps.charter.urls')),
path('', include('apps.harbour.urls')),
```

---

## Part 5: Migration Notes

Migration order must be respected:

1. `makemigrations billing` — add `HARBOUR_TARIFF` category, four new `PricingModel` choices, `invoice_type`, `related_invoice`, `shipping_agent`, `tenant` fields to `Invoice`.
2. `makemigrations staff` — add `is_contractor` field.
3. `makemigrations documents` — add `charter_agreement` to `DocTemplate.CATEGORY`.
4. `makemigrations charter` — initial migration for all charter models.
5. `makemigrations harbour` — initial migration for all harbour models. (Depends on `billing` having `HARBOUR_TARIFF` available.)
6. `migrate` — apply all.

All migrations are additive. No existing data is modified.

---

## Part 6: Implementation Order (Step-by-Step)

### Step 1 — Billing model extensions
- Open `apps/billing/models.py`.
- Verify `CHARTER` category already exists (it does — confirmed in codebase). Do not duplicate.
- Add `HARBOUR_TARIFF` to `Category`.
- Add `PER_WEEK`, `PER_PASSENGER`, `PER_GROSS_TON`, `PER_TON_DISTANCE` to `PricingModel`.
- Add `invoice_type`, `related_invoice`, `shipping_agent`, and `tenant` fields to `Invoice`.
- Run `python manage.py makemigrations billing`.
- Run `python manage.py migrate`.

### Step 2 — Staff model extension
- Add `is_contractor = BooleanField(default=False)` to `StaffMember`.
- Run `makemigrations staff` → `migrate`.
- Update any payroll/HR queryset that lists staff to add `.filter(is_contractor=False)` by default.

### Step 3 — Documents model extension
- Add `'charter_agreement'` to `DocTemplate.CATEGORY`.
- Run `makemigrations documents` → `migrate`.

### Step 4 — Install `django-model-utils`
- `pip install django-model-utils` → add to `requirements.txt`.

### Step 5 — Create `charter` app skeleton
- Create directory `apps/charter/` with all files listed in §2.1.
- Register `'apps.charter'` in `LOCAL_APPS`.
- Add `path('', include('apps.charter.urls'))` to `config/urls.py`.

### Step 6 — Implement `charter` models
- Write `apps/charter/models.py` exactly as specified in §2.2.
- Run `makemigrations charter` → `migrate`.
- Confirm all FK references resolve (`vessels.Vessel`, `members.Member`, `staff.StaffMember`, `billing.ChargeableItem`, `billing.Invoice`, `documents.Envelope`).

### Step 7 — Implement `charter` signals
- Write `apps/charter/signals.py` (§2.3).
- Ensure `CharterConfig.ready()` imports signals.

### Step 8 — Implement `charter` services
- Write `apps/charter/services.py` (§2.4).
- Placeholder Stripe calls: wrap in `try/except` guarded by `settings.STRIPE_SECRET_KEY` — raise `NotImplementedError` if key is blank (prevents silent failures in dev).

### Step 9 — Implement `charter` serializers and views
- Write `apps/charter/serializers.py` (§2.5).
- Write `apps/charter/views.py` (§2.6). Use `permission_classes = [IsAuthenticated]` on all views except webhook views which use `permission_classes = [AllowAny]`.
- Register URLs in `apps/charter/urls.py`.

### Step 10 — Implement OTA adapters
- Write `apps/charter/ota/base.py`, `zizoo.py`, `click_and_boat.py`.
- Add `ZIZOO_WEBHOOK_SECRET` and `CLICK_AND_BOAT_WEBHOOK_SECRET` to `settings.py` and `.env`.

### Step 11 — Register `charter` admin
- Write `apps/charter/admin.py`.
- Smoke-test admin at `/_platform/admin/`.

### Step 12 — Create `harbour` app skeleton
- Create directory `apps/harbour/` with all files.
- Register `'apps.harbour'` in `LOCAL_APPS`.
- Add `path('', include('apps.harbour.urls'))` to `config/urls.py`.

### Step 13 — Implement `harbour` models
- Write `apps/harbour/models.py` (§3.2).
- Run `makemigrations harbour` → `migrate`.

### Step 14 — Implement tariff engine
- Write `apps/harbour/services/tariff_engine.py` (§3.3).
- Write unit tests:
  - `test_harbour_dues_gt_band`: verify correct tariff selected for a vessel in the 1000–2000 GT band.
  - `test_pilotage_calculation`: verify `base_fee + (multiplier_fee × GT × distance)`.
  - `test_tug_calculation`: verify `base_fee + (multiplier_fee × hours)`.
  - `test_passenger_landing`: verify `base_fee + (multiplier_fee × passenger_count)`.
  - `test_cargo_handling`: verify `base_fee + (multiplier_fee × cargo_weight_mt)`.
  - `test_credit_note_chain`: after a passenger-count correction, verify the GL contains 3 invoices (original, credit note, new) with original invoice total unchanged.
  - `test_flag_state_override`: flag-specific tariff wins over all-flags tariff.
  - `test_open_ended_gt_band`: `min_gt=5000`, `max_gt=None` — verify a 7000 GT vessel matches.

### Step 15 — Implement `harbour` serializers and views
- Write `apps/harbour/serializers.py` and `apps/harbour/views.py`.
- `MovementCalculateDuesView`: GET-like action that calls `preview_dues(movement)` without persisting. Returns JSON preview.
- `MovementGenerateInvoiceView`: calls `calculate_and_invoice(movement)`. If movement already has `due_invoices`, calls `recalculate_movement_invoice(movement)` instead.
- `VesselTrafficReportView` / `DailyPortReportView`: call report builders and return JSON.

### Step 16 — Implement `harbour` report builders
- Write `apps/harbour/services/report_builders.py` (§3.4).

### Step 17 — Register `harbour` admin
- Write `apps/harbour/admin.py` (§3.6).

### Step 18 — End-to-end smoke test
- Create a `CharterVessel` in admin, link to an existing `Vessel`.
- Create a `CharterManagementAgreement` at 100%.
- Create a `CharterBooking` via API. Verify `commission_amount` record is created.
- Update `booking.subtotal` — verify signal fires and updates commission.
- Create a `CommercialMovement`, call `calculate-dues/`, then `generate-invoice/`. Verify `HarbourDueInvoice` records and `billing.Invoice` are created. Edit the movement and call `generate-invoice/` again — verify credit note + new invoice in DB.

### Step 19 — Track 8 housekeeping hook (conditional)
- In `CharterBooking.save()` (or a `post_save` signal), add:
  ```python
  if instance.status == 'completed' and instance.tracker.has_changed('status'):
      try:
          from apps.housekeeping.services import create_checkout_task
          transaction.on_commit(lambda: create_checkout_task(booking=instance))
      except ImportError:
          pass
  ```
  This is a no-op until Track 8 merges.

---

## Frontend Implementation Order (Backend-Complete First)

Steps 20–28 are frontend-only; implement after Steps 1–19 are merged.

20. Build React Query hooks: `useCharterVessels`, `useCharterBookings`, `useRentalUnits`, `useRentalBookings`.
21. Build `CharterScreen.jsx` — Fleet tab + Bookings tab. `CharterVesselDrawer` with Management Agreements sub-panel. `CharterBookingDrawer` with deposit section (auth-hold countdown banner if within 48h of expiry).
22. Build `CharterBookingWizard.jsx` — 7-step wizard: Vessel → Dates → Charterer → Skipper → Agreement Template → Channel & Agent → Review.
23. Build `CharterGanttCalendar.jsx` — Availability tab; week navigation; OTA channel badge icons on booking bars.
24. Build `RentalCalendarScreen.jsx` — day-view grid; drag-to-create with turnaround buffer rendering; booking popover with rate preview.
25. Build harbour hooks: `useHarbourMovements`, `useHarbourTariffs`, `useHarbourReports`, `useShippingAgents`.
26. Build `HarbourScreen.jsx` — Movements tab; `NewMovementModal`; `MovementDrawer` with dues preview and invoice generation. Document chain display: Original → Credit Note → New Invoice.
27. Build `HarbourTariffsScreen.jsx` — under Master Data; tabbed by due type; `TariffFormDrawer`.
28. Build `ShippingAgentsScreen.jsx` and `HarbourReportsScreen.jsx`.
