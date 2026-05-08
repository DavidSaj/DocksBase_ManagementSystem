# Track 12 — Sustainability & ESG: Design Spec
> Spec status: Final — reviewed 2026-05-08
Date: 2026-05-07
Scope: New `sustainability` Django app covering Scope 1/2/3 emissions tracking, waste & disposal logging, monthly sustainability ledger, ESG board report PDF (GRI-aligned), carbon offset at booking (Play It Green integration), and a full sustainability dashboard surfaced as a new top-level sidebar item.

---

## 1. Architectural Goal

The sustainability module adds a calculation and reporting layer on top of existing data sources — it reads from `FuelDockEntry`, `Invoice`, `Booking`, and (eventually) a utility consumption model, but it never writes back to those apps. All emissions maths, waste logging, and ESG disclosure live in the new `sustainability` app.

The module is gated by a `marina.features` flag: `esg_enabled`. Marinas without this flag see nothing — no sidebar item, no API routes, no background jobs running.

Three auto-calculation pipelines:
- **Scope 1**: driven by manually entered fuel purchase records → `Scope1Record` rows created on save.
- **Scope 2**: driven by electricity consumption from the utility module × a `GridCarbonIntensity` factor; updated nightly by a Celery beat task.
- **Scope 3**: fuel sold to vessels read directly from `FuelDockEntry.actual_litres` + supplier delivery records from AP purchase lines tagged as deliveries; supplemented by manual entry.

A monthly Celery task rolls all three scope totals, plus intensity denominators (revenue from `Invoice`, berth-nights from `Booking`), into a `SustainabilityLedger` row. This is the single source for the dashboard and ESG report.

PDF generation uses WeasyPrint (already installed for invoices). ESG report templates follow the same HTML-to-PDF pipeline already in use.

---

## 2. New Django App: `sustainability`

### Location

```
backend/apps/sustainability/
    __init__.py
    models.py
    serializers.py
    views.py
    urls.py
    admin.py
    tasks.py           # Celery tasks (ledger roll-up, grid intensity fetch, PIG sync)
    calculations.py    # Pure-function emissions logic, no ORM
    pdf_report.py      # WeasyPrint ESG report builder
    templates/
        sustainability/
            esg_report.html
            esg_report_gri_annex.html
```

### Registration

Add `'apps.sustainability'` to `INSTALLED_APPS`. Add URL include to `backend/urls.py`:

```python
path('api/v1/sustainability/', include('apps.sustainability.urls')),
```

Add feature-flag guard to the URL include (or enforce at the ViewSet level via a permission class that checks `request.marina.features.get('esg_enabled', False)`).

---

## 3. Data Models

All models carry `marina = ForeignKey('accounts.Marina', on_delete=models.CASCADE)` and are excluded from queries when `esg_enabled` is False.

### 3.1 `EmissionFactor`

Master reference table for conversion coefficients. Seeded from DEFRA (UK) and EPA (US) published values; also updated from the grid API for Scope 2. The annual static DEFRA/EPA values in this table serve as the default grid intensity source (tier 3 in the fallback hierarchy — see Section 4).

```python
class EmissionFactor(models.Model):
    class EnergyType(models.TextChoices):
        DIESEL        = 'diesel',        'Diesel'
        PETROL        = 'petrol',        'Petrol'
        LPG           = 'lpg',           'LPG'
        NATURAL_GAS   = 'natural_gas',   'Natural Gas'
        ELECTRICITY   = 'electricity',   'Grid Electricity'
        HVO           = 'hvo',           'HVO (Hydrotreated Vegetable Oil)'

    class UnitType(models.TextChoices):
        LITRE = 'litre', 'Litre'
        KWH   = 'kwh',   'kWh'
        KG    = 'kg',    'kg'
        TKM   = 'tkm',   'Tonne-kilometre (freight / GHG Protocol Cat. 4)'
        GBP   = 'gbp',   'GBP (spend-based method)'
        USD   = 'usd',   'USD (spend-based method)'
        EUR   = 'eur',   'EUR (spend-based method)'

    class Source(models.TextChoices):
        DEFRA      = 'defra',      'DEFRA (UK)'
        EPA_EGRID  = 'epa_egrid',  'EPA eGRID (US)'
        GRID_API   = 'grid_api',   'National Grid ESO API (live)'
        MANUAL     = 'manual',     'Manual (admin override)'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='emission_factors')
    energy_type    = models.CharField(max_length=20, choices=EnergyType.choices)
    kg_co2e_per_unit = models.DecimalField(max_digits=10, decimal_places=6)
    unit           = models.CharField(max_length=10, choices=UnitType.choices)
    jurisdiction   = models.CharField(max_length=10, blank=True)  # 'UK', 'US', grid region code
    valid_from     = models.DateField()
    valid_to       = models.DateField(null=True, blank=True)       # null = currently active
    source         = models.CharField(max_length=20, choices=Source.choices, default=Source.DEFRA)
    source_url     = models.URLField(blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['energy_type', '-valid_from']
        # Only one active factor per marina + energy_type at a time (enforced in save logic)
```

There is a separate `GridCarbonIntensity` model (Section 4) for the live grid intensity feed.

### 3.2 `Scope1Record`

Direct emissions from fuel combustion under marina control: vehicles, workboats, generators, machinery. Records are created manually via the Scope 1 data entry screen.

```python
class Scope1Record(models.Model):
    class Source(models.TextChoices):
        VEHICLE_FUEL   = 'vehicle_fuel',   'Marina Vehicle'
        WORKBOAT_FUEL  = 'workboat_fuel',  'Workboat / Launch'
        GENERATOR      = 'generator',      'Generator'
        MACHINERY      = 'machinery',      'Machinery / Equipment'
        MANUAL         = 'manual',         'Manual Entry'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='scope1_records')
    source          = models.CharField(max_length=20, choices=Source.choices)
    fuel_type       = models.CharField(max_length=20, choices=EmissionFactor.EnergyType.choices)
    quantity        = models.DecimalField(max_digits=10, decimal_places=3)
    # Derived from the linked EmissionFactor.unit on save — read-only, never set by client.
    # Ensures full audit traceability: 50 kg of LPG is stored as 50, unit='kg', not coerced to litres.
    unit            = models.CharField(max_length=10, editable=False,
                                       choices=EmissionFactor.UnitType.choices)
    date            = models.DateField()
    emission_factor = models.ForeignKey(EmissionFactor, on_delete=models.PROTECT, related_name='scope1_records')
    co2e_kg         = models.DecimalField(max_digits=12, decimal_places=4)   # calculated on save
    notes           = models.CharField(max_length=500, blank=True)
    # Free-text audit field only — not linked to any automated AP signal
    ap_reference    = models.CharField(max_length=100, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        # Derive unit from the emission factor before calculating co2e.
        # This prevents the quantity_litres trap: LPG is measured in kg, natural gas in kWh.
        self.unit = self.emission_factor.unit
        self.co2e_kg = calculate_scope1_co2e(self.quantity, self.emission_factor.kg_co2e_per_unit)
        super().save(*args, **kwargs)
```

**AP integration note:** AP module auto-tagging is explicitly out of scope for this track and has no committed timeline. The manual entry flow is the permanent v1 interface. The `ap_reference` field is retained as a free-text audit field only — harbour masters may enter an AP reference number for their own records, but no automated signal reads or writes it.

### 3.3 `GridCarbonIntensity`

Time-series of grid carbon intensity values, updated by a nightly Celery task when live grid intensity mode is enabled. Separate from `EmissionFactor` because it changes frequently.

```python
class GridCarbonIntensity(models.Model):
    class GridSource(models.TextChoices):
        NATIONAL_GRID_ESO = 'ng_eso',  'National Grid ESO (UK)'
        EPA_EGRID         = 'epa',     'EPA eGRID (US)'
        MANUAL            = 'manual',  'Manual Override'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='grid_intensities')
    grid_source   = models.CharField(max_length=20, choices=GridSource.choices)
    region_code   = models.CharField(max_length=20, blank=True)  # e.g. 'GB', 'NYISO', 'WECC'
    valid_date    = models.DateField(db_index=True)
    kg_co2e_per_kwh = models.DecimalField(max_digits=8, decimal_places=6)
    is_manual_override = models.BooleanField(default=False)
    fetched_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-valid_date']
        unique_together = [('marina', 'valid_date')]  # one value per marina per day
```

### 3.4 `Scope2Record`

Indirect emissions from purchased electricity. One record per billing period (month), computed from utility module data × the applicable `GridCarbonIntensity` entry.

```python
class Scope2Record(models.Model):
    class DataSource(models.TextChoices):
        UTILITY_MODULE = 'utility',  'Utility Module (auto)'
        MANUAL         = 'manual',   'Manual Entry'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='scope2_records')
    period              = models.CharField(max_length=7, db_index=True)   # 'YYYY-MM'
    kwh_consumed        = models.DecimalField(max_digits=12, decimal_places=3)
    grid_intensity      = models.ForeignKey(GridCarbonIntensity, on_delete=models.PROTECT,
                                            null=True, blank=True)          # null if manual
    kg_co2e_per_kwh_used = models.DecimalField(max_digits=8, decimal_places=6)  # snapshot at calc time
    co2e_kg             = models.DecimalField(max_digits=12, decimal_places=4)
    data_source         = models.CharField(max_length=20, choices=DataSource.choices,
                                           default=DataSource.UTILITY_MODULE)
    notes               = models.CharField(max_length=500, blank=True)
    calculated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'period')]
```

