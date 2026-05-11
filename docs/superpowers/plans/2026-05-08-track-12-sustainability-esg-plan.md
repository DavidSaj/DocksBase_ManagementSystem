# Track 12 — Sustainability & ESG: Implementation Plan

**Date:** 2026-05-08
**Spec:** `docs/superpowers/specs/2026-05-07-track-12-sustainability-esg-design.md`
**App name:** `sustainability` (folder: `backend/apps/sustainability/`)
**Phase:** 5 (after billing Track 4; billing.ChargeableItem and FuelDockEntry must exist)

---

## Overview

Track 12 adds GHG accounting (Scope 1/2/3), waste logging, a monthly sustainability ledger, ESG board-report PDF generation (WeasyPrint, GRI-aligned), and Play It Green carbon offset integration. The module is entirely gated by `marina.features['esg_enabled']` — marinas without the flag see nothing: no sidebar, no API routes, no background jobs.

**Key invariants:**
- `SustainabilityLedger.revenue_gbp` uses recognised revenue only (via `DeferredRevenueRecognitionLog` when Track 4 is deployed; graceful fallback to gross `Invoice.total` otherwise).
- `offset ChargeableItem.is_discountable` must always be `False`. Enforced at creation time and in the coupon/loyalty engines.
- `on_invoice_paid` signal skips `OffsetContribution` creation when `line.unit_price <= 0`.
- The ESG PDF task runs on a **dedicated `pdf_generation` queue** with `--concurrency 1 --max-tasks-per-child 1 --max-memory-per-child 512000`. The main Celery worker pool must never process this queue.
- Ledger roll-up always re-aggregates `FuelDockEntry` → `Scope3Record` before stamping the ledger row (prevents stale Scope 3 from voided fuel sales).

---

## Prerequisites

1. `billing.ChargeableItem` must have `is_discountable` and `is_mandatory_transient_fee` fields — both already exist in the codebase as of the current state.
2. `fuel_dock.FuelDockEntry` must have an `is_internal_use = BooleanField(default=False)` field. This is a **cross-app migration** — add it to `apps/fuel_dock/` before running the sustainability migrations, so Scope 3 aggregation can exclude marina's own vehicle fuel.
3. `billing.Invoice.billing_period` field must exist — it does (CharField max_length=7, format `YYYY-MM`).
4. WeasyPrint must be installed in the Python environment (already used for invoices).
5. `apps/revenue/` must have `DeferredRevenueRecognitionLog` deployed before intensity metrics are accurate. The sustainability app guards against its absence with a try/except fallback.

---

## File Structure

```
backend/apps/sustainability/
    __init__.py
    apps.py
    models.py
    serializers.py
    views.py
    urls.py
    admin.py
    tasks.py              # Celery tasks
    calculations.py       # Pure-function emissions logic — zero ORM
    signals.py
    pdf_report.py         # WeasyPrint ESG report builder
    management/
        commands/
            seed_emission_factors.py
    templates/
        sustainability/
            esg_report.html
            esg_report_gri_annex.html
    migrations/
        0001_initial.py
        0002_seed_emission_factors.py    # data migration
```

---

## Cross-app Migration (do first)

### `apps/fuel_dock/migrations/XXXX_add_is_internal_use.py`

Add `is_internal_use = BooleanField(default=False)` to `FuelDockEntry`.

```python
# In FuelDockEntry model
is_internal_use = models.BooleanField(
    default=False,
    help_text=(
        "Set True when the marina fills its own workboat/vehicle at its own fuel dock. "
        "These litres are counted in Scope 1 (workboat_fuel) and must NOT appear in "
        "Scope 3 fuel_sold_vessels — counting here would double-tax the marina."
    ),
)
```

Run `makemigrations fuel_dock` and `migrate` before generating the sustainability migrations.

---

## Models (`apps/sustainability/models.py`)

Define all models in a single file in this exact order:

### 1. `EmissionFactor`

```python
class EmissionFactor(models.Model):
    class EnergyType(models.TextChoices):
        DIESEL      = 'diesel',      'Diesel'
        PETROL      = 'petrol',      'Petrol'
        LPG         = 'lpg',         'LPG'
        NATURAL_GAS = 'natural_gas', 'Natural Gas'
        ELECTRICITY = 'electricity', 'Grid Electricity'
        HVO         = 'hvo',         'HVO (Hydrotreated Vegetable Oil)'

    class UnitType(models.TextChoices):
        LITRE = 'litre', 'Litre'
        KWH   = 'kwh',   'kWh'
        KG    = 'kg',    'kg'
        TKM   = 'tkm',   'Tonne-kilometre'
        GBP   = 'gbp',   'GBP (spend-based)'
        USD   = 'usd',   'USD (spend-based)'
        EUR   = 'eur',   'EUR (spend-based)'

    class Source(models.TextChoices):
        DEFRA     = 'defra',     'DEFRA (UK)'
        EPA_EGRID = 'epa_egrid', 'EPA eGRID (US)'
        GRID_API  = 'grid_api',  'National Grid ESO API (live)'
        MANUAL    = 'manual',    'Manual (admin override)'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='emission_factors')
    energy_type      = models.CharField(max_length=20, choices=EnergyType.choices)
    kg_co2e_per_unit = models.DecimalField(max_digits=10, decimal_places=6)
    unit             = models.CharField(max_length=10, choices=UnitType.choices)
    jurisdiction     = models.CharField(max_length=10, blank=True)  # 'UK', 'US'
    valid_from       = models.DateField()
    valid_to         = models.DateField(null=True, blank=True)       # null = currently active
    source           = models.CharField(max_length=20, choices=Source.choices, default=Source.DEFRA)
    source_url       = models.URLField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['energy_type', '-valid_from']
```

**Factor lookup logic (used in Scope1Record.save and Scope3 aggregation):**

```python
def get_active_factor(marina, energy_type, date):
    """Returns the most-recently-valid EmissionFactor. Raises ValidationError if none found."""
    qs = EmissionFactor.objects.filter(
        marina=marina,
        energy_type=energy_type,
        valid_from__lte=date,
    ).filter(models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=date))
    factor = qs.order_by('-valid_from').first()
    if factor is None:
        raise ValidationError(
            f"No emission factor found for {energy_type} on {date}. "
            "Please add one in the Emission Factor Library."
        )
    return factor
```

### 2. `GridCarbonIntensity`

