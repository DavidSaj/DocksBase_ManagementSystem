# Reservation Cart Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the flat `Booking` model into a `Reservation` (parent, financial/customer) + `ReservationItem` (child, physical slip) pair, enabling a single customer to book multiple berths in one payment.

**Architecture:** Every existing `Booking` becomes exactly one `Reservation` with one `ReservationItem` — a non-destructive structural migration. `Booking` is kept as a legacy table with a back-reference FK so no dependent code breaks until Phase 2 renames it away. `Invoice` gains a `reservation` FK alongside the existing `booking` FK; the billing service gets a new `calculate_reservation_invoice()` that operates on the new structure. Portal UI and comms/loyalty/reporting migration are explicitly out of scope for this plan.

**Tech Stack:** Django ORM, PostgreSQL, Django migrations (RunPython), DRF serializers, pytest-django

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `backend/apps/reservations/models.py` | Add `Reservation` + `ReservationItem` models; add `legacy_booking` back-ref |
| Create | `backend/apps/reservations/migrations/0015_reservation_and_item.py` | Schema: create two new tables |
| Create | `backend/apps/reservations/migrations/0016_backfill_reservations.py` | Data: each `Booking` → `Reservation` + `ReservationItem` |
| Modify | `backend/apps/billing/models.py` | Add nullable `Invoice.reservation` FK |
| Create | `backend/apps/billing/migrations/0020_invoice_reservation_fk.py` | Schema: add `Invoice.reservation` nullable FK |
| Create | `backend/apps/billing/migrations/0021_invoice_reservation_backfill.py` | Data: populate `Invoice.reservation` from `Invoice.booking` |
| Modify | `backend/apps/reservations/serializers.py` | Add `ReservationSerializer` + `ReservationItemSerializer` |
| Modify | `backend/apps/reservations/views.py` | Add `ReservationViewSet` + `ReservationItemViewSet` |
| Modify | `backend/apps/reservations/urls.py` | Register new routes |
| Modify | `backend/apps/billing/service.py` | Add `calculate_reservation_invoice()` |
| Modify | `backend/apps/reservations/tests.py` | All new tests live here (existing file, append) |

---

## Task 1: Add `Reservation` and `ReservationItem` models

**Files:**
- Modify: `backend/apps/reservations/models.py`
- Test: `backend/apps/reservations/tests.py`

### Background

`Reservation` owns the customer relationship and payment. `ReservationItem` owns one physical berth slot. The `legacy_booking` OneToOneField on `Reservation` is a nullable back-reference so existing `Invoice.booking` lookups can resolve to the new structure via `booking.reservation` during the transition period.

- [ ] **Step 1.1: Write failing model tests**

Append to `backend/apps/reservations/tests.py`:

```python
import pytest
import datetime
from decimal import Decimal


@pytest.mark.django_db
class TestReservationModel:
    def test_reservation_str(self, marina_factory):
        from apps.reservations.models import Reservation
        marina = marina_factory()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Alice',
            guest_email='alice@test.com',
            status='confirmed',
            total_price=Decimal('200.00'),
        )
        assert 'RES-' in str(res)
        assert 'Alice' in str(res)

    def test_reservation_item_str(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Bob',
            guest_email='bob@test.com',
            status='confirmed',
            total_price=Decimal('100.00'),
        )
        item = ReservationItem.objects.create(
            reservation=res,
            berth=berth,
            check_in=today,
            check_out=today + datetime.timedelta(days=2),
            nights=2,
            item_price=Decimal('100.00'),
        )
        assert berth.code in str(item)

    def test_reservation_total_price_sum_of_items(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        marina = marina_factory()
        berth1 = berth_factory(marina=marina)
        berth2 = berth_factory(marina=marina)
        today = datetime.date.today()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Fleet Owner',
            guest_email='fleet@test.com',
            status='confirmed',
            total_price=Decimal('0.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth1,
            check_in=today, check_out=today + datetime.timedelta(days=2),
            nights=2, item_price=Decimal('150.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth2,
            check_in=today, check_out=today + datetime.timedelta(days=2),
            nights=2, item_price=Decimal('90.00'),
        )
        total = sum(i.item_price for i in res.items.all())
        assert total == Decimal('240.00')
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
cd backend
pytest apps/reservations/tests.py::TestReservationModel -v
```

Expected: `ImportError` — `Reservation` does not exist yet.

- [ ] **Step 1.3: Add models to `models.py`**

Open `backend/apps/reservations/models.py`. After the existing `BookingRequest` class, append:

```python
class Reservation(models.Model):
    STATUS_CHOICES = [
        ('pending_approval', 'Pending Approval'),
        ('awaiting_payment', 'Awaiting Payment'),
        ('pending_payment',  'Pending Payment'),
        ('confirmed',        'Confirmed'),
        ('pending',          'Pending'),
        ('checked_in',       'Checked In'),
        ('checked_out',      'Checked Out'),
        ('overstay',         'Overstay'),
        ('no_show',          'No Show'),
        ('cancelled',        'Cancelled'),
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='reservations')
    member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='reservations')
    guest_name      = models.CharField(max_length=200, blank=True)
    guest_email     = models.EmailField(blank=True)
    guest_phone     = models.CharField(max_length=50, blank=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    paid            = models.BooleanField(default=False)
    total_price     = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True)
    waiver_envelope_id = models.CharField(max_length=255, null=True, blank=True)
    waiver_signed   = models.BooleanField(default=False)
    self_checked_in    = models.BooleanField(default=False)
    self_checked_in_at = models.DateTimeField(null=True, blank=True)
    booking_source  = models.CharField(max_length=100, default='direct', blank=True)
    notes           = models.TextField(blank=True)
    legacy_booking  = models.OneToOneField(
        'reservations.Booking',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reservation',
    )
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        name = self.member.name if self.member_id else self.guest_name
        return f'RES-{self.pk} — {name}'


class ReservationItem(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal',  'Seasonal'),
    ]

    reservation     = models.ForeignKey(Reservation, on_delete=models.CASCADE, related_name='items')
    berth           = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, null=True, blank=True, related_name='reservation_items')
    vessel          = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, null=True, blank=True, related_name='reservation_items')
    vessel_name     = models.CharField(max_length=200, blank=True)
    booking_type    = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    check_in        = models.DateField()
    check_out       = models.DateField()
    nights          = models.IntegerField(default=1)
    item_price      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    boat_loa        = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    boat_beam       = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    boat_draft      = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    eta             = models.TimeField(null=True, blank=True)
    is_sublet       = models.BooleanField(default=False)
    is_hourly       = models.BooleanField(default=False)
    start_time      = models.TimeField(null=True, blank=True)
    end_time        = models.TimeField(null=True, blank=True)
    dynamic_price_applied  = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    ota_commission_amount  = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    mysea_event_uid = models.CharField(max_length=255, blank=True, default='')
    insurance_doc   = models.FileField(upload_to='insurance/', null=True, blank=True)
    pre_cleared     = models.BooleanField(default=False)
    insurance_verified   = models.BooleanField(default=False)
    registration_verified = models.BooleanField(default=False)
    waiver_verified = models.BooleanField(default=False)
    document_gate_cleared    = models.BooleanField(default=False)
    document_gate_cleared_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='reservation_item_gate_clearances',
    )
    document_gate_cleared_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['check_in']

    def __str__(self):
        berth_code = self.berth.code if self.berth_id else 'unassigned'
        return f'ITEM-{self.pk} @ {berth_code} ({self.check_in} → {self.check_out})'
```

- [ ] **Step 1.4: Run tests — expect PASS**

```bash
cd backend
pytest apps/reservations/tests.py::TestReservationModel -v
```

Expected: 3 tests pass. If migration errors appear, run `python manage.py makemigrations reservations` first (Task 2 formalises it).

- [ ] **Step 1.5: Commit**

```bash
git add backend/apps/reservations/models.py backend/apps/reservations/tests.py
git commit -m "feat(reservations): add Reservation + ReservationItem models"
```

---

## Task 2: Schema migration for new tables

**Files:**
- Create: `backend/apps/reservations/migrations/0015_reservation_and_item.py`

- [ ] **Step 2.1: Generate the migration**

```bash
cd backend
python manage.py makemigrations reservations --name reservation_and_item
```

Expected output: `Migrations for 'reservations': apps/reservations/migrations/0015_reservation_and_item.py`

- [ ] **Step 2.2: Inspect the generated file**

Open `backend/apps/reservations/migrations/0015_reservation_and_item.py` and verify it creates both `reservations_reservation` and `reservations_reservationitem` tables. Confirm `legacy_booking` is a nullable OneToOneField pointing at `reservations_booking`. No manual edits needed if output looks correct.

- [ ] **Step 2.3: Apply the migration**

```bash
cd backend
python manage.py migrate reservations
```

Expected: `Applying reservations.0015_reservation_and_item... OK`

- [ ] **Step 2.4: Verify tables exist**

```bash
cd backend
python manage.py shell -c "from apps.reservations.models import Reservation, ReservationItem; print(Reservation.objects.count(), ReservationItem.objects.count())"
```

Expected: `0 0`

- [ ] **Step 2.5: Commit**

```bash
git add backend/apps/reservations/migrations/0015_reservation_and_item.py
git commit -m "feat(reservations): migration 0015 — create Reservation and ReservationItem tables"
```

---

## Task 3: Data migration — backfill existing Bookings