### 3.5 `Scope3Record`

Value-chain emissions. Categories are split between auto-populated (fuel sold to vessels) and manually entered (supplier deliveries, staff commute if opted in).

```python
class Scope3Record(models.Model):
    class Category(models.TextChoices):
        FUEL_SOLD_VESSELS  = 'fuel_sold_vessels',  'Fuel Sold to Vessels (fuel dock)'
        SUPPLIER_DELIVERY  = 'supplier_delivery',  'Supplier Deliveries'
        STAFF_COMMUTE      = 'staff_commute',       'Staff Commute (optional)'
        OTHER              = 'other',               'Other (manual)'

    class DataSource(models.TextChoices):
        FUEL_DOCK_AUTO = 'fuel_dock_auto', 'Fuel Dock (auto-calculated)'
        MANUAL         = 'manual',         'Manual Entry'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='scope3_records')
    period          = models.CharField(max_length=7, db_index=True)  # 'YYYY-MM'
    category        = models.CharField(max_length=30, choices=Category.choices)
    # Required for fuel_sold_vessels rows to discriminate by fuel type (diesel vs petrol).
    # Blank for manual categories (supplier_delivery, staff_commute, other).
    fuel_type       = models.CharField(max_length=20, blank=True,
                                       choices=EmissionFactor.EnergyType.choices)
    quantity        = models.DecimalField(max_digits=12, decimal_places=3)
    unit            = models.CharField(max_length=10, choices=EmissionFactor.UnitType.choices)
    emission_factor = models.ForeignKey(EmissionFactor, on_delete=models.PROTECT,
                                        null=True, blank=True)
    co2e_kg         = models.DecimalField(max_digits=12, decimal_places=4)
    data_source     = models.CharField(max_length=20, choices=DataSource.choices,
                                       default=DataSource.MANUAL)
    source_reference = models.CharField(max_length=100, blank=True)
    # GHG Protocol Category 4 (upstream freight): capture distance and spend for tkm/spend-based methods.
    # Both are optional and only relevant when unit = 'tkm' or a currency unit.
    distance_km     = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    spend_amount    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    notes           = models.CharField(max_length=500, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        # Prevents duplicate rows when the recalculate endpoint is hit multiple times.
        # The aggregation task must use update_or_create against this constraint.
        unique_together = [('marina', 'period', 'category', 'fuel_type')]
```

### 3.6 `WasteLog`

Point-in-time disposal events. No calculation — waste is tracked by weight/volume and disposal method for reporting and diversion rate metrics.

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
        LANDFILL         = 'landfill',          'Landfill'
        RECYCLED         = 'recycled',           'Recycled'
        COMPOSTED        = 'composted',          'Composted'
        SPECIALIST       = 'specialist',         'Specialist Disposal (licensed carrier)'
        INCINERATED      = 'incinerated',        'Incinerated (energy recovery)'
        RETURNED_SUPPLIER = 'returned_supplier', 'Returned to Supplier'

    # Unit is derived automatically from category — see CATEGORY_UNIT_MAP and save() below.
    # Solid waste (General, Recycling, Hazardous, Antifouling) → kg
    # Liquid waste (Bilge Oil, Pump-out) → litres
    CATEGORY_UNIT_MAP = {
        'general':     'kg',
        'recycling':   'kg',
        'hazardous':   'kg',
        'antifouling': 'kg',
        'bilge_oil':   'litres',
        'pump_out':    'litres',
    }

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='waste_logs')
    date            = models.DateField()
    category        = models.CharField(max_length=20, choices=Category.choices)
    quantity        = models.DecimalField(max_digits=10, decimal_places=3)
    unit            = models.CharField(max_length=10, editable=False,
                                       choices=[('kg', 'kg'), ('litres', 'litres')])
    # Set automatically based on category. Cannot be set by the client.
    disposal_method = models.CharField(max_length=30, choices=DisposalMethod.choices)
    waste_carrier   = models.CharField(max_length=200, blank=True)  # name of licensed contractor
    carrier_licence_ref = models.CharField(max_length=100, blank=True)
    disposal_note   = models.CharField(max_length=500, blank=True)
    logged_by       = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL,
                                        null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        # Enforce unit from category — client-supplied unit values are ignored.
        self.unit = self.CATEGORY_UNIT_MAP.get(self.category, 'kg')
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['-date']
```

**Unit enforcement note:** The `unit` field is derived automatically from the `category` on every save and is read-only in the API. Clients cannot pass a `unit` value — it is rejected at the serializer `validate()` level. This ensures waste totals aggregate cleanly without density conversion. Solid waste categories (General, Recycling, Hazardous, Antifouling) always use kg. Liquid waste categories (Bilge Oil, Pump-out) always use litres.

**Landfill diversion logic (no stored field):** Computed on-the-fly as:
`diverted = sum(quantity) where disposal_method IN ('recycled', 'composted', 'specialist', 'incinerated', 'returned_supplier')` ÷ `total_quantity` × 100. This is a query annotation, not a stored column.

### 3.7 `SustainabilityLedger`

Monthly roll-up. Written by the Celery beat task. Read-only from the API. If a month has no data, no row exists (do not write zero rows speculatively).

```python
class SustainabilityLedger(models.Model):
    marina                 = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                               related_name='sustainability_ledger')
    period                 = models.CharField(max_length=7, db_index=True)  # 'YYYY-MM'

    # Scope totals (all in kgCO₂e — converted to tCO₂e in the API serializer)
    scope1_co2e_kg         = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    scope2_co2e_kg         = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    scope3_co2e_kg         = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_co2e_kg          = models.DecimalField(max_digits=14, decimal_places=4, default=0)

    # Denominators (from Invoice and Booking aggregations)
    revenue_gbp            = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    berth_nights           = models.PositiveIntegerField(default=0)

    # Intensity metrics (stored for reporting speed; recomputed on ledger write)
    co2e_kg_per_gbp_revenue  = models.DecimalField(max_digits=12, decimal_places=6, null=True)
    co2e_kg_per_berth_night  = models.DecimalField(max_digits=12, decimal_places=4, null=True)

    # Offset
    offset_co2e_kg         = models.DecimalField(max_digits=12, decimal_places=4, default=0)

    computed_at            = models.DateTimeField(auto_now=True)

    # Staleness flag — set to True by post_save/post_delete signals on Scope1Record,
    # Scope2Record, Scope3Record, and WasteLog whenever a historical record is modified.
    # The nightly roll_sustainability_ledger task checks this flag and prioritises
    # re-computing stale periods. The recalculate API endpoint always clears this flag.
    # When is_stale=True, the dashboard renders a "Data updated — recalculating..." badge
    # on the affected period row so the harbour master knows the displayed value is pending.
    is_stale               = models.BooleanField(default=False)

    class Meta:
        unique_together = [('marina', 'period')]
        ordering = ['-period']
```

**Staleness signal pattern** (`sustainability/signals.py`):

```python
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.db import transaction