```python
class GridCarbonIntensity(models.Model):
    class GridSource(models.TextChoices):
        NATIONAL_GRID_ESO = 'ng_eso', 'National Grid ESO (UK)'
        EPA_EGRID         = 'epa',    'EPA eGRID (US)'
        MANUAL            = 'manual', 'Manual Override'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='grid_intensities')
    grid_source         = models.CharField(max_length=20, choices=GridSource.choices)
    region_code         = models.CharField(max_length=20, blank=True)
    valid_date          = models.DateField(db_index=True)
    kg_co2e_per_kwh     = models.DecimalField(max_digits=8, decimal_places=6)
    is_manual_override  = models.BooleanField(default=False)
    fetched_at          = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering       = ['-valid_date']
        unique_together = [('marina', 'valid_date')]
```

### 3. `Scope1Record`

```python
class Scope1Record(models.Model):
    class Source(models.TextChoices):
        VEHICLE_FUEL  = 'vehicle_fuel',  'Marina Vehicle'
        WORKBOAT_FUEL = 'workboat_fuel', 'Workboat / Launch'
        GENERATOR     = 'generator',     'Generator'
        MACHINERY     = 'machinery',     'Machinery / Equipment'
        MANUAL        = 'manual',        'Manual Entry'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='scope1_records')
    source          = models.CharField(max_length=20, choices=Source.choices)
    fuel_type       = models.CharField(max_length=20, choices=EmissionFactor.EnergyType.choices)
    quantity        = models.DecimalField(max_digits=10, decimal_places=3)
    unit            = models.CharField(max_length=10, editable=False, choices=EmissionFactor.UnitType.choices)
    date            = models.DateField()
    emission_factor = models.ForeignKey(EmissionFactor, on_delete=models.PROTECT, related_name='scope1_records')
    co2e_kg         = models.DecimalField(max_digits=12, decimal_places=4)   # computed on save
    notes           = models.CharField(max_length=500, blank=True)
    ap_reference    = models.CharField(max_length=100, blank=True)           # free-text only
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        # Derive unit from emission factor (LPG=kg, natural gas=kWh, diesel=litre)
        self.unit   = self.emission_factor.unit
        self.co2e_kg = calculate_scope1_co2e(self.quantity, self.emission_factor.kg_co2e_per_unit)
        super().save(*args, **kwargs)
```

### 4. `Scope2Record`

```python
class Scope2Record(models.Model):
    class DataSource(models.TextChoices):
        UTILITY_MODULE = 'utility', 'Utility Module (auto)'
        MANUAL         = 'manual',  'Manual Entry'

    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='scope2_records')
    period               = models.CharField(max_length=7, db_index=True)   # 'YYYY-MM'
    kwh_consumed         = models.DecimalField(max_digits=12, decimal_places=3)
    grid_intensity       = models.ForeignKey(GridCarbonIntensity, on_delete=models.PROTECT, null=True, blank=True)
    kg_co2e_per_kwh_used = models.DecimalField(max_digits=8, decimal_places=6)  # snapshot
    co2e_kg              = models.DecimalField(max_digits=12, decimal_places=4)
    data_source          = models.CharField(max_length=20, choices=DataSource.choices, default=DataSource.UTILITY_MODULE)
    notes                = models.CharField(max_length=500, blank=True)
    calculated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'period')]
```

### 5. `Scope3Record`

```python
class Scope3Record(models.Model):
    class Category(models.TextChoices):
        FUEL_SOLD_VESSELS = 'fuel_sold_vessels', 'Fuel Sold to Vessels (fuel dock)'
        SUPPLIER_DELIVERY = 'supplier_delivery', 'Supplier Deliveries'
        STAFF_COMMUTE     = 'staff_commute',     'Staff Commute (optional)'
        OTHER             = 'other',             'Other (manual)'

    class DataSource(models.TextChoices):
        FUEL_DOCK_AUTO = 'fuel_dock_auto', 'Fuel Dock (auto-calculated)'
        MANUAL         = 'manual',         'Manual Entry'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='scope3_records')
    period           = models.CharField(max_length=7, db_index=True)
    category         = models.CharField(max_length=30, choices=Category.choices)
    fuel_type        = models.CharField(max_length=20, blank=True, choices=EmissionFactor.EnergyType.choices)
    quantity         = models.DecimalField(max_digits=12, decimal_places=3)
    unit             = models.CharField(max_length=10, choices=EmissionFactor.UnitType.choices)
    emission_factor  = models.ForeignKey(EmissionFactor, on_delete=models.PROTECT, null=True, blank=True)
    co2e_kg          = models.DecimalField(max_digits=12, decimal_places=4)
    data_source      = models.CharField(max_length=20, choices=DataSource.choices, default=DataSource.MANUAL)
    source_reference = models.CharField(max_length=100, blank=True)
    distance_km      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    spend_amount     = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    notes            = models.CharField(max_length=500, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'period', 'category', 'fuel_type')]
        # unique_together backs the update_or_create pattern. Running the
        # aggregation task twice for the same period/category/fuel_type is safe.
```

### 6. `WasteLog`

```python
class WasteLog(models.Model):
    class Category(models.TextChoices):
        GENERAL     = 'general',     'General Waste'
        RECYCLING   = 'recycling',   'Recycling'
        HAZARDOUS   = 'hazardous',   'Hazardous Waste'
        ANTIFOULING = 'antifouling', 'Antifouling Paint'
        BILGE_OIL   = 'bilge_oil',   'Bilge Oil'
        PUMP_OUT    = 'pump_out',    'Pump-out (sewage)'

    class DisposalMethod(models.TextChoices):
        LANDFILL          = 'landfill',          'Landfill'
        RECYCLED          = 'recycled',           'Recycled'
        COMPOSTED         = 'composted',          'Composted'
        SPECIALIST        = 'specialist',         'Specialist Disposal'
        INCINERATED       = 'incinerated',        'Incinerated (energy recovery)'
        RETURNED_SUPPLIER = 'returned_supplier',  'Returned to Supplier'

    CATEGORY_UNIT_MAP = {
        'general': 'kg', 'recycling': 'kg', 'hazardous': 'kg', 'antifouling': 'kg',
        'bilge_oil': 'litres', 'pump_out': 'litres',
    }

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='waste_logs')
    date                = models.DateField()
    category            = models.CharField(max_length=20, choices=Category.choices)
    quantity            = models.DecimalField(max_digits=10, decimal_places=3)
    unit                = models.CharField(max_length=10, editable=False,
                                           choices=[('kg', 'kg'), ('litres', 'litres')])
    disposal_method     = models.CharField(max_length=30, choices=DisposalMethod.choices)
    waste_carrier       = models.CharField(max_length=200, blank=True)
    carrier_licence_ref = models.CharField(max_length=100, blank=True)
    disposal_note       = models.CharField(max_length=500, blank=True)
    logged_by           = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        self.unit = self.CATEGORY_UNIT_MAP.get(self.category, 'kg')
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['-date']
```