**Files:**
- Create: `backend/apps/reservations/migrations/0016_backfill_reservations.py`
- Modify: `backend/apps/reservations/tests.py`

### Background

Every existing `Booking` produces exactly one `Reservation` and one `ReservationItem`. The `Reservation.legacy_booking` FK points back to the source `Booking` so that `Invoice.booking.reservation` resolves cleanly in Task 5. The migration is idempotent: if `legacy_booking` already exists for a given Booking, it is skipped.

- [ ] **Step 3.1: Write migration test**

Append to `backend/apps/reservations/tests.py`:

```python
@pytest.mark.django_db
class TestBackfillMigration:
    def test_every_booking_gets_reservation(self, marina_factory, berth_factory):
        from django.test.utils import override_settings
        from apps.reservations.models import Booking, Reservation, ReservationItem
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        b = Booking.objects.create(
            marina=marina,
            berth=berth,
            check_in=today,
            check_out=today + datetime.timedelta(days=3),
            nights=3,
            guest_name='Test Guest',
            guest_email='test@test.com',
            amount=Decimal('300.00'),
            status='confirmed',
            booking_source='portal',
            boat_loa=Decimal('12.00'),
        )

        # Run the backfill function directly (same logic as the migration)
        from apps.reservations.migrations.backfill_helpers import backfill_booking
        backfill_booking(b)

        res = Reservation.objects.get(legacy_booking=b)
        assert res.marina_id == marina.pk
        assert res.guest_email == 'test@test.com'
        assert res.total_price == Decimal('300.00')
        assert res.status == 'confirmed'
        assert res.booking_source == 'portal'

        item = res.items.get()
        assert item.berth_id == berth.pk
        assert item.check_in == today
        assert item.nights == 3
        assert item.item_price == Decimal('300.00')
        assert item.boat_loa == Decimal('12.00')

    def test_backfill_is_idempotent(self, marina_factory, berth_factory):
        from apps.reservations.models import Booking, Reservation
        from apps.reservations.migrations.backfill_helpers import backfill_booking
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        b = Booking.objects.create(
            marina=marina, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=1),
            nights=1, guest_name='Repeat', guest_email='r@test.com',
            amount=Decimal('100.00'), status='confirmed',
        )
        backfill_booking(b)
        backfill_booking(b)  # second call must not create duplicates
        assert Reservation.objects.filter(legacy_booking=b).count() == 1
```

- [ ] **Step 3.2: Create the helper module**

Create `backend/apps/reservations/migrations/backfill_helpers.py`:

```python
"""
Shared logic used by both the RunPython migration and the test suite.
Import via: from apps.reservations.migrations.backfill_helpers import backfill_booking
"""
from django.db import transaction


def backfill_booking(booking):
    """Create Reservation + ReservationItem for one Booking. Idempotent."""
    from apps.reservations.models import Reservation, ReservationItem

    if Reservation.objects.filter(legacy_booking=booking).exists():
        return

    member = None
    if booking.vessel_id and hasattr(booking, 'vessel') and booking.vessel_id:
        try:
            from apps.members.models import Member
            if hasattr(booking.vessel, 'owner_id') and booking.vessel.owner_id:
                member = Member.objects.filter(pk=booking.vessel.owner_id).first()
        except Exception:
            pass

    with transaction.atomic():
        reservation = Reservation.objects.create(
            marina=booking.marina,
            member=member,
            guest_name=booking.guest_name,
            guest_email=booking.guest_email,
            guest_phone=booking.guest_phone,
            status=booking.status,
            paid=booking.paid,
            total_price=booking.amount,
            waiver_envelope_id=booking.waiver_envelope_id,
            waiver_signed=booking.waiver_signed,
            self_checked_in=booking.self_checked_in,
            self_checked_in_at=booking.self_checked_in_at,
            booking_source=booking.booking_source,
            notes=booking.notes,
            legacy_booking=booking,
            created_at=booking.created_at,
        )
        ReservationItem.objects.create(
            reservation=reservation,
            berth=booking.berth,
            vessel=booking.vessel,
            vessel_name=booking.vessel_name,
            booking_type=booking.booking_type,
            check_in=booking.check_in,
            check_out=booking.check_out,
            nights=booking.nights,
            item_price=booking.amount,
            boat_loa=booking.boat_loa,
            boat_beam=booking.boat_beam,
            boat_draft=booking.boat_draft,
            eta=booking.eta,
            is_sublet=booking.is_sublet,
            is_hourly=booking.is_hourly,
            start_time=booking.start_time,
            end_time=booking.end_time,
            dynamic_price_applied=booking.dynamic_price_applied,
            ota_commission_amount=booking.ota_commission_amount,
            mysea_event_uid=booking.mysea_event_uid,
            insurance_doc=booking.insurance_doc,
            pre_cleared=booking.pre_cleared,
            insurance_verified=booking.insurance_verified,
            registration_verified=booking.registration_verified,
            waiver_verified=booking.waiver_verified,
            document_gate_cleared=booking.document_gate_cleared,
            document_gate_cleared_by=booking.document_gate_cleared_by,
            document_gate_cleared_at=booking.document_gate_cleared_at,
            created_at=booking.created_at,
        )
```

