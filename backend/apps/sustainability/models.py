"""
apps/sustainability/models.py

Track 12 — Sustainability & ESG
All 10 models in FK-dependency order.

Key invariants:
- SustainabilityLedger.revenue_gbp uses recognised revenue only (DeferredRevenueRecognitionLog
  when Track 4 is deployed; graceful fallback to gross Invoice.total otherwise).
- offset ChargeableItem.is_discountable must always be False.
- on_invoice_paid signal skips OffsetContribution creation when line.unit_price <= 0.
- ESG PDF task MUST route to the 'pdf_generation' Celery queue exclusively.
- Ledger roll-up always re-aggregates FuelDockEntry → Scope3Record before stamping.
"""

from django.core.exceptions import ValidationError
from django.db import models


def get_active_factor(marina, energy_type: str, date):
    """
    Returns the most-recently-valid EmissionFactor for the given marina, energy_type, and date.
    Raises ValidationError if none found.
    """
    qs = EmissionFactor.objects.filter(
        marina=marina,
        energy_type=energy_type,
        valid_from__lte=date,
    ).filter(
        models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=date)
    )
    factor = qs.order_by('-valid_from').first()
    if factor is None:
        raise ValidationError(
            f"No emission factor found for {energy_type} on {date}. "
            "Please add one in the Emission Factor Library."
        )
    return factor


# ---------------------------------------------------------------------------
# 1. EmissionFactor
# ---------------------------------------------------------------------------

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
    jurisdiction     = models.CharField(max_length=10, blank=True)   # 'UK', 'US'
    valid_from       = models.DateField()
    valid_to         = models.DateField(null=True, blank=True)        # null = currently active
    source           = models.CharField(max_length=20, choices=Source.choices, default=Source.DEFRA)
    source_url       = models.URLField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['energy_type', '-valid_from']

    def __str__(self):
        return f"{self.get_energy_type_display()} ({self.unit}) — {self.kg_co2e_per_unit} kg CO₂e"


# ---------------------------------------------------------------------------
# 2. GridCarbonIntensity
# ---------------------------------------------------------------------------

class GridCarbonIntensity(models.Model):
    class GridSource(models.TextChoices):
        NATIONAL_GRID_ESO = 'ng_eso', 'National Grid ESO (UK)'
        EPA_EGRID         = 'epa',    'EPA eGRID (US)'
        MANUAL            = 'manual', 'Manual Override'

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='grid_intensities')
    grid_source        = models.CharField(max_length=20, choices=GridSource.choices)
    region_code        = models.CharField(max_length=20, blank=True)
    valid_date         = models.DateField(db_index=True)
    kg_co2e_per_kwh    = models.DecimalField(max_digits=8, decimal_places=6)
    is_manual_override = models.BooleanField(default=False)
    fetched_at         = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering        = ['-valid_date']
        unique_together = [('marina', 'valid_date')]

    def __str__(self):
        return f"{self.marina} {self.valid_date} — {self.kg_co2e_per_kwh} kgCO₂e/kWh"


# ---------------------------------------------------------------------------
# 3. Scope1Record
# ---------------------------------------------------------------------------

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
    co2e_kg         = models.DecimalField(max_digits=12, decimal_places=4)  # computed on save
    notes           = models.CharField(max_length=500, blank=True)
    ap_reference    = models.CharField(max_length=100, blank=True)           # free-text reference
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        from apps.sustainability.calculations import calculate_scope1_co2e
        self.unit    = self.emission_factor.unit
        self.co2e_kg = calculate_scope1_co2e(self.quantity, self.emission_factor.kg_co2e_per_unit)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Scope1 {self.date} {self.fuel_type} {self.quantity}{self.unit} → {self.co2e_kg}kgCO₂e"


# ---------------------------------------------------------------------------
# 4. Scope2Record
# ---------------------------------------------------------------------------

class Scope2Record(models.Model):
    class DataSource(models.TextChoices):
        UTILITY_MODULE = 'utility', 'Utility Module (auto)'
        MANUAL         = 'manual',  'Manual Entry'

    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='scope2_records')
    period               = models.CharField(max_length=7, db_index=True)   # 'YYYY-MM'
    kwh_consumed         = models.DecimalField(max_digits=12, decimal_places=3)
    grid_intensity       = models.ForeignKey(GridCarbonIntensity, on_delete=models.PROTECT, null=True, blank=True)
    kg_co2e_per_kwh_used = models.DecimalField(max_digits=8, decimal_places=6)  # snapshot at calculation time
    co2e_kg              = models.DecimalField(max_digits=12, decimal_places=4)
    data_source          = models.CharField(max_length=20, choices=DataSource.choices, default=DataSource.UTILITY_MODULE)
    notes                = models.CharField(max_length=500, blank=True)
    calculated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'period')]

    def __str__(self):
        return f"Scope2 {self.marina} {self.period} — {self.co2e_kg}kgCO₂e"