### 7. `SustainabilityLedger`

```python
class SustainabilityLedger(models.Model):
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='sustainability_ledger')
    period               = models.CharField(max_length=7, db_index=True)   # 'YYYY-MM'

    scope1_co2e_kg       = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    scope2_co2e_kg       = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    scope3_co2e_kg       = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_co2e_kg        = models.DecimalField(max_digits=14, decimal_places=4, default=0)

    revenue_gbp          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    berth_nights         = models.PositiveIntegerField(default=0)

    co2e_kg_per_gbp_revenue  = models.DecimalField(max_digits=12, decimal_places=6, null=True)
    co2e_kg_per_berth_night  = models.DecimalField(max_digits=12, decimal_places=4, null=True)

    offset_co2e_kg       = models.DecimalField(max_digits=12, decimal_places=4, default=0)

    computed_at          = models.DateTimeField(auto_now=True)
    is_stale             = models.BooleanField(default=False,
                           help_text="Set True by signals when source data changes. Cleared by recalculation.")

    class Meta:
        unique_together = [('marina', 'period')]
        ordering        = ['-period']
```

### 8. `OffsetContribution`

```python
class OffsetContribution(models.Model):
    class Partner(models.TextChoices):
        PLAY_IT_GREEN = 'play_it_green', 'Play It Green'
        MANUAL        = 'manual',        'Manual / Other'

    marina                = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='offset_contributions')
    booking               = models.ForeignKey('reservations.Booking', on_delete=models.SET_NULL, null=True, blank=True, related_name='offset_contributions')
    invoice_line_item     = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL, null=True, blank=True)
    partner               = models.CharField(max_length=20, choices=Partner.choices, default=Partner.PLAY_IT_GREEN)
    amount_gbp            = models.DecimalField(max_digits=10, decimal_places=2)
    local_currency_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    local_currency_code   = models.CharField(max_length=3, blank=True)
    exchange_rate_used    = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    units_purchased       = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    unit_type             = models.CharField(max_length=50, blank=True)   # 'fronds', 'trees'
    certificate_url       = models.URLField(blank=True)
    pig_contribution_id   = models.CharField(max_length=100, blank=True)  # '' = not yet synced
    co2e_offset_kg        = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    synced_at             = models.DateTimeField(null=True, blank=True)
    created_at            = models.DateTimeField(auto_now_add=True)
```

### 9. `ESGReportArchive`

```python
class ESGReportArchive(models.Model):
    class Framework(models.TextChoices):
        GRI       = 'gri',       'GRI Standards'
        NARRATIVE = 'narrative', 'Narrative Only'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        READY   = 'ready',   'Ready'
        FAILED  = 'failed',  'Failed'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='esg_report_archive')
    period_from     = models.CharField(max_length=7)   # 'YYYY-MM'
    period_to       = models.CharField(max_length=7)
    framework       = models.CharField(max_length=20, choices=Framework.choices)
    status          = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    pdf_file        = models.FileField(upload_to='esg_reports/%Y/%m/', blank=True)
    celery_task_id  = models.CharField(max_length=255, blank=True)   # in-progress tracking only
    error_detail    = models.CharField(max_length=500, blank=True)
    generated_at    = models.DateTimeField(null=True, blank=True)
    generated_by    = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### 10. `PlayItGreenSync`

```python
class PlayItGreenSync(models.Model):
    class Direction(models.TextChoices):
        PUSH = 'push', 'Push (contributions sent)'
        PULL = 'pull', 'Pull (certificates retrieved)'

    class Status(models.TextChoices):
        SUCCESS = 'success', 'Success'
        FAILED  = 'failed',  'Failed'
        PARTIAL = 'partial', 'Partial'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='pig_syncs')
    direction     = models.CharField(max_length=10, choices=Direction.choices)
    status        = models.CharField(max_length=10, choices=Status.choices)
    records_count = models.PositiveIntegerField(default=0)
    total_gbp     = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    response_body = models.TextField(blank=True)   # raw JSON response, truncated at 10,000 chars
    error_detail  = models.CharField(max_length=500, blank=True)
    synced_at     = models.DateTimeField(auto_now_add=True)
```

---

## `calculations.py` — Pure Calculation Functions

**No ORM calls in this module.** All functions accept raw `Decimal` values. This makes unit tests trivial.

```python
from decimal import Decimal, ROUND_HALF_UP

def calculate_scope1_co2e(quantity: Decimal, kg_co2e_per_unit: Decimal) -> Decimal:
    """
    quantity: fuel consumed in the emission factor's native unit (litre, kg, or kWh).
    Do NOT assume litres. LPG is measured in kg; natural gas in kWh.
    """
    return (quantity * kg_co2e_per_unit).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def calculate_scope2_co2e(kwh_consumed: Decimal, kg_co2e_per_kwh: Decimal) -> Decimal:
    return (kwh_consumed * kg_co2e_per_kwh).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def calculate_scope3_fuel_sold(actual_litres: Decimal, kg_co2e_per_unit: Decimal) -> Decimal:
    """
    Only call with litres from FuelDockEntry rows where is_internal_use=False.
    Internal marina fuel is Scope 1 — counting it here doubles the emissions.
    """
    return (actual_litres * kg_co2e_per_unit).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def calculate_diversion_rate(total_quantity: Decimal, diverted_quantity: Decimal) -> Decimal:
    """Returns 0.00 when total_quantity is zero — never raises ZeroDivisionError."""
    if total_quantity == Decimal('0.00'):
        return Decimal('0.00')
    return (diverted_quantity / total_quantity * 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
```

Also in `calculations.py`:

```python
def get_grid_intensity_for_period(marina, period: str) -> tuple[Decimal, str]:
    """
    Fallback hierarchy (returns (kg_co2e_per_kwh, source_label)):
    1. GridCarbonIntensity with is_manual_override=True for period.
    2. Most recent GridCarbonIntensity from live API feed (only when live_grid_intensity_enabled=True).
    3. EmissionFactor for electricity for this marina/jurisdiction (annual static).
    4. Hard-coded constant (UK=0.23314, US=0.386).
    Never returns zero; always logs which fallback was used.
    """
    ...

def get_recognized_revenue_for_period(marina_id: int, period: str) -> Decimal:
    """
    Revenue denominator for intensity metrics. Uses DeferredRevenueRecognitionLog
    when available; falls back to gross Invoice.total with a warning log.
    NEVER aggregate Invoice.total directly for intensity metrics.
    See spec Section 5.4 for full implementation.
    """
    try:
        from billing.models import DeferredRevenueRecognitionLog
        ...
    except Exception:
        import logging
        logging.getLogger(__name__).warning(
            "DeferredRevenueRecognitionLog unavailable for marina_id=%s period=%s — "
            "using gross Invoice total. Deploy Track 4 for accurate revenue recognition.",
            marina_id, period,
        )
        ...

def compute_ledger_row(marina_id: int, period: str) -> dict:
    """
    Aggregates all scope totals, revenue, and berth-nights.
    Returns a dict ready to upsert into SustainabilityLedger.
    Called by: nightly Celery task, recalculate API endpoint.
    Both callers MUST call calculate_scope3_fuel_dock_for_period(marina, period)
    FIRST to ensure Scope 3 is current before computing the ledger.
    """
    ...
```

---

## Signals (`signals.py`)

```python
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.db import transaction


def _flag_ledger_stale_and_queue(marina_id: int, period: str):
    """
    Marks the SustainabilityLedger row stale and dispatches a recalculation task.
    Redis deduplication (cache.add) prevents duplicate tasks within a 60-second window.
    on_commit ensures the signal fires only after the triggering write commits.
    """
    def _do():
        from django.core.cache import cache
        from apps.sustainability.tasks import recalculate_ledger_period

        DEDUPE_KEY = f'ledger:recalc:{marina_id}:{period}'
        if not cache.add(DEDUPE_KEY, '1', timeout=60):
            return  # duplicate dispatch within 60s window — skip

        SustainabilityLedger.objects.filter(
            marina_id=marina_id, period=period
        ).update(is_stale=True)

        recalculate_ledger_period.apply_async(
            args=[marina_id, period],
            countdown=30,  # brief debounce for rapid consecutive edits
        )
    transaction.on_commit(_do)


@receiver(post_save, sender='sustainability.Scope1Record')
@receiver(post_delete, sender='sustainability.Scope1Record')
def scope1_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.date.strftime('%Y-%m'))