- [ ] **Step 3.3: Run helper tests to verify they fail**

```bash
cd backend
pytest apps/reservations/tests.py::TestBackfillMigration -v
```

Expected: FAIL — `backfill_helpers` does not exist yet (file was just created above — if tests pass, move on).

- [ ] **Step 3.4: Run helper tests — expect PASS**

```bash
cd backend
pytest apps/reservations/tests.py::TestBackfillMigration -v
```

Expected: 2 tests pass.

- [ ] **Step 3.5: Create the RunPython migration**

Create `backend/apps/reservations/migrations/0016_backfill_reservations.py`:

```python
from django.db import migrations


def forwards(apps, schema_editor):
    Booking = apps.get_model('reservations', 'Booking')
    for booking in Booking.objects.select_related(
        'berth', 'vessel', 'vessel__owner', 'document_gate_cleared_by'
    ).iterator():
        # Use the ORM-safe version that works with historical models
        _backfill_one(apps, booking)


def _backfill_one(apps, booking):
    Reservation = apps.get_model('reservations', 'Reservation')
    ReservationItem = apps.get_model('reservations', 'ReservationItem')

    if Reservation.objects.filter(legacy_booking=booking).exists():
        return

    member_id = None
    if booking.vessel_id:
        try:
            vessel = booking.vessel
            if vessel.owner_id:
                member_id = vessel.owner_id
        except Exception:
            pass

    reservation = Reservation.objects.create(
        marina_id=booking.marina_id,
        member_id=member_id,
        guest_name=booking.guest_name,
        guest_email=booking.guest_email,
        guest_phone=booking.guest_phone,
        status=booking.status,
        paid=booking.paid,
        total_price=booking.amount,
        waiver_envelope_id=booking.waiver_envelope_id,
        waiver_signed=booking.waiver_signed,
        self_checked_in=booking.self_checked_in,
        self_checked_in_at=booking.self_checked_in_at,
        booking_source=booking.booking_source,
        notes=booking.notes,
        legacy_booking=booking,
        created_at=booking.created_at,
    )
    ReservationItem.objects.create(
        reservation=reservation,
        berth_id=booking.berth_id,
        vessel_id=booking.vessel_id,
        vessel_name=booking.vessel_name,
        booking_type=booking.booking_type,
        check_in=booking.check_in,
        check_out=booking.check_out,
        nights=booking.nights,
        item_price=booking.amount,
        boat_loa=booking.boat_loa,
        boat_beam=booking.boat_beam,
        boat_draft=booking.boat_draft,
        eta=booking.eta,
        is_sublet=booking.is_sublet,
        is_hourly=booking.is_hourly,
        start_time=booking.start_time,
        end_time=booking.end_time,
        dynamic_price_applied=booking.dynamic_price_applied,
        ota_commission_amount=booking.ota_commission_amount,
        mysea_event_uid=booking.mysea_event_uid,
        insurance_doc=booking.insurance_doc,
        pre_cleared=booking.pre_cleared,
        insurance_verified=booking.insurance_verified,
        registration_verified=booking.registration_verified,
        waiver_verified=booking.waiver_verified,
        document_gate_cleared=booking.document_gate_cleared,
        document_gate_cleared_by_id=booking.document_gate_cleared_by_id,
        document_gate_cleared_at=booking.document_gate_cleared_at,
        created_at=booking.created_at,
    )


def backwards(apps, schema_editor):
    Reservation = apps.get_model('reservations', 'Reservation')
    Reservation.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ('reservations', '0015_reservation_and_item'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
```

- [ ] **Step 3.6: Apply the migration**

```bash
cd backend
python manage.py migrate reservations
```

Expected: `Applying reservations.0016_backfill_reservations... OK`

- [ ] **Step 3.7: Verify backfill counts match**

```bash
cd backend
python manage.py shell -c "
from apps.reservations.models import Booking, Reservation, ReservationItem
b = Booking.objects.count()
r = Reservation.objects.count()
i = ReservationItem.objects.count()
print(f'Bookings: {b}, Reservations: {r}, Items: {i}')
assert r == b, 'Reservation count must equal Booking count'
assert i == b, 'ReservationItem count must equal Booking count'
print('OK — all bookings backfilled')
"
```

- [ ] **Step 3.8: Commit**

```bash
git add backend/apps/reservations/migrations/0016_backfill_reservations.py backend/apps/reservations/migrations/backfill_helpers.py backend/apps/reservations/tests.py
git commit -m "feat(reservations): migration 0016 — backfill Booking → Reservation + ReservationItem"
```

