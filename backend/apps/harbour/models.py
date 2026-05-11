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