@receiver(post_save, sender='sustainability.Scope2Record')
@receiver(post_delete, sender='sustainability.Scope2Record')
def scope2_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.period)


@receiver(post_save, sender='sustainability.Scope3Record')
@receiver(post_delete, sender='sustainability.Scope3Record')
def scope3_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.period)


@receiver(post_save, sender='sustainability.WasteLog')
@receiver(post_delete, sender='sustainability.WasteLog')
def waste_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.date.strftime('%Y-%m'))
```

Register in `apps.py`:

```python
class SustainabilityConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.sustainability'

    def ready(self):
        import apps.sustainability.signals  # noqa
```

**Invoice paid signal (in `signals.py`):**

```python
from django.db.models.signals import post_save
from apps.billing.models import Invoice
import logging
logger = logging.getLogger(__name__)

@receiver(post_save, sender=Invoice)
def on_invoice_paid_create_offset(sender, instance, **kwargs):
    """
    On invoice payment, create OffsetContribution for each offset line item.
    GUARDS:
    1. Invoice must be status='paid'.
    2. Line item chargeable_item category must be 'offset'.
    3. line.unit_price must be > 0 (coupon/loyalty/manual zero guard).
    """
    if instance.status != 'paid':
        return
    for line in instance.line_items.filter(chargeable_item__category='offset').select_related('chargeable_item'):
        if line.unit_price <= 0:
            logger.warning(
                "Offset line item %s has unit_price=%s on paid Invoice %s — "
                "OffsetContribution NOT created. Investigate discount/coupon application.",
                line.pk, line.unit_price, instance.pk,
            )
            continue
        transaction.on_commit(lambda lid=line.pk: create_offset_contribution.delay(lid))
```

---

## Service: Grid Carbon Intensity Fallback

Implement `get_grid_intensity_for_period(marina, period)` in `calculations.py`:

1. Check `GridCarbonIntensity.objects.filter(marina=marina, is_manual_override=True, valid_date__startswith=period)` — use this if found.
2. If `marina.features.get('live_grid_intensity_enabled')`: find most recent `GridCarbonIntensity` row with `valid_date <= period_end` that is not a manual override.
3. Look up `EmissionFactor` for `energy_type='electricity'` with matching jurisdiction and valid date range.
4. Hard-coded constants: UK = `Decimal('0.23314')`, US = `Decimal('0.386')`.

Log which tier was used, e.g. `logger.info("Scope 2 grid intensity: using fallback tier 3 (static EmissionFactor) for marina=%s period=%s", ...)`.

---

## Celery Tasks (`tasks.py`)

Write all tasks as plain functions. Add `# @shared_task` stub comment above each for when Celery is wired.

### Task 1: `fetch_grid_intensity()`

- Schedule: daily at 02:00 UTC.
- Guard: only process marinas where `marina.features.get('live_grid_intensity_enabled', False)`.
- UK marinas: `GET https://api.carbonintensity.org.uk/intensity/date/{YYYY-MM-DD}` (yesterday). Average all 30-minute `intensity.actual` values. Convert gCO₂/kWh → kgCO₂/kWh (÷ 1000). Write `GridCarbonIntensity(grid_source='ng_eso', valid_date=yesterday, kg_co2e_per_kwh=avg)`.
- US marinas: read from static eGRID JSON (`CO2RTA` column, lb CO₂/MWh → kgCO₂/kWh × 0.000453592).
- Skip if `is_manual_override=True` row already exists for that date.
- 1-second courtesy sleep between marinas.
- Log warning if 3+ consecutive days fail.

### Task 2: `calculate_scope3_fuel_dock()`

- Schedule: 1st of each month at 03:00 UTC (for previous month).
- For each active ESG-enabled marina, call `calculate_scope3_fuel_dock_for_period(marina, prev_period)`.

**Shared helper `calculate_scope3_fuel_dock_for_period(marina, period)`:**