---

## Task 4: Add `Invoice.reservation` FK

**Files:**
- Modify: `backend/apps/billing/models.py`
- Create: `backend/apps/billing/migrations/0020_invoice_reservation_fk.py`
- Create: `backend/apps/billing/migrations/0021_invoice_reservation_backfill.py`
- Modify: `backend/apps/reservations/tests.py`

### Background

`Invoice.booking` stays (no regressions). We add a parallel `Invoice.reservation` FK. The backfill migration walks each Invoice that has a `booking`, looks up `booking.reservation` (now guaranteed to exist from Task 3), and sets `invoice.reservation` to it. All new code writes to `reservation`, ignoring `booking`.

- [ ] **Step 4.1: Write failing test**

Append to `backend/apps/reservations/tests.py`:

```python
@pytest.mark.django_db
class TestInvoiceReservationFK:
    def test_invoice_reservation_field_exists(self, marina_factory, berth_factory):
        from apps.billing.models import Invoice
        from apps.reservations.models import Reservation
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        res = Reservation.objects.create(
            marina=marina,
            guest_name='Invoice Test',
            guest_email='inv@test.com',
            status='confirmed',
            total_price=Decimal('150.00'),
        )
        inv = Invoice.objects.create(
            marina=marina,
            invoice_number='INV-2026-9999',
            status='draft',
            reservation=res,
        )
        assert Invoice.objects.get(pk=inv.pk).reservation_id == res.pk
```

- [ ] **Step 4.2: Run test — expect FAIL**

```bash
cd backend
pytest apps/reservations/tests.py::TestInvoiceReservationFK -v
```

Expected: `TypeError` — `Invoice` has no `reservation` field.

- [ ] **Step 4.3: Add `reservation` FK to `Invoice` model**

In `backend/apps/billing/models.py`, find the `booking` FK block (around line 52–58) and add the `reservation` FK directly after it:

```python
    booking = models.ForeignKey(
        'reservations.Booking',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
    )
    reservation = models.ForeignKey(
        'reservations.Reservation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
    )
```

- [ ] **Step 4.4: Generate schema migration**

```bash
cd backend
python manage.py makemigrations billing --name invoice_reservation_fk
```

Expected: creates `billing/migrations/0020_invoice_reservation_fk.py`

- [ ] **Step 4.5: Apply schema migration**

```bash
cd backend
python manage.py migrate billing
```

Expected: `Applying billing.0020_invoice_reservation_fk... OK`

- [ ] **Step 4.6: Run the invoice FK test — expect PASS**

```bash
cd backend
pytest apps/reservations/tests.py::TestInvoiceReservationFK -v
```

Expected: PASS.

- [ ] **Step 4.7: Create the backfill migration**

Create `backend/apps/billing/migrations/0021_invoice_reservation_backfill.py`:

```python
from django.db import migrations


def forwards(apps, schema_editor):
    Invoice = apps.get_model('billing', 'Invoice')
    for inv in Invoice.objects.filter(booking__isnull=False, reservation__isnull=True).select_related('booking').iterator():
        try:
            reservation = inv.booking.reservation
        except Exception:
            continue
        if reservation:
            inv.reservation = reservation
            inv.save(update_fields=['reservation'])


def backwards(apps, schema_editor):
    Invoice = apps.get_model('billing', 'Invoice')
    Invoice.objects.update(reservation=None)


class Migration(migrations.Migration):
    dependencies = [
        ('billing', '0020_invoice_reservation_fk'),
        ('reservations', '0016_backfill_reservations'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
```

- [ ] **Step 4.8: Apply the backfill migration**

```bash
cd backend
python manage.py migrate billing
```

Expected: `Applying billing.0021_invoice_reservation_backfill... OK`

- [ ] **Step 4.9: Verify Invoice backfill**

```bash
cd backend
python manage.py shell -c "
from apps.billing.models import Invoice
total = Invoice.objects.filter(booking__isnull=False).count()
linked = Invoice.objects.filter(booking__isnull=False, reservation__isnull=False).count()
print(f'Invoices with booking: {total}, now also linked to reservation: {linked}')
"
```

Expected: both numbers are equal.

- [ ] **Step 4.10: Commit**

```bash
git add backend/apps/billing/models.py backend/apps/billing/migrations/0020_invoice_reservation_fk.py backend/apps/billing/migrations/0021_invoice_reservation_backfill.py backend/apps/reservations/tests.py
git commit -m "feat(billing): add Invoice.reservation FK and backfill from Invoice.booking"
```

---

## Task 5: `ReservationSerializer` + `ReservationItemSerializer`

**Files:**
- Modify: `backend/apps/reservations/serializers.py`
- Modify: `backend/apps/reservations/tests.py`