def _flag_ledger_stale_and_queue(marina_id: int, period: str):
    """
    Mark the SustainabilityLedger row for this period as stale and dispatch
    a targeted recalculation task. If no ledger row exists yet, skip the flag
    (the nightly roll will create it). Using on_commit ensures the signal does
    not fire before the triggering DB write is fully committed.

    Deduplication: if 10 meter readings are saved in rapid succession, 10 signals
    fire and 10 tasks would be queued — only one recalculation is needed. A Redis
    cache key with a 60-second TTL deduplicates within that window. The first
    signal wins; subsequent signals within the 60-second window are silently dropped.
    The task itself runs with a 30-second countdown so the cache key is still live
    when the task executes, preventing a second dispatch from slipping through
    between the cache set and the task execution.
    """
    def _do():
        from django.core.cache import cache
        from sustainability.tasks import recalculate_ledger_period

        DEDUPE_KEY = f'ledger:recalc:{marina_id}:{period}'
        if not cache.add(DEDUPE_KEY, '1', timeout=60):
            return  # already queued within the last 60 seconds — skip duplicate dispatch

        SustainabilityLedger.objects.filter(
            marina_id=marina_id, period=period
        ).update(is_stale=True)
        recalculate_ledger_period.apply_async(
            args=[marina_id, period],
            countdown=30,  # brief debounce: batch rapid consecutive edits
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

`recalculate_ledger_period` is a new lightweight Celery task that calls `compute_ledger_row(marina_id, period)` and upserts the ledger row, clearing `is_stale=False` on completion. This means a harbour master entering a delayed September utility bill for January will cause the January ledger row to be automatically recalculated within ~30 seconds, without any manual API call. The Annual ESG Report will always be consistent with the sub-ledgers.

### 3.8 `OffsetContribution`

Records each carbon offset contribution attached to a booking. The `ChargeableItem` for the offset is created by the admin in the Service Catalog (category `booking_fee`, pricing_model `per_night`, name e.g. "Carbon Offset — per night"). The `InvoiceLineItem` is created normally. This model is the supplementary sustainability-side record that tracks what was purchased and the certificate result.

The offset `ChargeableItem` carries an `is_mandatory_transient_fee` flag (see billing migration in Section 11). When `is_mandatory_transient_fee = True` on the offset `ChargeableItem`, the offset line item is added automatically to every transient booking invoice — no checkbox is shown. When `is_mandatory_transient_fee = False` (default), the per-booking opt-in checkbox UX applies (see Section 9.3).

**CRITICAL — Discount protection:** The offset `ChargeableItem` **must always be created with `is_discountable = False`**. This is enforced in two places:

1. The admin/settings UI that creates the offset `ChargeableItem` hardcodes `is_discountable=False` and does not expose a toggle for it. The field is read-only for offset-category items.
2. The `CouponCode` application logic (Track 7) and the loyalty point redemption engine (Track 3) must exclude `InvoiceLineItem` records where `chargeable_item.is_discountable = False` from their discount/reduction scope. Global "X% off total" coupons must sum only the discountable line items as their base — never the full invoice total.

**Guard at `OffsetContribution` creation time:** The `Invoice.status → paid` signal that creates the `OffsetContribution` row must validate that the `InvoiceLineItem.unit_price` is greater than zero before creating the contribution or dispatching it to Play It Green:

```python
@receiver(post_save, sender=Invoice)
def on_invoice_paid(sender, instance, **kwargs):
    if instance.status != 'paid':
        return
    for line in instance.line_items.filter(chargeable_item__category='offset'):
        if line.unit_price <= 0:
            # Coupon, loyalty redemption, or manual override zeroed this line.
            # Do NOT create an OffsetContribution — the marina would pay PIG with its own cash
            # for an offset the boater received for free.
            logger.warning(
                "Offset line item %s has zero unit_price on paid Invoice %s — "
                "OffsetContribution NOT created. Investigate discount/coupon application.",
                line.pk, instance.pk,
            )
            continue
        transaction.on_commit(lambda lid=line.pk: create_offset_contribution.delay(lid))
```

This guard is the last line of defence. The `is_discountable=False` protection prevents the zero reaching here in normal operation; this signal guard catches any edge case where a manual price override or admin action zeroed the line regardless.

```python
class OffsetContribution(models.Model):
    class Partner(models.TextChoices):
        PLAY_IT_GREEN = 'play_it_green', 'Play It Green'
        MANUAL        = 'manual',        'Manual / Other'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                         related_name='offset_contributions')
    booking          = models.ForeignKey('reservations.Booking', on_delete=models.SET_NULL,
                                         null=True, blank=True, related_name='offset_contributions')
    invoice_line_item = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL,
                                           null=True, blank=True)
    partner          = models.CharField(max_length=20, choices=Partner.choices,
                                        default=Partner.PLAY_IT_GREEN)
    # amount_gbp is what is remitted to Play It Green — always GBP regardless of marina currency.
    # If the marina bills in a non-GBP currency, the conversion uses Track 4's ExchangeRate engine
    # at the moment the OffsetContribution is created (invoice payment signal).
    amount_gbp       = models.DecimalField(max_digits=10, decimal_places=2)
    # The original amount in the marina's local billing currency — for P&L reconciliation.
    local_currency_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    local_currency_code   = models.CharField(max_length=3, blank=True)  # e.g. 'USD', 'EUR', 'GBP'
    exchange_rate_used    = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    # Play It Green returns unit types: 'fronds' (sea kelp), 'trees', 'credits'
    units_purchased  = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    unit_type        = models.CharField(max_length=50, blank=True)   # 'fronds', 'trees', etc.
    certificate_url  = models.URLField(blank=True)
    pig_contribution_id = models.CharField(max_length=100, blank=True)  # Play It Green's own ID
    # CO₂e equivalent of the offset (populated from PIG API response or admin override)
    co2e_offset_kg   = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True)
    synced_at        = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
```

### 3.9 `ESGReportArchive`

Persistent record of every generated ESG report PDF. The Celery task writes here instead of relying on ephemeral Redis result state (Celery results expire after 24 hours by default — using them as a report history would produce 404s on any download link older than one day).

```python
class ESGReportArchive(models.Model):
    class Framework(models.TextChoices):
        GRI       = 'gri',       'GRI Standards'
        NARRATIVE = 'narrative', 'Narrative Only'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        READY   = 'ready',   'Ready'
        FAILED  = 'failed',  'Failed'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                     related_name='esg_report_archive')
    period_from  = models.CharField(max_length=7)   # 'YYYY-MM'
    period_to    = models.CharField(max_length=7)   # 'YYYY-MM'
    framework    = models.CharField(max_length=20, choices=Framework.choices)
    status       = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    pdf_file     = models.FileField(upload_to='esg_reports/%Y/%m/', blank=True)
    celery_task_id = models.CharField(max_length=255, blank=True)  # for in-progress polling only
    error_detail = models.CharField(max_length=500, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    generated_by = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL,
                                     null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

The `generate_esg_report_async` Celery task receives the `ESGReportArchive.pk`, generates the PDF, saves it to `pdf_file`, and sets `status = 'ready'` and `generated_at = now()`. The status endpoint queries this model — not Redis. Once `status = 'ready'`, the download URL is derived from `pdf_file.url` (S3 or local media). Celery task state in Redis is used only while the task is actively running; it is never the source of truth for historical reports.

### 3.10 `PlayItGreenSync`

Log of each push/pull cycle with the Play It Green API. Provides an audit trail and retry visibility.

```python
class PlayItGreenSync(models.Model):
    class Direction(models.TextChoices):
        PUSH = 'push', 'Push (contributions sent)'
        PULL = 'pull', 'Pull (certificates retrieved)'

    class Status(models.TextChoices):
        SUCCESS = 'success', 'Success'
        FAILED  = 'failed',  'Failed'
        PARTIAL = 'partial', 'Partial'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                      related_name='pig_syncs')
    direction     = models.CharField(max_length=10, choices=Direction.choices)
    status        = models.CharField(max_length=10, choices=Status.choices)
    records_count = models.PositiveIntegerField(default=0)
    total_gbp     = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    response_body = models.TextField(blank=True)   # raw JSON response, truncated at 10 000 chars
    error_detail  = models.CharField(max_length=500, blank=True)
    synced_at     = models.DateTimeField(auto_now_add=True)
```

---

## 4. Grid Carbon Intensity Integration

**Default mode: Annual Static.** By default, all Scope 2 calculations use the annual static DEFRA/EPA emission factors from the `EmissionFactor` table (seeded via `manage.py seed_emission_factors`). This is the GRI/TCFD-auditable default — annual national averages are stable, reproducible, and accepted by statutory auditors.

**Live API mode (Experimental):** The National Grid ESO API integration is built and retained in the codebase but is disabled by default. A marina can opt into live daily grid intensity data via a Settings toggle (see Mode Toggle subsection below and Section 9.2 Settings sub-tab). The `fetch_grid_intensity` Celery task only runs for marinas that have `live_grid_intensity_enabled = True` in their feature flags.

### Mode Toggle

A marina-level feature flag `live_grid_intensity_enabled` (stored in `marina.features`) controls which mode is active:

- `False` (default): Scope 2 uses the annual static `EmissionFactor` for grid electricity. The `fetch_grid_intensity` task does not run for this marina. No `GridCarbonIntensity` rows are written.
- `True`: The nightly `fetch_grid_intensity` task is activated for this marina. `GridCarbonIntensity` rows are written daily and are used in Scope 2 calculations according to the fallback hierarchy below.

The toggle is exposed in the Settings screen as: "Grid Intensity Mode — Annual Static (default, auditable) / Live API (experimental, more accurate)."

### Data Sources

| Marina Jurisdiction | Source | URL |
|---|---|---|
| UK | National Grid ESO Carbon Intensity API v2 | `https://api.carbonintensity.org.uk/intensity` |
| US | EPA eGRID (annual release, downloaded as static JSON) | `https://www.epa.gov/egrid/download-data` |
| Manual override | Admin sets `GridCarbonIntensity.is_manual_override = True` | n/a |

### UK: National Grid ESO API

The ESO Carbon Intensity API is free, unauthenticated, and returns a 30-minute rolling intensity forecast plus the actual intensity for the past 24 hours. The daily task fetches:

```
GET https://api.carbonintensity.org.uk/intensity/date/{YYYY-MM-DD}
```

Returns `data[].intensity.actual` in gCO₂/kWh. The task takes the daily average of all 30-minute slots, converts to kgCO₂/kWh (÷ 1000), and writes one `GridCarbonIntensity` row with `valid_date = yesterday` (yesterday's actuals are fully settled; today's forecast is not final).

### US: EPA eGRID

eGRID is an annual static dataset. The task downloads the JSON for the current year's sub-region emission rate file and parses the `CO2RTA` column (lb CO₂/MWh), converting to kgCO₂/kWh (× 0.000453592). The marina's `region_code` field (set during onboarding) maps to the eGRID sub-region code.

### Fallback Hierarchy

When computing Scope 2 emissions for a given period, the lookup order is:

1. `GridCarbonIntensity` row for the marina with `is_manual_override = True` and `valid_date` within the period — use it as-is.
2. Most recent `GridCarbonIntensity` row for the marina with `valid_date <= period_end` from the live API feed (only populated when `live_grid_intensity_enabled = True`).
3. The marina's jurisdiction default from `EmissionFactor` (the annual static DEFRA / EPA value in the emission factor library). **This is the effective default for all marinas in static mode.**
4. Hard-coded fallback constant: UK = 0.23314 kgCO₂e/kWh (DEFRA 2023 grid average); US = 0.386 kgCO₂e/kWh (EPA eGRID national average 2022).

Log which fallback was used in `Scope2Record.notes`. Never silently produce a zero.