```python
def calculate_scope3_fuel_dock_for_period(marina, period: str):
    from apps.fuel_dock.models import FuelDockEntry
    from django.db.models import Sum

    year, month = period.split('-')
    # Aggregate completed FuelDockEntry rows for the period by fuel_type
    qs = FuelDockEntry.objects.filter(
        marina=marina,
        status='completed',
        is_internal_use=False,        # MUST exclude marina's own vehicle fuel (already in Scope 1)
        actual_litres__isnull=False,  # exclude incomplete jobs
        completed_at__year=year,
        completed_at__month=month,
    )
    excluded_count = FuelDockEntry.objects.filter(
        marina=marina, status='completed', actual_litres__isnull=True,
        completed_at__year=year, completed_at__month=month,
    ).count()

    for fuel_type in ['diesel', 'petrol']:
        total_litres = qs.filter(fuel_type=fuel_type).aggregate(Sum('actual_litres'))['actual_litres__sum']
        if not total_litres:
            continue
        factor = get_active_factor(marina, fuel_type, date(int(year), int(month), 1))
        co2e   = calculate_scope3_fuel_sold(Decimal(str(total_litres)), factor.kg_co2e_per_unit)
        Scope3Record.objects.update_or_create(
            marina=marina, period=period,
            category='fuel_sold_vessels', fuel_type=fuel_type,
            defaults={
                'quantity': total_litres,
                'unit': 'litre',
                'emission_factor': factor,
                'co2e_kg': co2e,
                'data_source': 'fuel_dock_auto',
                'source_reference': f"FuelDockEntry period={period} fuel_type={fuel_type}",
                'notes': f"{excluded_count} entries excluded (null actual_litres).",
            }
        )
```

This helper is called by both Task 2 and Task 3. Never inline it.

### Task 3: `roll_sustainability_ledger()`

- Schedule: nightly at 04:00 UTC (every night, not just month-end).
- For each ESG-enabled marina: compute current period and previous period.
- For each period:
  1. **Re-aggregate Scope 3 fuel dock first** — `calculate_scope3_fuel_dock_for_period(marina, period)`.
  2. Apply Scope 2 manual override guard:
     ```python
     existing_s2 = Scope2Record.objects.filter(marina=marina, period=period).first()
     if existing_s2 and existing_s2.data_source == 'manual':
         pass  # skip — never overwrite human-verified manual Scope 2 data
     else:
         # Run utility module aggregation → write Scope2Record
     ```
  3. `compute_ledger_row(marina.id, period)`.
  4. Upsert `SustainabilityLedger` with `is_stale=False`.

### Task 4: `recalculate_ledger_period(marina_id, period)`

- On-demand, triggered by staleness signals (30-second countdown).
- Same steps as one period in Task 3.
- Sets `is_stale=False` on completion.

### Task 5: `sync_play_it_green()`

- Schedule: weekly on Sunday at 05:00 UTC.
- For each marina with `pig_api_key` set in `marina.features`:
  - **Push:** Query `OffsetContribution.objects.filter(marina=marina, pig_contribution_id='')`. Batch POST to PIG API. On success: update `pig_contribution_id`, `units_purchased`, `unit_type`, `synced_at`. Write `PlayItGreenSync` row.
  - **Pull:** Query `OffsetContribution.objects.filter(marina=marina).exclude(pig_contribution_id='').filter(certificate_url='')`. GET certificate for each. Update `certificate_url`, `co2e_offset_kg`. Write `PlayItGreenSync` row.
  - HTTP 4xx: log, mark failed, do NOT auto-retry.
  - HTTP 5xx / timeout: retry up to 3 times (exponential backoff). After 3 failures: write `PlayItGreenSync(status='failed')`, send admin email alert.
  - Missing/invalid API key: skip, log warning.

### Task 6: `create_offset_contribution(line_item_id)`

- On-demand, triggered by `on_invoice_paid` signal via `transaction.on_commit()`.
- Creates `OffsetContribution` for the given `InvoiceLineItem`.
- If marina currency != GBP: call `ExchangeRate.convert(amount, from_currency=currency, to_currency='GBP', date=today)` from Track 4. Store in `amount_gbp`, `local_currency_amount`, `local_currency_code`, `exchange_rate_used`.

### Task 7: `generate_esg_report_async(archive_id)`

```python
# @shared_task(
#     name='sustainability.generate_esg_report_async',
#     queue='pdf_generation',      # MANDATORY: dedicated queue
#     acks_late=True,              # requeue if worker killed mid-task
#     reject_on_worker_lost=True,  # requeue on OOM kill
# )
def generate_esg_report_async(archive_id: int):
    archive = ESGReportArchive.objects.get(pk=archive_id)
    try:
        pdf_bytes = generate_esg_report_pdf(archive)
        # Save to media storage
        filename  = f"{archive.marina.slug}-esg-report-{archive.period_from}-{archive.period_to}.pdf"
        archive.pdf_file.save(filename, ContentFile(pdf_bytes), save=False)
        archive.status       = ESGReportArchive.Status.READY
        archive.generated_at = now()
        archive.save(update_fields=['pdf_file', 'status', 'generated_at'])
    except Exception as exc:
        archive.status       = ESGReportArchive.Status.FAILED
        archive.error_detail = str(exc)[:500]
        archive.save(update_fields=['status', 'error_detail'])
        raise  # re-raise so Celery marks the task as failed
```

**Dedicated Celery worker configuration (document in `docker-compose.yml` / supervisor):**

```bash
# PDF generation worker — COMPLETELY SEPARATE from main worker pool
celery -A backend worker \
    --queues pdf_generation \
    --concurrency 1 \             # one PDF at a time per process
    --max-tasks-per-child 1 \     # restart process after every report (WeasyPrint memory leak)
    --max-memory-per-child 512000 # hard 512 MB RSS limit
```

The main worker must explicitly NOT process `pdf_generation` queue tasks:
```bash
celery -A backend worker --queues celery  # default queue only, excludes pdf_generation
```

---

## API Endpoints

Base path: `/api/v1/sustainability/`

All ViewSets inherit from a `ESGFeatureGuardMixin` that checks `request.user.marina.features.get('esg_enabled', False)` and returns `403` if the flag is false.

### Emission Factors

| Method | URL | Notes |
|---|---|---|
| GET/POST/PATCH | `/emission-factors/` | CRUD |
| DELETE | `/emission-factors/{id}/` | Catch `ProtectedError` → return `409 {"detail": "...Set valid_to to retire instead."}` |

### Scope 1

| Method | URL | Notes |
|---|---|---|
| GET | `/scope1/?period=YYYY-MM` | |
| POST | `/scope1/` | `co2e_kg` computed server-side; never accept from client |
| PATCH | `/scope1/{id}/` | Recomputes `co2e_kg` |
| DELETE | `/scope1/{id}/` | |

### Scope 2

| Method | URL | Notes |
|---|---|---|
| GET | `/scope2/?period=YYYY-MM` | |
| POST | `/scope2/` | Manual entry only |
| PATCH | `/scope2/{id}/` | |
| GET | `/scope2/recalculate/?period=YYYY-MM` | Triggers utility module aggregation. Respects manual override guard: if existing record has `data_source='manual'`, return `409 {"detail": "Manual record exists. Delete it first to enable auto-calculation."}` |

### Scope 3