- [ ] **Step 5.1: Write failing serializer test**

Append to `backend/apps/reservations/tests.py`:

```python
@pytest.mark.django_db
class TestReservationSerializer:
    def test_serializer_output(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from apps.reservations.serializers import ReservationSerializer
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        res = Reservation.objects.create(
            marina=marina,
            guest_name='Serializer Test',
            guest_email='ser@test.com',
            status='confirmed',
            total_price=Decimal('200.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=2),
            nights=2, item_price=Decimal('200.00'),
        )
        data = ReservationSerializer(res).data
        assert data['id'] == res.pk
        assert data['guest_email'] == 'ser@test.com'
        assert data['status'] == 'confirmed'
        assert len(data['items']) == 1
        assert data['items'][0]['berth_code'] is not None
```

- [ ] **Step 5.2: Run test — expect FAIL**

```bash
cd backend
pytest apps/reservations/tests.py::TestReservationSerializer -v
```

Expected: `ImportError` — `ReservationSerializer` does not exist yet.

- [ ] **Step 5.3: Add serializers**

In `backend/apps/reservations/serializers.py`, append after the existing `BookingRequestSerializer`:

```python
from .models import Reservation, ReservationItem


class ReservationItemSerializer(serializers.ModelSerializer):
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    vessel_name_resolved = serializers.CharField(source='vessel.name', read_only=True, default=None)

    class Meta:
        model = ReservationItem
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'vessel_name_resolved',
            'booking_type', 'check_in', 'check_out', 'nights', 'item_price',
            'boat_loa', 'boat_beam', 'boat_draft', 'eta',
            'is_sublet', 'is_hourly', 'start_time', 'end_time',
            'dynamic_price_applied', 'ota_commission_amount',
            'insurance_verified', 'registration_verified',
            'waiver_verified', 'document_gate_cleared',
            'pre_cleared', 'created_at',
        ]
        read_only_fields = ['id', 'berth_code', 'vessel_name_resolved', 'nights', 'created_at']


class ReservationSerializer(serializers.ModelSerializer):
    items = ReservationItemSerializer(many=True, read_only=True)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model = Reservation
        fields = [
            'id', 'marina', 'member', 'member_name',
            'guest_name', 'guest_email', 'guest_phone',
            'status', 'paid', 'total_price', 'stripe_payment_intent_id',
            'waiver_signed', 'self_checked_in', 'self_checked_in_at',
            'booking_source', 'notes', 'created_at',
            'items',
        ]
        read_only_fields = ['id', 'member_name', 'self_checked_in_at', 'created_at']
```

- [ ] **Step 5.4: Run test — expect PASS**

```bash
cd backend
pytest apps/reservations/tests.py::TestReservationSerializer -v
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add backend/apps/reservations/serializers.py backend/apps/reservations/tests.py
git commit -m "feat(reservations): add ReservationSerializer + ReservationItemSerializer"
```

---

## Task 6: REST endpoints for Reservation

**Files:**
- Modify: `backend/apps/reservations/views.py`
- Modify: `backend/apps/reservations/urls.py`
- Modify: `backend/apps/reservations/tests.py`

- [ ] **Step 6.1: Write failing endpoint test**

Append to `backend/apps/reservations/tests.py`:

```python
@pytest.mark.django_db
class TestReservationAPI:
    def test_list_reservations(self, api_client_factory, marina_factory, berth_factory):
        """Staff can list reservations for their marina."""
        from apps.reservations.models import Reservation
        from decimal import Decimal

        marina = marina_factory()
        client = api_client_factory(marina=marina)

        Reservation.objects.create(
            marina=marina, guest_name='API Guest',
            guest_email='api@test.com', status='confirmed',
            total_price=Decimal('100.00'),
        )
        resp = client.get(
            '/api/v1/reservations/',
            HTTP_X_MARINA_SLUG=marina.slug,
        )
        assert resp.status_code == 200
        assert len(resp.data) == 1
        assert resp.data[0]['guest_email'] == 'api@test.com'

    def test_reservation_detail_includes_items(self, api_client_factory, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from decimal import Decimal
        import datetime

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()
        client = api_client_factory(marina=marina)

        res = Reservation.objects.create(
            marina=marina, guest_name='Detail Test',
            guest_email='detail@test.com', status='confirmed',
            total_price=Decimal('150.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=3),
            nights=3, item_price=Decimal('150.00'),
        )
        resp = client.get(
            f'/api/v1/reservations/{res.pk}/',
            HTTP_X_MARINA_SLUG=marina.slug,
        )
        assert resp.status_code == 200
        assert len(resp.data['items']) == 1
        assert resp.data['items'][0]['nights'] == 3
```