# ---------------------------------------------------------------------------
# 5. Scope3Record
# ---------------------------------------------------------------------------

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
        # unique_together backs the update_or_create pattern in the fuel dock aggregation task.
        # Running the aggregation twice for the same period/category/fuel_type is safe.
        unique_together = [('marina', 'period', 'category', 'fuel_type')]

    def __str__(self):
        return f"Scope3 {self.period} {self.category} {self.fuel_type} → {self.co2e_kg}kgCO₂e"


# ---------------------------------------------------------------------------
# 6. WasteLog
# ---------------------------------------------------------------------------

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
        'general':     'kg',
        'recycling':   'kg',
        'hazardous':   'kg',
        'antifouling': 'kg',
        'bilge_oil':   'litres',
        'pump_out':    'litres',
    }

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='waste_logs')
    date                = models.DateField()
    category            = models.CharField(max_length=20, choices=Category.choices)
    quantity            = models.DecimalField(max_digits=10, decimal_places=3)
    unit                = models.CharField(
        max_length=10, editable=False,
        choices=[('kg', 'kg'), ('litres', 'litres')],
    )
    disposal_method     = models.CharField(max_length=30, choices=DisposalMethod.choices)
    waste_carrier       = models.CharField(max_length=200, blank=True)
    carrier_licence_ref = models.CharField(max_length=100, blank=True)
    disposal_note       = models.CharField(max_length=500, blank=True)
    logged_by           = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date']

    def save(self, *args, **kwargs):
        self.unit = self.CATEGORY_UNIT_MAP.get(self.category, 'kg')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"WasteLog {self.date} {self.category} {self.quantity}{self.unit}"


# ---------------------------------------------------------------------------
# 7. SustainabilityLedger
# ---------------------------------------------------------------------------

class SustainabilityLedger(models.Model):
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='sustainability_ledger')
    period               = models.CharField(max_length=7, db_index=True)   # 'YYYY-MM'

    scope1_co2e_kg       = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    scope2_co2e_kg       = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    scope3_co2e_kg       = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    total_co2e_kg        = models.DecimalField(max_digits=14, decimal_places=4, default=0)

    revenue_gbp          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    berth_nights         = models.PositiveIntegerField(default=0)

    co2e_kg_per_gbp_revenue = models.DecimalField(max_digits=12, decimal_places=6, null=True)
    co2e_kg_per_berth_night = models.DecimalField(max_digits=12, decimal_places=4, null=True)

    offset_co2e_kg       = models.DecimalField(max_digits=12, decimal_places=4, default=0)

    computed_at          = models.DateTimeField(auto_now=True)
    is_stale             = models.BooleanField(
        default=False,
        help_text="Set True by signals when source data changes. Cleared by recalculation.",
    )

    class Meta:
        unique_together = [('marina', 'period')]
        ordering        = ['-period']

    def __str__(self):
        return f"Ledger {self.marina} {self.period} — {self.total_co2e_kg}kgCO₂e"


# ---------------------------------------------------------------------------
# 8. OffsetContribution
# ---------------------------------------------------------------------------

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

    def __str__(self):
        return f"Offset £{self.amount_gbp} — {self.partner} ({self.marina})"


# ---------------------------------------------------------------------------
# 9. ESGReportArchive
# ---------------------------------------------------------------------------

class ESGReportArchive(models.Model):
    class Framework(models.TextChoices):
        GRI       = 'gri',       'GRI Standards'
        NARRATIVE = 'narrative', 'Narrative Only'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        READY   = 'ready',   'Ready'
        FAILED  = 'failed',  'Failed'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='esg_report_archive')
    period_from    = models.CharField(max_length=7)   # 'YYYY-MM'
    period_to      = models.CharField(max_length=7)
    framework      = models.CharField(max_length=20, choices=Framework.choices)
    status         = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    pdf_file       = models.FileField(upload_to='esg_reports/%Y/%m/', blank=True)
    celery_task_id = models.CharField(max_length=255, blank=True)   # in-progress tracking
    error_detail   = models.CharField(max_length=500, blank=True)
    generated_at   = models.DateTimeField(null=True, blank=True)
    generated_by   = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"ESGReport {self.marina} {self.period_from}→{self.period_to} [{self.status}]"


# ---------------------------------------------------------------------------
# 10. PlayItGreenSync
# ---------------------------------------------------------------------------

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

    def __str__(self):
        return f"PIG Sync {self.direction} {self.status} {self.marina} @ {self.synced_at:%Y-%m-%d}"