| Method | URL | Notes |
|---|---|---|
| GET | `/scope3/?period=YYYY-MM&category=fuel_sold_vessels` | |
| POST | `/scope3/` | Manual entry |
| PATCH | `/scope3/{id}/` | |
| DELETE | `/scope3/{id}/` | |
| GET | `/scope3/recalculate/?period=YYYY-MM` | Triggers `calculate_scope3_fuel_dock_for_period` for the period |

### Waste Log

| Method | URL | Notes |
|---|---|---|
| GET | `/waste-log/?period=YYYY-MM&category=hazardous` | |
| POST | `/waste-log/` | `unit` field from client silently discarded in serializer |
| PATCH | `/waste-log/{id}/` | |
| DELETE | `/waste-log/{id}/` | |
| GET | `/waste-log/diversion-rate/?period=YYYY-MM` | Returns diversion rate summary. Returns `{"total_kg": 0, "diversion_rate_pct": 0.0, ...}` when no data — never 500. |

**Unit enforcement in `WasteLogSerializer`:**

```python
def to_internal_value(self, data):
    data = data.copy()
    data.pop('unit', None)   # silently discard — model.save() derives it from category
    return super().to_internal_value(data)
```

### Sustainability Ledger

| Method | URL | Notes |
|---|---|---|
| GET | `/ledger/` | All periods for marina |
| GET | `/ledger/?period=YYYY-MM` | Single period |
| POST | `/ledger/recalculate/` | Body: `{"period": "YYYY-MM"}`. Calls Scope 3 re-aggregation then `compute_ledger_row`. Clears `is_stale`. |

Response includes both `_kg` (stored) and `_tco2e` (computed: `_kg / 1000`, 3 decimal places) variants for all scope fields. Returns `null` for intensity metrics when denominator is zero.

### ESG Report

| Method | URL | Notes |
|---|---|---|
| POST | `/esg-report/generate/` | Body: `{"period_from", "period_to", "framework": "gri"\|"narrative"}`. `"tcfd"` returns `400`. Creates `ESGReportArchive(status='pending')`, dispatches task, returns `{"archive_id": N, "status": "pending"}`. |
| GET | `/esg-report/{archive_id}/status/` | Reads `ESGReportArchive.status` from DB — not Celery result state. |
| GET | `/esg-report/{archive_id}/download/` | Streams `pdf_file` from media/S3. |
| GET | `/esg-report/history/` | All `ESGReportArchive` rows for marina ordered by `created_at` desc. |

### Offset Contributions

| Method | URL |
|---|---|
| GET | `/offset-contributions/?booking_id=123` |
| POST | `/offset-contributions/` |
| GET | `/offset-contributions/summary/` |
| POST | `/offset-contributions/sync/` |

### Grid Carbon Intensity

| Method | URL | Notes |
|---|---|---|
| GET | `/grid-intensity/?limit=30` | |
| POST | `/grid-intensity/` | Manual override creation |
| DELETE | `/grid-intensity/{id}/` | Remove manual override |

---

## PDF Report (`pdf_report.py`)

```python
def generate_esg_report_pdf(archive: ESGReportArchive) -> bytes:
    """
    Renders the ESG report HTML template to PDF using WeasyPrint.
    Returns raw PDF bytes. Caller saves to media storage.
    Raises on any error — caller sets ESGReportArchive.error_detail.
    """
    from weasyprint import HTML
    from django.template.loader import render_to_string

    marina = archive.marina
    ledger_rows = SustainabilityLedger.objects.filter(
        marina=marina, period__gte=archive.period_from, period__lte=archive.period_to
    )
    context = {
        'marina':      marina,
        'archive':     archive,
        'ledger_rows': ledger_rows,
        'scope1_data': Scope1Record.objects.filter(...),
        'scope2_data': Scope2Record.objects.filter(...),
        'scope3_data': Scope3Record.objects.filter(...),
        'waste_data':  WasteLog.objects.filter(...),
        'offset_data': OffsetContribution.objects.filter(...),
        'prior_year_ledger': _get_prior_year_ledger(marina, archive),
        'gri':         archive.framework == 'gri',
    }
    html_str = render_to_string('sustainability/esg_report.html', context)
    if archive.framework == 'gri':
        gri_str = render_to_string('sustainability/esg_report_gri_annex.html', context)
        html_str += gri_str

    return HTML(string=html_str, base_url=settings.MEDIA_ROOT).write_pdf()
```

**Template sections** (`esg_report.html`):
1. Cover page (marina name, logo, period, generated date, framework badge)
2. Executive Summary (KPI totals)
3. Scope 1 table (fuel types, quantities, factors, kgCO₂e)
4. Scope 2 section (kWh, grid intensity source label, kgCO₂e)
5. Scope 3 table (by category)
6. Waste & Disposal table (category, quantity, disposal method, diversion rate %)
7. Carbon Offsets section (£ total, units, certificates)
8. Year-on-Year Comparison — prior-year column shows "Not available — module activated {date}" if no prior-year ledger rows exist. Column is always rendered, never omitted.
9. Methodology Note (data sources, known gaps)

**TCFD guard in view:**

```python
if request.data.get('framework') == 'tcfd':
    return Response(
        {"detail": "TCFD framework is not yet available."},
        status=status.HTTP_400_BAD_REQUEST,
    )
```

---

## Admin (`admin.py`)

```python
@admin.register(EmissionFactor)
class EmissionFactorAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'energy_type', 'kg_co2e_per_unit', 'unit', 'valid_from', 'valid_to', 'source']
    list_filter   = ['energy_type', 'source']
    search_fields = ['marina__name']

@admin.register(Scope1Record)
class Scope1RecordAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'date', 'source', 'fuel_type', 'quantity', 'unit', 'co2e_kg']
    readonly_fields = ['unit', 'co2e_kg']   # computed on save

@admin.register(WasteLog)
class WasteLogAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'date', 'category', 'quantity', 'unit', 'disposal_method']
    readonly_fields = ['unit']   # computed on save

@admin.register(SustainabilityLedger)
class SustainabilityLedgerAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'period', 'total_co2e_kg', 'is_stale', 'computed_at']
    readonly_fields = ['total_co2e_kg', 'computed_at']

@admin.register(ESGReportArchive)
class ESGReportArchiveAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'period_from', 'period_to', 'framework', 'status', 'generated_at']
    readonly_fields = ['status', 'pdf_file', 'celery_task_id', 'error_detail', 'generated_at']

@admin.register(OffsetContribution)
class OffsetContributionAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'partner', 'amount_gbp', 'pig_contribution_id', 'synced_at', 'created_at']

# Also register: GridCarbonIntensity, Scope2Record, Scope3Record, PlayItGreenSync
```