**Note:** `api_client_factory` must be an existing fixture in your conftest that returns an authenticated DRF test client scoped to a marina. If the fixture name differs in your codebase, adjust accordingly.

- [ ] **Step 6.2: Run test — expect FAIL**

```bash
cd backend
pytest apps/reservations/tests.py::TestReservationAPI -v
```

Expected: 404 — route does not exist yet.

- [ ] **Step 6.3: Add `ReservationViewSet` to views**

In `backend/apps/reservations/views.py`, add at the top of the file (after existing imports):

```python
from .models import Reservation, ReservationItem
from .serializers import ReservationSerializer, ReservationItemSerializer
```

Then append at the bottom of the file:

```python
class ReservationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ReservationSerializer

    def get_queryset(self):
        marina = get_object_or_404(Marina, slug=self.request.headers.get('X-Marina-Slug'))
        return (
            Reservation.objects.filter(marina=marina)
            .prefetch_related('items__berth', 'items__vessel')
            .select_related('member')
            .order_by('-created_at')
        )
```

**Note:** `get_object_or_404`, `Marina`, and `viewsets` must already be imported in `views.py`. Add them to the import block at the top if missing.

- [ ] **Step 6.4: Register the route**

In `backend/apps/reservations/urls.py`, add:

```python
from .views import ReservationViewSet

router.register(r'reservations', ReservationViewSet, basename='reservation')
```

**Note:** Confirm the file already uses a `DefaultRouter` and includes `router.urls`. Add the register line with the existing router registrations — do not create a second router.

- [ ] **Step 6.5: Run test — expect PASS**

```bash
cd backend
pytest apps/reservations/tests.py::TestReservationAPI -v
```

Expected: 2 tests pass.

- [ ] **Step 6.6: Commit**

```bash
git add backend/apps/reservations/views.py backend/apps/reservations/urls.py backend/apps/reservations/tests.py
git commit -m "feat(reservations): add ReservationViewSet + list/detail endpoints"
```

---

## Task 7: `calculate_reservation_invoice()` in billing service

**Files:**
- Modify: `backend/apps/billing/service.py`
- Modify: `backend/apps/reservations/tests.py`

### Background

The existing `calculate_booking_invoice(booking)` is not removed — it continues working for legacy code paths. The new function `calculate_reservation_invoice(reservation)` iterates over `ReservationItem` objects, creates one line item per slip, and sets `Invoice.reservation`. Total price on the invoice equals the sum of all items (Option A — simple sum). No discount logic.

- [ ] **Step 7.1: Write failing test**

Append to `backend/apps/reservations/tests.py`:

```python
@pytest.mark.django_db
class TestCalculateReservationInvoice:
    def test_two_slips_produce_two_line_items(self, marina_factory, berth_factory, chargeable_item_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from apps.billing.service import calculate_reservation_invoice
        from apps.billing.models import Invoice
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth1 = berth_factory(marina=marina)
        berth2 = berth_factory(marina=marina)
        today = datetime.date.today()

        # A ChargeableItem must exist for the marina to price berths
        item = chargeable_item_factory(marina=marina, category='berth', pricing_model='per_night', unit_price=Decimal('50.00'))

        res = Reservation.objects.create(
            marina=marina, guest_name='Two Slips',
            guest_email='two@test.com', status='confirmed',
            total_price=Decimal('0.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth1,
            check_in=today, check_out=today + datetime.timedelta(days=2),
            nights=2, item_price=Decimal('100.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth2,
            check_in=today, check_out=today + datetime.timedelta(days=3),
            nights=3, item_price=Decimal('150.00'),
        )

        invoice = calculate_reservation_invoice(res)
        assert invoice is not None
        assert invoice.reservation_id == res.pk
        assert invoice.items.count() == 2

        totals = sorted(str(i.total_price) for i in invoice.items.all())
        assert totals == ['100.00', '150.00']

    def test_returns_none_when_no_chargeable_item(self, marina_factory, berth_factory):
        from apps.reservations.models import Reservation, ReservationItem
        from apps.billing.service import calculate_reservation_invoice
        import datetime
        from decimal import Decimal

        marina = marina_factory()
        berth = berth_factory(marina=marina)
        today = datetime.date.today()

        res = Reservation.objects.create(
            marina=marina, guest_name='No Catalog',
            guest_email='nc@test.com', status='confirmed',
            total_price=Decimal('100.00'),
        )
        ReservationItem.objects.create(
            reservation=res, berth=berth,
            check_in=today, check_out=today + datetime.timedelta(days=1),
            nights=1, item_price=Decimal('100.00'),
        )

        invoice = calculate_reservation_invoice(res)
        assert invoice is None
```

**Note:** `chargeable_item_factory` must be an existing pytest fixture. If the fixture name differs in your conftest, adjust accordingly. If it doesn't exist yet, create it in conftest:

```python
@pytest.fixture
def chargeable_item_factory():
    def factory(marina, category='berth', pricing_model='per_night', unit_price=None):
        from apps.billing.models import ChargeableItem, TaxRate
        from decimal import Decimal
        tax_rate, _ = TaxRate.objects.get_or_create(
            marina=marina, name='Standard — 20.00%',
            defaults={'rate': Decimal('20.00'), 'is_default': True},
        )
        return ChargeableItem.objects.create(
            marina=marina,
            name='Berth Fee',
            category=category,
            pricing_model=pricing_model,
            unit_price=unit_price or Decimal('50.00'),
            is_active=True,
            tax_category=tax_rate,
        )
    return factory
```

- [ ] **Step 7.2: Run test — expect FAIL**

```bash
cd backend
pytest apps/reservations/tests.py::TestCalculateReservationInvoice -v
```

Expected: `ImportError` — `calculate_reservation_invoice` does not exist yet.

- [ ] **Step 7.3: Add `calculate_reservation_invoice()` to `service.py`**

In `backend/apps/billing/service.py`, append after the existing `calculate_booking_invoice()` function:

```python
def calculate_reservation_invoice(reservation):
    """
    Create a draft invoice for a Reservation, one line item per ReservationItem.
    Uses Option A (simple sum) — no discount logic. Returns None if no
    suitable ChargeableItem is found for any item in the reservation.
    Never raises — caller wraps in try/except.
    """
    from .models import ChargeableItem
    from decimal import Decimal as D
    from apps.reservations.models import ReservationItem

    items = list(reservation.items.select_related('berth', 'vessel').all())
    if not items:
        return None

    catalog_item = ChargeableItem.objects.filter(
        marina=reservation.marina,
        category='berth',
        is_active=True,
    ).order_by('created_at').first()

    if not catalog_item:
        return None

    invoice = create_invoice(
        marina=reservation.marina,
        member=reservation.member,
        source_type='reservation',
        source_id=str(reservation.pk),
    )
    invoice.reservation = reservation
    invoice.save(update_fields=['reservation'])

    rate = D(str(catalog_item.tax_category.rate))

    for slot in items:
        nights = slot.nights or (slot.check_out - slot.check_in).days
        if nights <= 0:
            continue

        loa = slot.boat_loa
        if loa is None and slot.vessel_id:
            loa = slot.vessel.loa if hasattr(slot.vessel, 'loa') else None

        if catalog_item.pricing_model == 'per_meter_per_night':
            if not loa:
                continue
            quantity = D(str(loa)) * D(str(nights))
            description = f'Berth — {loa}m × {nights} nights'
        elif catalog_item.pricing_model == 'per_night':
            quantity = D(str(nights))
            description = f'Berth — {nights} nights'
        else:
            quantity = D('1')
            description = 'Berth fee'

        add_line_item(
            invoice=invoice,
            description=description,
            quantity=quantity,
            unit_price=catalog_item.unit_price,
            tax_rate=rate,
            chargeable_item=catalog_item,
        )

    if not invoice.items.exists():
        invoice.delete()
        return None

    return invoice
```

- [ ] **Step 7.4: Run tests — expect PASS**

```bash
cd backend
pytest apps/reservations/tests.py::TestCalculateReservationInvoice -v
```

Expected: 2 tests pass.

- [ ] **Step 7.5: Run the full test suite to check for regressions**

```bash
cd backend
pytest --tb=short -q
```

Expected: all existing tests still pass. Any failures are regressions — fix them before committing.

- [ ] **Step 7.6: Commit**

```bash
git add backend/apps/billing/service.py backend/apps/reservations/tests.py
git commit -m "feat(billing): add calculate_reservation_invoice for multi-slip cart"
```

---

## Task 8: Full regression run + push

- [ ] **Step 8.1: Run the complete test suite**

```bash
cd backend
pytest --tb=short
```

Expected: all tests pass with no failures.

- [ ] **Step 8.2: Verify migration graph is clean**

```bash
cd backend
python manage.py migrate --check
```

Expected: `No migrations to apply.`

- [ ] **Step 8.3: Push branch**

```bash
git push -u origin feature/website-astro-migration
```

---

## Out of Scope (Phase 2 — separate plans)

These are intentionally excluded. Do not implement them in this plan:

- **Portal UI** — the public booking flow creating a Reservation with multiple ReservationItems
- **Comms/loyalty/reporting** — updating journey triggers, loyalty points, and revenue intelligence serializers to reference Reservation instead of Booking
- **`Booking` deprecation** — removing the legacy table, renaming `Invoice.booking` FK, and deleting backfill helpers
- **Admin panel** — staff-facing Reservation management screens
- **Charter module** — `charter/services.py` references Booking directly
- **Multi-slip discount** — explicitly deferred per architecture decision (Option A)