### Polling Schedule

```python
# In tasks.py — registered as a Celery beat periodic task
# Runs daily at 02:00 UTC
# Only executes for marinas where marina.features.get('live_grid_intensity_enabled') is True
@app.task(name='sustainability.fetch_grid_intensity')
def fetch_grid_intensity():
    ...
```

The task runs per-marina (each active marina with live mode enabled calls the API for its jurisdiction). Rate-limit: the ESO API allows unlimited requests but the task adds a 1-second sleep between marina calls as courtesy.

### Admin Override

In the Django admin (or future settings screen), a Harbour Master can set a manual override intensity by creating a `GridCarbonIntensity` row with `is_manual_override = True`. The system uses this value instead of the API value for all Scope 2 computations going forward, until the override is deleted. Manual override takes precedence regardless of whether the marina is in static or live API mode.

---

## 5. Emissions Calculation Logic

All pure calculation functions live in `sustainability/calculations.py`. No ORM calls in this module — callers pass in the raw numbers, functions return results. This makes the logic unit-testable in isolation.

### Unit Conventions

| Quantity | Storage unit | Display unit | Conversion |
|---|---|---|---|
| Emission factor | kgCO₂e per unit (litre or kWh) | — | stored as entered |
| Scope record totals | kgCO₂e | tCO₂e (÷ 1000) | serializer converts for API |
| Ledger totals | kgCO₂e | tCO₂e (÷ 1000) | serializer converts for API |
| Intensity metrics | kgCO₂e per £ / per berth-night | displayed as-is | no conversion |

All stored values are kgCO₂e. The API serializer adds `_tco2e` computed fields that divide by 1000 and round to 3 decimal places. The frontend always displays tCO₂e for totals and kgCO₂e/£ or kgCO₂e/berth-night for intensity metrics.

### 5.1 Scope 1 Calculation

```python
def calculate_scope1_co2e(quantity: Decimal, kg_co2e_per_unit: Decimal) -> Decimal:
    """
    Returns kgCO₂e, rounded to 4 decimal places.
    quantity: fuel consumed in whatever unit the EmissionFactor uses (litre, kg, or kwh).
    kg_co2e_per_unit: from EmissionFactor.kg_co2e_per_unit — already in the correct unit.
    Do NOT assume litres. LPG is measured in kg; natural gas in kWh.
    """
    result = quantity * kg_co2e_per_unit
    return result.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
```

**Factor lookup:** When creating or saving a `Scope1Record`, the backend selects the `EmissionFactor` where:
- `marina = record.marina`
- `energy_type = record.fuel_type`
- `valid_from <= record.date`
- `valid_to IS NULL OR valid_to >= record.date`

Note: the `unit` filter (`'litre'`) is intentionally absent. The factor's unit is whatever DEFRA/EPA publishes for that fuel type (litres for diesel/petrol, kg for LPG, kWh for natural gas). The `Scope1Record.unit` field is set from `emission_factor.unit` in `save()`, providing a complete audit record of what physical measurement was used.

If zero factors match: reject the save with a `400` error: `"No emission factor found for {fuel_type} on {date}. Please add one in the Emission Factor Library."` Never produce a silent zero.

If multiple match (should not happen if the seed data is correct, but guards against it): use the row with the most recent `valid_from`.

### 5.2 Scope 2 Calculation

```python
def calculate_scope2_co2e(kwh_consumed: Decimal, kg_co2e_per_kwh: Decimal) -> Decimal:
    """
    Returns kgCO₂e, rounded to 4 decimal places.
    kwh_consumed: total kWh for the billing period (from utility module)
    kg_co2e_per_kwh: from GridCarbonIntensity (see fallback hierarchy, Section 4)
    """
    result = kwh_consumed * kg_co2e_per_kwh
    return result.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
```

**Missing utility data:** If the utility module has no electricity data for a period, `kwh_consumed = 0`. The `Scope2Record` is written with `co2e_kg = 0` and `notes = "No utility consumption data for this period."` The ledger roll-up includes the record but the zero is visible in the dashboard so the user knows data is absent rather than clean.

### 5.3 Scope 3 Calculation — Fuel Sold to Vessels

```python
def calculate_scope3_fuel_sold(
    actual_litres: Decimal,
    fuel_type: str,
    kg_co2e_per_unit: Decimal,
) -> Decimal:
    """
    Returns kgCO₂e for fuel sold to third-party vessels at the fuel dock.
    Only call with litres from FuelDockEntry rows where is_internal_use=False.
    Internal fuel (marina's own workboats, tractors) is already counted in Scope 1
    and must never appear here — counting it here would double-tax the marina.
    """
    return (actual_litres * kg_co2e_per_unit).quantize(
        Decimal('0.0001'), rounding=ROUND_HALF_UP
    )
```

The monthly Celery task aggregates completed `FuelDockEntry` rows for the period, groups by `fuel_type`, looks up each factor, sums the results, and writes a single `Scope3Record` per fuel type per period with `data_source = 'fuel_dock_auto'` and `source_reference = f"FuelDockEntry period={period} fuel_type={fuel_type}"`.

**Internal fuel exclusion (double-count prevention):** The aggregation query must filter `.filter(is_internal_use=False)`. When the harbour master fills up the marina's own workboat at their own fuel dock, `FuelDockEntry.is_internal_use` must be set to `True`. That fuel is already logged under Scope 1 (`source='workboat_fuel'`). Including it here would count it twice. If `FuelDockEntry` does not yet have an `is_internal_use` field, add it via a migration in the existing fuel dock app (`is_internal_use = BooleanField(default=False)`). This is a cross-app dependency — coordinate with the fuel dock app owner.

**Null `actual_litres`:** `FuelDockEntry.actual_litres` can be null (partially completed jobs). These rows are excluded from the Scope 3 aggregation. Include count of excluded rows in the `notes` field so the marina operator is aware.

### 5.4 Sustainability Ledger Roll-up

```python
def compute_ledger_row(marina_id: int, period: str) -> dict:
    """
    Aggregates scope totals, revenue, and berth-nights for the given period.
    Returns a dict of field values ready to upsert into SustainabilityLedger.
    Called by the Celery monthly task and by the 'Recalculate' API action.
    """
```

**Revenue denominator — recognized revenue only:**

Using `Invoice.total` directly produces catastrophic intensity distortions. An annual contract paid in full in January (€12,000) would register all €12,000 of revenue in January, making that month appear artificially green, and would cause divide-by-zero for February through December when no further invoices are raised.

The correct denominator is **economically recognized revenue** for the period:

```python
from billing.models import Invoice
from django.db.models import Sum

def get_recognized_revenue_for_period(marina_id: int, period: str) -> Decimal:
    """
    Returns the sum of revenue that was economically recognized in `period`.

    Two sources:
    1. DeferredRevenueRecognitionLog entries with recognized_period = period
       (covers annual/seasonal contracts with straight-line revenue recognition).
    2. Non-deferred invoices (no deferred entry exists) where billing_period = period
       and status IN ('paid', 'open').
       These are transient/spot invoices where the full amount is recognized on issue.

    This mirrors the GAAP/IFRS revenue recognition logic introduced in Track 4.
    Never query Invoice.total directly for intensity denominator purposes.

    Guard: if Track 4 has not yet been deployed (DeferredRevenueRecognitionLog table
    does not exist), fall back to gross invoice totals. This prevents the sustainability
    module from crashing on marinas that installed it before Track 4 migrations ran.
    """
    try:
        from billing.models import DeferredRevenueRecognitionLog

        # Source 1: deferred revenue recognized in this period
        deferred_recognized = (
            DeferredRevenueRecognitionLog.objects
            .filter(marina_id=marina_id, recognized_period=period)
            .aggregate(total=Sum('recognized_amount'))['total'] or Decimal('0')
        )

        # Source 2: spot invoices with no deferred recognition entries (transient bookings,
        # fuel dock sales, activity bookings — recognized immediately on issue)
        spot_revenue = (
            Invoice.objects
            .filter(
                marina_id=marina_id,
                billing_period=period,
                status__in=('paid', 'open'),
            )
            .exclude(
                id__in=DeferredRevenueRecognitionLog.objects
                .filter(marina_id=marina_id)
                .values('source_invoice_id')
            )
            .aggregate(total=Sum('total'))['total'] or Decimal('0')
        )

        return deferred_recognized + spot_revenue

    except Exception:
        # Track 4 not yet installed — DeferredRevenueRecognitionLog table does not exist.
        # Fall back to gross invoice total as a conservative denominator.
        # Log a warning so the operator knows the intensity metric is approximate.
        import logging
        logging.getLogger(__name__).warning(
            "DeferredRevenueRecognitionLog unavailable for marina_id=%s period=%s — "
            "using gross Invoice total as revenue denominator. Deploy Track 4 for accurate "
            "revenue recognition.", marina_id, period
        )
        return (
            Invoice.objects
            .filter(
                marina_id=marina_id,
                billing_period=period,
                status__in=('paid', 'open'),
            )
            .aggregate(total=Sum('total'))['total'] or Decimal('0')
        )
```

`revenue_gbp` in the `SustainabilityLedger` row is populated from `get_recognized_revenue_for_period()`. If the result is zero (off-season, or module newly activated), `co2e_kg_per_gbp_revenue` is set to `None` — not zero — to prevent divide-by-zero.