---

## Settings & URL Wiring

### `config/settings/base.py`

```python
LOCAL_APPS = [
    ...
    'apps.sustainability',
]

# Celery beat schedule additions (add to existing CELERY_BEAT_SCHEDULE dict)
CELERY_BEAT_SCHEDULE = {
    ...
    'fetch-grid-intensity': {
        'task':     'sustainability.fetch_grid_intensity',
        'schedule': crontab(hour=2, minute=0),   # daily at 02:00 UTC
    },
    'calculate-scope3-fuel-dock': {
        'task':     'sustainability.calculate_scope3_fuel_dock',
        'schedule': crontab(day_of_month=1, hour=3, minute=0),  # monthly
    },
    'roll-sustainability-ledger': {
        'task':     'sustainability.roll_sustainability_ledger',
        'schedule': crontab(hour=4, minute=0),   # nightly at 04:00 UTC
    },
    'sync-play-it-green': {
        'task':     'sustainability.sync_play_it_green',
        'schedule': crontab(day_of_week=0, hour=5, minute=0),  # weekly Sunday 05:00 UTC
    },
}

# ESG PDF dedicated worker queue
CELERY_TASK_ROUTES = {
    'sustainability.generate_esg_report_async': {'queue': 'pdf_generation'},
}
```

### `config/urls.py`

```python
path('api/v1/sustainability/', include('apps.sustainability.urls')),
```

### `apps/sustainability/urls.py`

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'emission-factors',      views.EmissionFactorViewSet,       basename='emissionfactor')
router.register(r'scope1',                views.Scope1RecordViewSet,          basename='scope1record')
router.register(r'scope2',                views.Scope2RecordViewSet,          basename='scope2record')
router.register(r'scope3',                views.Scope3RecordViewSet,          basename='scope3record')
router.register(r'waste-log',             views.WasteLogViewSet,              basename='wastelog')
router.register(r'ledger',                views.SustainabilityLedgerViewSet,  basename='sustainabilityledger')
router.register(r'esg-report',            views.ESGReportArchiveViewSet,      basename='esgreportarchive')
router.register(r'offset-contributions',  views.OffsetContributionViewSet,    basename='offsetcontribution')
router.register(r'grid-intensity',        views.GridCarbonIntensityViewSet,   basename='gridcarbonintensity')

urlpatterns = [path('', include(router.urls))]
```

---

## Management Command: `seed_emission_factors`

`management/commands/seed_emission_factors.py` — run once at setup; safe to re-run (upserts on `energy_type + jurisdiction + valid_from`).

Seed these factors (DEFRA 2023 / EPA 2022 values):

| Energy Type | Unit | kgCO₂e/unit | Jurisdiction | Source |
|---|---|---|---|---|
| diesel | litre | 2.51823 | UK | DEFRA |
| petrol | litre | 2.31370 | UK | DEFRA |
| lpg | kg | 1.55540 | UK | DEFRA |
| natural_gas | kwh | 0.18254 | UK | DEFRA |
| electricity | kwh | 0.23314 | UK | DEFRA |
| hvo | litre | 0.19500 | UK | DEFRA |
| diesel | litre | 2.67600 | US | EPA eGRID |
| petrol | litre | 2.34700 | US | EPA eGRID |
| electricity | kwh | 0.38600 | US | EPA eGRID |

Use `update_or_create(marina=marina, energy_type=et, jurisdiction=j, valid_from=valid_from, defaults={...})`.

---

## Migration Notes

### Migration 0001 — initial models

One migration for all 10 models. Check for cross-app FK availability:
- `accounts.Marina` — exists
- `billing.InvoiceLineItem` — exists (as `billing.InvoiceLineItem`)
- `reservations.Booking` — must exist
- `staff.StaffMember` — exists
- `fuel_dock.FuelDockEntry.is_internal_use` — must be added in a preceding fuel_dock migration

### Migration 0002 — seed emission factors

Data migration calling `seed_emission_factors` logic for the default marina(s) or as a bootstrap step. In production: run `manage.py seed_emission_factors` after deploying.

---

## Implementation Order (Numbered Steps)

Execute in this order. Do not reorder.

**Step 1 — Prerequisite: `fuel_dock.FuelDockEntry.is_internal_use`**
- File: `apps/fuel_dock/models.py` — add `is_internal_use = BooleanField(default=False)`.
- File: `apps/fuel_dock/admin.py` — expose field in FuelDockEntry admin.
- Run `makemigrations fuel_dock` and `migrate`.

**Step 2 — Create the `sustainability` Django app**
- `python manage.py startapp sustainability apps/sustainability`
- Create `apps/sustainability/apps.py` with `SustainabilityConfig` class (including `ready()` to import signals).
- Create directories: `management/commands/`, `templates/sustainability/`, `migrations/`.
- Add `'apps.sustainability'` to `LOCAL_APPS` in `config/settings/base.py`.

**Step 3 — Write all models**
- File: `apps/sustainability/models.py`
- Write models in the order defined above (respects FK dependencies).
- Confirm `is_mandatory_transient_fee` and `is_discountable` already exist on `ChargeableItem` (they do).

**Step 4 — Generate and run migrations**
- `python manage.py makemigrations sustainability`
- Inspect the migration — confirm FKs resolve.
- `python manage.py migrate sustainability`

**Step 5 — Write `calculations.py`**
- Pure functions: `calculate_scope1_co2e`, `calculate_scope2_co2e`, `calculate_scope3_fuel_sold`, `calculate_diversion_rate`, `get_grid_intensity_for_period`, `get_recognized_revenue_for_period`, `compute_ledger_row`.
- Write unit tests for each function **before** touching ORM layer.
- `get_recognized_revenue_for_period` must use the `DeferredRevenueRecognitionLog` guard as specified.

**Step 6 — Write management command `seed_emission_factors`**
- File: `management/commands/seed_emission_factors.py`
- Upserts DEFRA 2023 + EPA 2022 values per the table above.
- Run `python manage.py seed_emission_factors`.

**Step 7 — Write signals**
- File: `apps/sustainability/signals.py`
- Staleness signals on `Scope1Record`, `Scope2Record`, `Scope3Record`, `WasteLog` (post_save + post_delete).
- `on_invoice_paid_create_offset` signal on `billing.Invoice`.
- Confirm `apps.py` `ready()` imports signals.

**Step 8 — Wire URLs**
- File: `apps/sustainability/urls.py` — create with router as shown.
- File: `config/urls.py` — add `path('api/v1/sustainability/', include('apps.sustainability.urls'))`.

**Step 9 — Write shared Scope 3 helper**
- File: `apps/sustainability/tasks.py`
- Write `calculate_scope3_fuel_dock_for_period(marina, period)` as a standalone helper function (not a task). This function is called by both Task 2 and Task 3 — extract it first to avoid duplication.

**Step 10 — Implement all Celery tasks**
- File: `apps/sustainability/tasks.py`
- Implement Tasks 1–7 as plain functions (no `@shared_task` decorator yet).
- `recalculate_ledger_period(marina_id, period)` — lightweight task for staleness signals.
- Add task registrations to `CELERY_BEAT_SCHEDULE` in `settings/base.py` (commented until Celery is fully wired).
- Add `CELERY_TASK_ROUTES` for `generate_esg_report_async` → `pdf_generation` queue.

**Step 11 — Write serializers**
- One serializer class per model.
- `WasteLogSerializer.to_internal_value()` must pop `unit` from input data.
- `SustainabilityLedgerSerializer` must add computed `_tco2e` fields (÷ 1000) and return `null` for intensity metrics when denominator is zero.
- `Scope1RecordSerializer.validate()` must reject client-supplied `co2e_kg`.
- `EmissionFactorViewSet.destroy()` must catch `ProtectedError` → return 409.

**Step 12 — Write ViewSets**
- File: `apps/sustainability/views.py`
- All ViewSets use `ESGFeatureGuardMixin`.
- `SustainabilityLedgerViewSet` — read-only except for `recalculate` `@action`.
- `ESGReportArchiveViewSet` — `generate`, `status`, `download`, `history` actions.
- `Scope2RecordViewSet` — `recalculate` `@action` with manual override guard.
- `WasteLogViewSet` — `diversion_rate` `@action`.

**Step 13 — Write admin**
- File: `apps/sustainability/admin.py`
- Register all models with `readonly_fields` on computed fields (`unit`, `co2e_kg`).

**Step 14 — Build WeasyPrint PDF template**
- Files: `templates/sustainability/esg_report.html`, `templates/sustainability/esg_report_gri_annex.html`
- `esg_report.html`: all nine sections as defined.
- `esg_report_gri_annex.html`: GRI disclosure index table (GRI Standard, disclosure number, title, report section).
- Use same CSS print layout as existing invoice template for consistency.
- Prior-year comparison table: always render both columns; show "Not available — module activated {date}" when no prior-year ledger.

**Step 15 — Write `pdf_report.py`**
- File: `apps/sustainability/pdf_report.py`
- Implement `generate_esg_report_pdf(archive)` calling WeasyPrint.
- TCFD framework raises `ValueError("TCFD framework not yet available")` — caught by the Celery task which sets `error_detail`.
- All exceptions propagate so the task sets `status='failed'` and `error_detail`.

**Step 16 — Write tests**

```
tests/test_calculations.py
    - test_scope1_lpg_uses_kg_not_litres
    - test_scope1_missing_factor_raises_validation_error
    - test_scope2_fallback_hierarchy_static_mode
    - test_scope2_fallback_hierarchy_live_mode
    - test_scope2_manual_override_wins_over_api_feed
    - test_diversion_rate_zero_waste_returns_zero
    - test_recognized_revenue_deferred_log_available
    - test_recognized_revenue_fallback_when_track4_not_installed
    - test_ledger_roll_no_revenue_sets_intensity_to_null