**Berth-nights denominator:** Count of `(check_out - check_in).days` across all `Booking` records for the marina where `check_in` falls within the period and `status NOT IN ('cancelled')`.

**Intensity metrics:**
```
co2e_kg_per_gbp_revenue  = total_co2e_kg / revenue_gbp       (None if revenue_gbp == 0)
co2e_kg_per_berth_night  = total_co2e_kg / berth_nights      (None if berth_nights == 0)
```

Both are set to `None` (not zero) when the denominator is zero, and the API returns `null`. The frontend displays "—" when the value is null.

### 5.5 Waste Diversion Rate Calculation

```python
def calculate_diversion_rate(total_quantity: Decimal, diverted_quantity: Decimal) -> Decimal:
    """
    Returns landfill diversion rate as a percentage (0–100), rounded to 2 decimal places.
    Never raises ZeroDivisionError — off-season months with zero waste logged return 0.00.
    """
    if total_quantity == Decimal('0.00'):
        return Decimal('0.00')
    return (diverted_quantity / total_quantity * 100).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP
    )
```

`diverted_quantity` is the sum of `quantity` where `disposal_method IN ('recycled', 'composted', 'specialist', 'incinerated', 'returned_supplier')`. The zero-guard is mandatory — smaller marinas and off-season periods routinely have zero waste logged. Never trust a denominator derived from user-generated time-series data.

### 5.6 Rounding Policy

- All intermediate calculations: unlimited precision (Python `Decimal` arithmetic).
- Final stored value: `.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)` for kgCO₂e fields.
- Intensity metrics stored to 6 decimal places (`Decimal('0.000001')`).
- tCO₂e display values: divide kgCO₂e by 1000 and round to 3 decimal places in the serializer.

---

## 6. ESG Report PDF Architecture

### Technology

WeasyPrint (already installed). Same generation pattern as existing invoice PDFs. The view calls `pdf_report.generate_esg_report(marina, period_from, period_to, framework)` which returns a `bytes` object. The response is `Content-Type: application/pdf` with a suggested filename.

### Template Structure

```
templates/sustainability/
    esg_report.html             # Main wrapper: cover page, executive summary, data tables
    esg_report_gri_annex.html   # GRI Standards disclosure index table
```

The main template is always rendered. The GRI annex template is conditionally appended when `framework = 'gri'`.

TCFD annex is deferred to v2. The `framework` parameter accepts `'gri'` or `'narrative'` only in v1. The `'tcfd'` and `'both'` values return `400 Bad Request` with a message: `'TCFD framework is not yet available.'`

### GRI Section Mapping

| Report Section | GRI Standards |
|---|---|
| About This Report | GRI 1 (Foundation 2021) |
| Governance | GRI 2-9 through 2-29 |
| Environmental — Emissions | GRI 305 (Emissions) |
| Environmental — Waste | GRI 306 (Waste 2020) |
| Environmental — Energy | GRI 302 (Energy) |
| Social | GRI 401–405 (Employment) |
| Intensity Metrics | GRI 305-4 (Intensity) |
| Forward-looking Targets | GRI 305-5 (Reduction targets) |
| Offset Contributions | GRI 305-5 |

The GRI annex renders an index table listing each GRI disclosure number, its title, and the page/section in the report where it is addressed. This is the format GRI requires for "in accordance" claims.

### Report Contents

The generated PDF contains:

1. **Cover page** — marina name, logo, report period, date generated, framework badge (GRI / Narrative).
2. **Executive Summary** — total tCO₂e (Scope 1+2+3), year-on-year change (%), intensity metrics, total offset (tCO₂e), net emissions after offset.
3. **Scope 1 Emissions** — table of fuel types, quantities, emission factors, kgCO₂e. Subtotal and tCO₂e total.
4. **Scope 2 Emissions** — electricity consumption, grid intensity factor used (with source attribution), tCO₂e total.
5. **Scope 3 Emissions** — table by category (fuel sold to vessels, supplier deliveries, other). tCO₂e total.
6. **Waste & Disposal** — table by category, quantities, disposal method, diversion rate %.
7. **Carbon Offsets** — total contributions (£), units purchased, certificate references, tCO₂e offset.
8. **Year-on-Year Comparison** — table: Scope 1/2/3 totals for current year and prior year, % change. If the sustainability module was activated during the current year (i.e. `SustainabilityLedger` has no rows for the prior year period), the prior-year column renders a shaded cell with the text "Not available — module activated {activation_date}". Do not omit the column. The activation date is derived from the earliest `SustainabilityLedger.computed_at` timestamp for the marina.
9. **Methodology Note** — emission factors used, data sources, known data gaps (e.g. "Scope 1 data is manually entered").
10. **GRI Disclosure Index** (if framework = `'gri'`) — appended annex.

### Data Gaps in the Report

If a scope has no data records for the period, the corresponding section renders a shaded "No data recorded" notice. The methodology note lists all missing data categories. This is preferable to omitting sections, which would give a false impression of completeness.

---

## 7. Play It Green API Integration

Play It Green's API is a REST API. The integration requires:
- API key stored in `marina.pig_api_key` (encrypted field, or stored in environment variable / Django settings keyed by marina).
- Base URL: configurable per environment (staging vs production).

### Push Flow (contributions → PIG)

1. Celery task runs weekly (or on-demand via API action).
2. Query `OffsetContribution` rows for the marina where `pig_contribution_id = ''` (not yet synced).
3. Batch POST to Play It Green's contribution endpoint:

```
POST https://api.playitgreen.com/v1/contributions
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "contributions": [
    {
      "reference":    "CONTRIB-{offset_contribution.id}",
      "amount_gbp":   "12.50",
      "description":  "Marina berth booking offset — Booking #{booking_id}",
      "booking_date": "2026-05-07"
    }
  ]
}
```

The `amount_gbp` field in the payload is the converted GBP value — not the raw `InvoiceLineItem.unit_price`. At `OffsetContribution` creation time (invoice `paid` signal), the billing app reads `invoice.currency`. If `currency != 'GBP'`, it calls `ExchangeRate.convert(amount, from_currency=invoice.currency, to_currency='GBP', date=today)` from Track 4's exchange rate engine and stores the result in `amount_gbp`. The original values are preserved in `local_currency_amount`, `local_currency_code`, and `exchange_rate_used` for the marina's own P&L reconciliation.

Response includes `contribution_id`, `units_purchased`, `unit_type` per row. Update `OffsetContribution` fields and set `synced_at`.

Write a `PlayItGreenSync` row regardless of success or failure.

### Pull Flow (certificates ← PIG)

1. Celery task runs weekly, after the push task.
2. For each `OffsetContribution` where `pig_contribution_id != ''` and `certificate_url = ''`:

```
GET https://api.playitgreen.com/v1/contributions/{pig_contribution_id}/certificate
Authorization: Bearer {api_key}
```

Response includes `certificate_url` and `co2e_offset_kg`. Update the record.

Write a `PlayItGreenSync` row.

### Error Handling

- HTTP 4xx (client error): mark the contribution as failed (add a `sync_failed` boolean field or log to `PlayItGreenSync.error_detail`). Alert via Django `logging` — do not retry automatically on 4xx.
- HTTP 5xx / timeout: retry up to 3 times with exponential back-off (Celery retry mechanism). After 3 failures, log to `PlayItGreenSync` with `status = 'failed'` and send an admin email alert.
- API key missing or invalid: skip the sync task entirely, log a warning, do not raise an exception that would block other marina syncs.

### API Key Storage

Store as `marina.pig_api_key` using Django's `encrypted-fields` library (or environment variable per marina). Do not log the key anywhere. Mask it in the admin display.

DocksBase does not hold a platform-level Play It Green account. Each marina operator must create their own Play It Green account and enter their API key in the Settings screen. DocksBase is the software conduit only — it does not handle Play It Green billing on the marina's behalf.

---

## 8. API Contract

Base path: `/api/v1/sustainability/`

All endpoints require authentication. All endpoints filter by `request.user`'s marina. All endpoints return `403` if `marina.features.get('esg_enabled') == False`.

### 8.1 Emission Factor Library

```
GET    /api/v1/sustainability/emission-factors/
POST   /api/v1/sustainability/emission-factors/
PATCH  /api/v1/sustainability/emission-factors/{id}/
DELETE /api/v1/sustainability/emission-factors/{id}/
```

The `destroy` method must catch Django's `ProtectedError` (raised by `Scope1Record.emission_factor` and `Scope3Record.emission_factor` FK with `on_delete=PROTECT`) and return a clean response instead of an HTTP 500:

```python
def destroy(self, request, *args, **kwargs):
    try:
        return super().destroy(request, *args, **kwargs)
    except ProtectedError:
        return Response(
            {"detail": "This emission factor cannot be deleted because it is referenced "
                       "in historical calculations. Set a valid_to date to retire it instead."},
            status=status.HTTP_409_CONFLICT,
        )
```

Hard deletes succeed only when the factor has never been referenced by any `Scope1Record` or `Scope3Record`. The recommended operational practice is to set `valid_to` to retire a factor — not to delete it.

### 8.2 Scope 1 Records

```
GET    /api/v1/sustainability/scope1/?period=YYYY-MM
POST   /api/v1/sustainability/scope1/
PATCH  /api/v1/sustainability/scope1/{id}/
DELETE /api/v1/sustainability/scope1/{id}/
```

`POST` and `PATCH` trigger recalculation of `co2e_kg` server-side. Never accept `co2e_kg` from the client.

### 8.3 Scope 2 Records

```
GET    /api/v1/sustainability/scope2/?period=YYYY-MM
POST   /api/v1/sustainability/scope2/           # manual entry only
PATCH  /api/v1/sustainability/scope2/{id}/
GET    /api/v1/sustainability/scope2/recalculate/?period=YYYY-MM   # triggers auto-calc from utility module
```

### 8.4 Scope 3 Records

```
GET    /api/v1/sustainability/scope3/?period=YYYY-MM&category=fuel_sold_vessels
POST   /api/v1/sustainability/scope3/
PATCH  /api/v1/sustainability/scope3/{id}/
DELETE /api/v1/sustainability/scope3/{id}/
GET    /api/v1/sustainability/scope3/recalculate/?period=YYYY-MM   # triggers fuel dock aggregation
```

### 8.5 Waste Log

```
GET    /api/v1/sustainability/waste-log/?period=YYYY-MM&category=hazardous
POST   /api/v1/sustainability/waste-log/
PATCH  /api/v1/sustainability/waste-log/{id}/
DELETE /api/v1/sustainability/waste-log/{id}/
GET    /api/v1/sustainability/waste-log/diversion-rate/?period=YYYY-MM
```

**Unit enforcement:** The `unit` field in POST and PATCH request bodies is silently discarded — `WasteLogSerializer.to_internal_value()` calls `data.pop('unit', None)`. The model's `save()` derives the correct unit from `category` using `CATEGORY_UNIT_MAP`. Returning a `400` here would force the frontend to maintain a duplicate mapping just to satisfy the backend, creating brittle coupling with no safety benefit.

`diversion-rate` response:
```json
{
  "period": "2026-05",
  "total_kg": 1250.5,
  "diverted_kg": 875.0,
  "diversion_rate_pct": 69.97,
  "by_category": [
    { "category": "recycling", "quantity_kg": 600.0, "diverted": true },
    { "category": "general",   "quantity_kg": 375.5, "diverted": false }
  ]
}
```

When no waste has been logged for the period, the response is `{ "period": "2026-02", "total_kg": 0, "diverted_kg": 0, "diversion_rate_pct": 0.0, "by_category": [] }` — never a `500`. The view calls `calculate_diversion_rate()` from `calculations.py` (Section 5.5) which guards against zero denominators.

### 8.6 Sustainability Ledger

```
GET    /api/v1/sustainability/ledger/                       # list all periods
GET    /api/v1/sustainability/ledger/?period=YYYY-MM        # single period
POST   /api/v1/sustainability/ledger/recalculate/           # body: { "period": "YYYY-MM" }
```

Ledger rows are read-only except via the `recalculate` action. Response includes both kgCO₂e and tCO₂e fields.

```json
{
  "period": "2026-05",
  "scope1_co2e_tco2e": 1.234,
  "scope2_co2e_tco2e": 0.456,
  "scope3_co2e_tco2e": 8.901,
  "total_co2e_tco2e": 10.591,
  "offset_co2e_tco2e": 0.250,
  "net_co2e_tco2e": 10.341,
  "revenue_gbp": "45200.00",
  "berth_nights": 312,
  "co2e_kg_per_gbp_revenue": 0.000234,
  "co2e_kg_per_berth_night": 33.9455,
  "computed_at": "2026-06-01T02:15:00Z"
}
```

### 8.7 ESG Report Generation

```
POST /api/v1/sustainability/esg-report/generate/
```

Request body:
```json
{
  "period_from": "2025-01",
  "period_to":   "2025-12",
  "framework":   "gri"    // "gri" | "narrative" only in v1
}
```

The `framework` field accepts `"gri"` or `"narrative"` in v1. Passing `"tcfd"` or `"both"` returns `400 Bad Request` with the message: `"TCFD framework is not yet available."` TCFD support is deferred to v2.

Response: `202 Accepted` with an `ESGReportArchive` record ID (not a raw Celery task ID — Celery results expire from Redis after 24 hours and cannot serve as persistent report history).

```json
{ "archive_id": 42, "status": "pending" }
```

```
GET /api/v1/sustainability/esg-report/{archive_id}/status/
```

Queries `ESGReportArchive.status` from the database — not Celery result state. Returns:
```json
{ "status": "pending" | "ready" | "failed", "download_url": "https://..." }
```

```
GET /api/v1/sustainability/esg-report/{archive_id}/download/
```

Streams `ESGReportArchive.pdf_file` from S3/media. Filename: `{marina_slug}-esg-report-{period_from}-{period_to}.pdf`.

```
GET /api/v1/sustainability/esg-report/history/
```

Returns all `ESGReportArchive` rows for the marina ordered by `created_at` desc. This is the source for the "previously generated reports" list in the frontend — no ephemeral Celery state involved.

### 8.8 Offset Contributions

```
GET    /api/v1/sustainability/offset-contributions/?booking_id=123
POST   /api/v1/sustainability/offset-contributions/          # created automatically at booking; manual creation also allowed
GET    /api/v1/sustainability/offset-contributions/summary/  # total £ and units by period
POST   /api/v1/sustainability/offset-contributions/sync/     # trigger manual PIG push/pull
```

### 8.9 Grid Carbon Intensity

```
GET    /api/v1/sustainability/grid-intensity/?limit=30
POST   /api/v1/sustainability/grid-intensity/                # manual override creation
DELETE /api/v1/sustainability/grid-intensity/{id}/           # remove manual override
```

---

## 9. Frontend Architecture

### 9.1 Navigation

Add a top-level sidebar group **'ESG & Sustainability'** below 'Reports'. Route: `/sustainability`. Only visible when `marina.features.esg_enabled` is truthy. The sidebar entry uses a leaf icon (or similar environment-themed icon).

### 9.2 Screen: `SustainabilityDashboard.jsx`

Route: `/sustainability`. Sub-tabs:
- **Overview** — KPI cards + charts
- **Emissions** — Scope 1/2/3 entry and tables
- **Waste** — waste log and diversion rate
- **Ledger** — monthly table
- **ESG Report** — report generator
- **Settings** — emission factor library, grid intensity config, offset config, PIG API key

#### Overview Sub-tab

Four KPI cards:
- Total tCO₂e this year (Scope 1+2+3)
- tCO₂e per £ revenue (current year)
- tCO₂e per berth-night (current year)
- Total offset (tCO₂e) — from OffsetContribution aggregate

Below the KPI cards:
- Line chart: month-by-month Scope 1/2/3 stacked bar, last 12 months (React Query from `/ledger/`)
- Year-on-year comparison table: current year vs prior year by scope. If the sustainability module was activated during the current year (i.e. no ledger rows exist for the prior year), the prior-year column shows "Not available — module activated {activation_date}" in a shaded cell. The column is always shown; it is never omitted.
- Play It Green tile: total £ contributed, total fronds/trees purchased, link to certificates gallery

#### Emissions Sub-tab

Three vertical sections for Scope 1, 2, 3.

**Scope 1:** Table of `Scope1Record` rows for the selected period. `[ + Add Fuel Entry ]` button opens a form drawer. Columns: Date, Source, Fuel Type, Quantity, Unit (read-only, derived from emission factor), Emission Factor, kgCO₂e. The Unit column shows "litres", "kg", or "kWh" depending on the selected fuel type.

**Scope 2:** Displays the auto-calculated `Scope2Record` for the period. Shows: kWh consumed (from utility module), grid intensity factor used (source label), kgCO₂e. `[ Recalculate ]` button hits the recalculate endpoint. `[ Override ]` button allows manual entry of kWh if utility data is absent.

**Scope 3:** Split view: auto-populated fuel-dock row (read-only, with `[ Recalculate ]` button) + manual entry table for supplier deliveries. `[ + Add Manual Entry ]` button opens a form drawer.

#### Waste Sub-tab

- Diversion rate KPI: circular gauge showing % diverted from landfill for the selected period.
- Bar chart: waste by category (kg or litres as appropriate), current period.
- Table: `WasteLog` entries. `[ + Log Waste ]` button opens `WasteLogDrawer.jsx`.
- `WasteLogDrawer.jsx`: fields — Date, Category (select), Quantity, Unit (read-only label derived from category — not user-selectable), Disposal Method (select), Waste Carrier (text), Carrier Licence Ref (text), Note. The unit label updates automatically when the user changes the Category selection (e.g. selecting "Bilge Oil" shows "litres"; selecting "General Waste" shows "kg").

#### Ledger Sub-tab

Monthly table: Period, Scope 1, Scope 2, Scope 3, Total (all in tCO₂e), Revenue, Berth-nights, kgCO₂e/£, kgCO₂e/berth-night, Offset, Net. Sortable. Export CSV button.

For the year-on-year comparison within the ledger view: if no prior-year rows exist (module activated mid-year), the prior-year column shows "Not available — module activated {activation_date}" in a shaded cell rather than being omitted.

#### ESG Report Sub-tab

- Period picker: from/to month selectors (default: current calendar year).
- Framework selector: radio buttons — GRI | Narrative only. TCFD is not available in v1.
- `[ Generate Report ]` button: POST to generate endpoint → polls status endpoint → shows download link when ready. Uses a loading spinner while pending.
- Report preview panel (optional, v2): iframe preview of the last generated report.
- Report history: list of previously generated reports with date, period, framework, download link.

#### Settings Sub-tab