tests/test_signals.py
    - test_scope2_record_save_flags_ledger_stale
    - test_staleness_signal_deduplication_within_60s
    - test_on_commit_means_signal_fires_after_transaction

tests/test_tasks.py
    - test_scope3_excludes_internal_use_fuel_entries
    - test_scope3_null_actual_litres_excluded_from_aggregation
    - test_ledger_roll_is_idempotent_for_same_period
    - test_ledger_roll_scope3_reaggregated_before_stamping
    - test_scope2_manual_override_not_overwritten_by_nightly_task

tests/test_waste.py
    - test_waste_unit_enforced_from_category_bilge_oil_is_litres
    - test_waste_unit_enforced_from_category_general_is_kg
    - test_waste_client_supplied_unit_silently_discarded

tests/test_offset.py
    - test_offset_zero_price_guard_no_contribution_created
    - test_offset_full_price_creates_contribution
    - test_offset_coupon_discount_blocked_by_is_discountable_false

tests/test_esg_report.py
    - test_generate_tcfd_returns_400
    - test_generate_creates_archive_record_status_pending
    - test_generate_task_sets_status_ready_on_success
    - test_generate_task_sets_status_failed_and_error_detail_on_failure
    - test_generate_task_routed_to_pdf_generation_queue
    - test_missing_scope_data_renders_no_data_notice_not_crash

tests/test_emission_factors.py
    - test_delete_referenced_factor_returns_409
    - test_delete_unreferenced_factor_succeeds

tests/test_pig_sync.py
    - test_pig_sync_skips_when_no_api_key
    - test_pig_sync_5xx_retry_three_times
    - test_pig_sync_4xx_marks_failed_no_retry
```

**Step 17 — Add `esg_enabled` sidebar nav**

Frontend reference only — add "ESG & Sustainability" top-level sidebar group gated by `marina.features.esg_enabled`. Route: `/sustainability`. Seven React Query hooks as listed in spec Section 9.4.

**Step 18 — Carbon offset booking widget**

Frontend reference only — add conditional offset section to existing booking checkout component. Reads offset `ChargeableItem` from service catalog. Checks `is_mandatory_transient_fee`: if True, renders read-only line; if False, renders opt-in checkbox. Update billing app refund logic to exclude offset `InvoiceLineItem` from refund totals.

---

## Critical Rules for Developers

1. **Never aggregate `Invoice.total` directly for intensity metrics.** Always call `get_recognized_revenue_for_period()`.
2. **Always call `calculate_scope3_fuel_dock_for_period()` before `compute_ledger_row()`** — both in the nightly task and the recalculate API endpoint.
3. **`WasteLog.unit` is never set by the client.** Pop it in `WasteLogSerializer.to_internal_value()`.
4. **ESG PDF task must route to `pdf_generation` queue.** Never route it to the default Celery queue.
5. **Offset `ChargeableItem.is_discountable` must always be `False`.** Enforce at creation UI level. The coupon and loyalty engines must exclude `is_discountable=False` line items from their discount base.
6. **`OffsetContribution` is not created when `line.unit_price <= 0`.** The signal guard is the last defence; enforce `is_discountable=False` upstream.
7. **`Scope2Record` with `data_source='manual'` is never overwritten by the nightly task.** Check before running auto-aggregation.