- **Emission Factor Library:** CRUD table. `[ + Add Factor ]` drawer with fields: Energy Type, Value (kgCO₂e/unit), Unit, Jurisdiction, Valid From, Valid To, Source.
- **Grid Intensity Mode:** Toggle between "Annual Static (default, auditable)" and "Live API (experimental)". When "Live API" is selected, the nightly `fetch_grid_intensity` task is activated for this marina by setting `live_grid_intensity_enabled = True` in the marina's feature flags. The current active intensity value is displayed. `[ Set Manual Override ]` button is always available regardless of mode.
- **Carbon Offset Config:** Toggle offset on/off for transient bookings. Set per-night amount (£). Display text for customer (shown at booking checkout). Partner selection (Play It Green or off). **Mandatory toggle:** set `is_mandatory_transient_fee` on the offset `ChargeableItem` to force the offset onto all transient bookings automatically (no customer checkbox shown).
- **Play It Green:** API key input (masked). `[ Test Connection ]` button. Last sync timestamp. Manual sync button.

### 9.3 Carbon Offset Booking Widget

Location: the booking checkout flow (transient booking, both staff-side and customer portal side).

**When `is_mandatory_transient_fee = True`** on the offset `ChargeableItem`: the offset is added automatically to every transient booking invoice. The checkbox is replaced with a read-only line showing the offset amount and the "powered by Play It Green" badge:

```
Carbon offset: £{amount_per_night} × {nights} nights = £{total}  [powered by Play It Green]
(Automatically included in all bookings at this marina)
```

**When `is_mandatory_transient_fee = False`** (default — optional offset): display a checkbox at the checkout step:

```
[ ] Add carbon offset: £{amount_per_night} × {nights} nights = £{total}
    "Plant sea kelp fronds with Play It Green to offset your stay's carbon footprint."
```

If checked:
- An `InvoiceLineItem` is added for the offset `ChargeableItem`.
- On invoice payment confirmation, an `OffsetContribution` row is created.

This widget is implemented in the existing booking flow components. It reads the active offset `ChargeableItem` from the service catalog (`?category=booking_fee&is_active=true`). No new component is needed — it is a conditional section added to the existing checkout step component.

**Non-refundable policy:** Carbon offsets are non-refundable pass-through fees. Once an `OffsetContribution` is created (on invoice payment), the money is committed to Play It Green — tree-planting cannot be reversed. The refund logic in the billing app must automatically exclude any `InvoiceLineItem` whose `chargeable_item` has `is_mandatory_transient_fee = True` or whose `chargeable_item` matches the marina's active offset item. The refund total shown to the harbourmaster must make this exclusion visible (e.g. "Carbon offset £X is non-refundable and excluded from this refund").

### 9.4 Data Hooks

```
hooks/useSustainabilityLedger.js     — GET /ledger/ with period filter
hooks/useScopeRecords.js             — GET/POST/PATCH for scope1, scope2, scope3
hooks/useWasteLog.js                 — GET/POST/PATCH/DELETE for waste-log
hooks/useEmissionFactors.js          — GET/POST/PATCH/DELETE for emission-factors
hooks/useOffsetContributions.js      — GET/POST for offset-contributions + summary
hooks/useGridIntensity.js            — GET/POST/DELETE for grid-intensity
hooks/useEsgReport.js                — POST generate, GET status by archive_id, GET download, GET history
```

All hooks follow the existing pattern: React Query + Axios, toast notifications on mutation success/error, query key invalidation on success.

---

## 10. Background Jobs

All tasks registered in `sustainability/tasks.py` and added to the Celery beat schedule in `settings.py`.

### Task 1: `fetch_grid_intensity`

- **Schedule:** Daily at 02:00 UTC.
- **Action:** For each active marina with `esg_enabled = True` **and** `live_grid_intensity_enabled = True`, fetch yesterday's carbon intensity. Write `GridCarbonIntensity` row. Skip if `is_manual_override = True` row exists for that date. Marinas in Annual Static mode (default) are skipped entirely.
- **Failure handling:** Log exception, continue to next marina. Alert if failure streak > 3 consecutive days (via Django `logging` WARN to admin email).

### Task 2: `calculate_scope3_fuel_dock`

- **Schedule:** 1st of each month at 03:00 UTC (for the previous month).
- **Action:** For each active marina, aggregate `FuelDockEntry.actual_litres` by `fuel_type` for the previous month (completed entries). Compute kgCO₂e using the applicable `EmissionFactor`. Use `Scope3Record.objects.update_or_create(marina=marina, period=period, category='fuel_sold_vessels', fuel_type=fuel_type, defaults={...})` — never a bare `create()`. The `unique_together` constraint on `Scope3Record` backs this up at the DB level, so a concurrent double-run raises `IntegrityError` rather than silently inflating totals.

### Task 3: `roll_sustainability_ledger`

- **Schedule:** Nightly at 04:00 UTC (every day, not just month-end).
- **Action:** For each active marina, compute **two periods**: the current month and the previous month.

  **MANDATORY: Scope 3 must be re-aggregated before the ledger is computed.** The `Scope3Record` for `fuel_sold_vessels` is a summary snapshot derived from `FuelDockEntry`. If a fuel dock manager refunds or voids a sale after the 1st of the month, the `Scope3Record` from the previous cron run is stale. The ledger roll must re-derive it before stamping the ledger row:

  ```python
  def roll_ledger_for_marina_period(marina, period):
      # Step 1: Re-aggregate FuelDockEntry → Scope3Record (always, not cached)
      calculate_scope3_fuel_dock_for_period(marina, period)
      # Step 2: Now compute the ledger row against the freshly synced Scope3Record
      compute_ledger_row(marina.id, period)
  ```

  The `calculate_scope3_fuel_dock_for_period(marina, period)` helper is the same aggregation logic as Task 2 (extracted as a shared service function callable by both Task 2 and Task 3). It uses `update_or_create` so re-running is safe. The `POST /ledger/recalculate/` endpoint must also call this helper before computing the ledger row — the two code paths must stay in sync.

  Both rows are upserted. The function is idempotent — running it nightly against the same period is safe and simply overwrites the rows with the latest aggregates.
- **Why nightly:** A monthly schedule means the dashboard KPIs are always missing up to 31 days of live data. Running nightly keeps the "Current Year" totals near real-time. Re-computing the previous month catches late utility module entries that arrive after month close.
- **Scope 2 manual override guard:** Before re-running the utility module aggregation for a period, check whether a `Scope2Record` already exists for that marina + period with `data_source = 'manual'`. If it does, **skip the automated recalculation entirely** and leave the record untouched:
  ```python
  existing = Scope2Record.objects.filter(marina=marina, period=period).first()
  if existing and existing.data_source == 'manual':
      return existing  # never overwrite human-verified data with an automated zero
  ```
  This guard applies to both the nightly Celery task and the `GET /scope2/recalculate/` API endpoint. The only way to replace a manual record is for the harbour master to explicitly delete it and trigger a fresh auto-calculation.
- **Performance note:** `compute_ledger_row` runs simple aggregate queries against existing `Booking`, `Invoice`, and scope record tables. Two periods × all active marinas is not a heavy query load at 04:00 UTC.

### Task 4: `sync_play_it_green`

- **Schedule:** Weekly on Sunday at 05:00 UTC.
- **Action:** For each marina with `pig_api_key` set: push unsynced `OffsetContribution` rows, then pull certificates for synced rows without a `certificate_url`. Write `PlayItGreenSync` audit rows.

### Task 5: `generate_esg_report_async`

- **Trigger:** On-demand via API (not scheduled). Called by the `POST /esg-report/generate/` endpoint.
- **Action:** Render WeasyPrint PDF for the requested period and framework. Store the PDF as a media file. Update `ESGReportArchive.status = 'ready'` and `generated_at = now()`.

- **CRITICAL — Dedicated Celery queue (mandatory):** WeasyPrint is exceptionally CPU and memory-intensive when rendering multi-page documents with CSS grids and embedded SVG charts. If five marinas simultaneously hit "Generate Annual Report," the tasks will exceed RAM limits on standard Celery workers and trigger OOM kills. The tasks crash silently, `ESGReportArchive.status` remains `'pending'` forever, and the worker process is killed mid-render, potentially corrupting the partially written PDF file.

  The task **must** be routed to a dedicated queue with an aggressively memory-managed worker:

  ```python
  @app.task(
      name='sustainability.generate_esg_report_async',
      queue='pdf_generation',     # dedicated queue — never shares workers with other tasks
      acks_late=True,             # don't ack until complete, so a killed worker requeues the task
      reject_on_worker_lost=True, # requeue if OOM kill occurs
  )
  def generate_esg_report_async(archive_id: int):
      ...
  ```

  **Worker configuration** (in `docker-compose.yml` / process supervisor / Celery launch command):

  ```bash
  # Dedicated PDF worker — completely separate from the main worker pool
  celery -A backend worker \
      --queues pdf_generation \
      --concurrency 1 \               # one PDF at a time per process
      --max-tasks-per-child 1 \       # kill and restart the process after every report
      --max-memory-per-child 512000   # hard 512 MB RSS limit (OOM guard)
  ```

  `max-tasks-per-child=1` forces a full OS process recycle after every PDF. WeasyPrint leaks memory aggressively due to libcairo and Pango handle retention in long-lived Python processes. A fresh child process is the only reliable way to reclaim all memory between reports. The main Celery worker pool (`queue=celery`) must **never** process `pdf_generation` queue tasks.

  **Failure recovery:** If the PDF worker is killed mid-task (OOM or SIGKILL), `acks_late=True` + `reject_on_worker_lost=True` ensures the task is re-queued rather than silently dropped. On re-queue, the task reads the `ESGReportArchive.pk`, finds `status='pending'`, and re-renders from scratch. Set `ESGReportArchive.error_detail` on any exception before raising, so the status endpoint surfaces a human-readable failure reason instead of a permanent `pending` state.

---

## 11. Implementation Steps (ordered)

1. **Create the `sustainability` Django app** — `manage.py startapp sustainability`, register in `INSTALLED_APPS`, add URL include with feature-flag guard.

2. **Write and run migrations for all models** — `EmissionFactor`, `GridCarbonIntensity`, `Scope1Record`, `Scope2Record`, `Scope3Record`, `WasteLog`, `SustainabilityLedger`, `OffsetContribution`, `ESGReportArchive`, `PlayItGreenSync`. Run in a single initial migration for the new app.

3. **Add `is_mandatory_transient_fee` to `billing.ChargeableItem`** — Migration: `is_mandatory_transient_fee = BooleanField(default=False)`. This field controls whether the offset (or any transient fee) is forced onto all transient invoices automatically.

4. **Seed emission factors** — Write a `manage.py` command (`seed_emission_factors`) that populates default DEFRA 2023 and EPA 2022 emission factors for diesel, petrol, LPG, and grid electricity for UK and US jurisdictions. This runs once at setup and is safe to re-run (upsert on `energy_type + jurisdiction + valid_from`).

5. **Write `calculations.py`** — Pure functions: `calculate_scope1_co2e`, `calculate_scope2_co2e`, `calculate_scope3_fuel_sold`, `compute_ledger_row`. Add `get_recognized_revenue_for_period()` (Section 5.4) as the sole revenue denominator source — it must query `DeferredRevenueRecognitionLog` for deferred revenue and spot `Invoice` records for non-deferred revenue. Direct `Invoice.total` aggregation is prohibited in the ledger roll. Write unit tests for each function before moving to the ORM layer.

6. **Build serializers and ViewSets** — EmissionFactor, Scope1, Scope2, Scope3, WasteLog, Ledger, OffsetContribution, GridIntensity, ESG report endpoints. Wire to `sustainability/urls.py`. In `WasteLogSerializer.to_internal_value()`, call `data.pop('unit', None)` — silently discard any client-supplied `unit` value. The model's `save()` derives the correct unit from the category. Returning a `400` here would force the frontend to maintain a duplicate category→unit mapping just to satisfy the backend, creating brittle coupling.

7. **Implement `fetch_grid_intensity` Celery task** — National Grid ESO API client in `tasks.py`. Register in Celery beat. Guard: only run for marinas with `live_grid_intensity_enabled = True`.

8. **Implement `calculate_scope3_fuel_dock` Celery task** — Aggregate `FuelDockEntry`, write `Scope3Record` rows.

9. **Implement `roll_sustainability_ledger` Celery task** — For each period: (a) call `calculate_scope3_fuel_dock_for_period(marina, period)` first to re-sync the Scope 3 baseline against live `FuelDockEntry` data; (b) then call `compute_ledger_row` using the now-current Scope 3 records; (c) upsert `SustainabilityLedger` with `is_stale=False`. The `POST /ledger/recalculate/` endpoint must follow the same two-step sequence. Extract `calculate_scope3_fuel_dock_for_period` as a shared service function called by both Task 2 and Task 3.

9a. **Implement staleness signals** — Wire `post_save` and `post_delete` signals on `Scope1Record`, `Scope2Record`, `Scope3Record`, `WasteLog` to `_flag_ledger_stale_and_queue()` (Section 3.7). Register signals in `sustainability/apps.py` `ready()` method. Add `recalculate_ledger_period` Celery task with 30-second countdown debounce. Add `is_stale` BooleanField to `SustainabilityLedger` migration.

9b. **Discount protection for offset ChargeableItem** — In the admin/settings UI for offset `ChargeableItem` creation, hardcode `is_discountable=False` and omit the toggle from the form. Update `CouponCode` application logic and loyalty point redemption engine to exclude `InvoiceLineItem` records where `chargeable_item.is_discountable=False` from the discountable base. Implement the `on_invoice_paid` signal guard that skips `OffsetContribution` creation when `line.unit_price <= 0`, logging a warning instead.

10. **Implement `sync_play_it_green` Celery task** — Push + pull flows, error handling, `PlayItGreenSync` logging.

11. **Build WeasyPrint ESG report template** — HTML template with all sections (Section 6). CSS for print layout. GRI annex template. TCFD annex is not built in v1.

12. **Build `generate_esg_report_async` task + status endpoint** — Route the task to `queue='pdf_generation'` with `acks_late=True` and `reject_on_worker_lost=True`. Configure a dedicated Celery worker for this queue: `--concurrency 1 --max-tasks-per-child 1 --max-memory-per-child 512000`. The main worker pool must explicitly exclude the `pdf_generation` queue. Store PDF in media, expose status and download endpoints. Set `ESGReportArchive.error_detail` on any exception before re-raising, so the status endpoint always returns a readable failure reason.

13. **Add `esg_enabled` and `live_grid_intensity_enabled` feature flags to `Marina` model** — Add `features` JSONField (or a dedicated `MarinaFeatures` model if it doesn't exist). Add admin toggle.

14. **Build frontend hooks** — Seven hooks listed in Section 9.4. Follow existing hook pattern.

15. **Build `SustainabilityDashboard.jsx`** — Overview, Emissions, Waste, Ledger, ESG Report, Settings sub-tabs (Section 9.2).

16. **Add carbon offset widget to booking checkout** — Conditional section in existing checkout step component. Reads offset `ChargeableItem` from service catalog. Checks `is_mandatory_transient_fee`: if True, renders read-only line; if False, renders opt-in checkbox. Creates `OffsetContribution` on payment confirmation (Django signal on `Invoice.status` → `paid`). Update the billing app refund logic to exclude offset `InvoiceLineItem` records from refund totals and surface the exclusion clearly to the harbourmaster in the refund UI.

17. **Add sidebar navigation entry** — Top-level "ESG & Sustainability" group, gated by `esg_enabled` flag.

18. **Add `is_internal_use` to `FuelDockEntry`** — Migration on the fuel dock app: `is_internal_use = BooleanField(default=False)`. Update the fuel dock POS form to expose this toggle when the marina's own vessel is selected as the customer. This is a cross-app dependency; coordinate with the fuel dock app.

19. **Write integration tests** — Cover: Scope 1 factor lookup (missing factor returns 400), Scope 1 LPG entry stores `unit='kg'` not `unit='litre'`, Scope 2 fallback hierarchy (static mode uses EmissionFactor, not GridCarbonIntensity), Scope 2 manual override not overwritten by nightly task, Scope 3 internal fuel excluded from `fuel_sold_vessels` aggregation (is_internal_use=True entries do not appear), Scope 3 supplier delivery with `unit='tkm'` stores distance_km correctly, waste log unit enforcement (client-supplied unit silently discarded), diversion rate with zero waste logged returns `0.0` not a 500, ledger roll-up idempotency (running twice for the same period produces one row), ledger roll-up with zero revenue, PIG sync with API timeout retry, ESG report PDF generation with missing scope data (renders "No data" notice, does not crash), ESG report generation with `framework='tcfd'` returns 400, refund flow excludes offset `InvoiceLineItem` from refund total, EmissionFactor delete with referenced records returns 409.

    **Additional tests for architectural fixes:**
    - **Deferred revenue denominator:** Create a €12,000 annual contract invoiced in January with 12 monthly `DeferredRevenueRecognitionLog` entries of €1,000 each. Assert `SustainabilityLedger.revenue_gbp` for January = €1,000, not €12,000. Assert February through December each show €1,000 (not zero). Assert no divide-by-zero in any month.
    - **Offset coupon guard:** Apply a "100% OFF" coupon to a transient booking containing an offset line item with `is_discountable=False`. Assert offset line item price is unchanged at full value. Assert `OffsetContribution` is created with `amount_gbp > 0`. Assert the coupon's discount applies only to other line items.
    - **Offset zero-price guard:** Manually set an offset `InvoiceLineItem.unit_price = 0` and mark the invoice `paid`. Assert the `on_invoice_paid` signal does NOT create an `OffsetContribution` and logs a warning. Assert no PIG API call is dispatched.
    - **Staleness signal:** Modify a `Scope2Record` for January 2026. Assert the January 2026 `SustainabilityLedger` row has `is_stale=True` immediately after. Assert `recalculate_ledger_period` task is queued. On task completion, assert `is_stale=False` and `scope2_co2e_kg` reflects the updated record.
    - **Fuel dock re-aggregation on ledger roll:** Create a `FuelDockEntry` for January, run the monthly task, then void the entry. Run the ledger roll for January again. Assert the January `Scope3Record` is updated to reflect the void and the `SustainabilityLedger` scope3 total is consistent with the voided `Scope3Record`.
    - **PDF queue isolation:** Assert `generate_esg_report_async.apply_async()` targets `queue='pdf_generation'`. Assert the task is NOT routed to the default `celery` queue. Assert `ESGReportArchive.error_detail` is populated on task failure (not left blank).
