"""
Track 12 initial migration — all 10 sustainability models.

Prerequisites that must be migrated first:
  - accounts.Marina (already exists)
  - billing.InvoiceLineItem (already exists — billing 0012)
  - reservations.Booking (already exists — reservations 0012)
  - staff.StaffMember (already exists)
  - fuel_dock 0003_fueldockentry_is_internal_use (adds is_internal_use)
"""

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts',     '0016_remove_marina_channel_fields'),
        ('billing',      '0012_chargeableitem_is_discountable_and_more'),
        ('fuel_dock',    '0003_fueldockentry_is_internal_use'),
        ('reservations', '0012_booking_track2_fields'),
        ('staff',        '0002_certification_pdf_file_staffmember_user'),
    ]

    operations = [
        # ------------------------------------------------------------------
        # EmissionFactor
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='EmissionFactor',
            fields=[
                ('id',               models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('energy_type',      models.CharField(choices=[('diesel','Diesel'),('petrol','Petrol'),('lpg','LPG'),('natural_gas','Natural Gas'),('electricity','Grid Electricity'),('hvo','HVO (Hydrotreated Vegetable Oil)')], max_length=20)),
                ('kg_co2e_per_unit', models.DecimalField(decimal_places=6, max_digits=10)),
                ('unit',             models.CharField(choices=[('litre','Litre'),('kwh','kWh'),('kg','kg'),('tkm','Tonne-kilometre'),('gbp','GBP (spend-based)'),('usd','USD (spend-based)'),('eur','EUR (spend-based)')], max_length=10)),
                ('jurisdiction',     models.CharField(blank=True, max_length=10)),
                ('valid_from',       models.DateField()),
                ('valid_to',         models.DateField(blank=True, null=True)),
                ('source',           models.CharField(choices=[('defra','DEFRA (UK)'),('epa_egrid','EPA eGRID (US)'),('grid_api','National Grid ESO API (live)'),('manual','Manual (admin override)')], default='defra', max_length=20)),
                ('source_url',       models.URLField(blank=True)),
                ('created_at',       models.DateTimeField(auto_now_add=True)),
                ('marina',           models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='emission_factors', to='accounts.marina')),
            ],
            options={'ordering': ['energy_type', '-valid_from']},
        ),

        # ------------------------------------------------------------------
        # GridCarbonIntensity
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='GridCarbonIntensity',
            fields=[
                ('id',                 models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('grid_source',        models.CharField(choices=[('ng_eso','National Grid ESO (UK)'),('epa','EPA eGRID (US)'),('manual','Manual Override')], max_length=20)),
                ('region_code',        models.CharField(blank=True, max_length=20)),
                ('valid_date',         models.DateField(db_index=True)),
                ('kg_co2e_per_kwh',    models.DecimalField(decimal_places=6, max_digits=8)),
                ('is_manual_override', models.BooleanField(default=False)),
                ('fetched_at',         models.DateTimeField(blank=True, null=True)),
                ('marina',             models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='grid_intensities', to='accounts.marina')),
            ],
            options={'ordering': ['-valid_date'], 'unique_together': {('marina', 'valid_date')}},
        ),

        # ------------------------------------------------------------------
        # Scope1Record
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='Scope1Record',
            fields=[
                ('id',              models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source',          models.CharField(choices=[('vehicle_fuel','Marina Vehicle'),('workboat_fuel','Workboat / Launch'),('generator','Generator'),('machinery','Machinery / Equipment'),('manual','Manual Entry')], max_length=20)),
                ('fuel_type',       models.CharField(choices=[('diesel','Diesel'),('petrol','Petrol'),('lpg','LPG'),('natural_gas','Natural Gas'),('electricity','Grid Electricity'),('hvo','HVO (Hydrotreated Vegetable Oil)')], max_length=20)),
                ('quantity',        models.DecimalField(decimal_places=3, max_digits=10)),
                ('unit',            models.CharField(choices=[('litre','Litre'),('kwh','kWh'),('kg','kg'),('tkm','Tonne-kilometre'),('gbp','GBP (spend-based)'),('usd','USD (spend-based)'),('eur','EUR (spend-based)')], editable=False, max_length=10)),
                ('date',            models.DateField()),
                ('co2e_kg',         models.DecimalField(decimal_places=4, max_digits=12)),
                ('notes',           models.CharField(blank=True, max_length=500)),
                ('ap_reference',    models.CharField(blank=True, max_length=100)),
                ('created_at',      models.DateTimeField(auto_now_add=True)),
                ('updated_at',      models.DateTimeField(auto_now=True)),
                ('emission_factor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='scope1_records', to='sustainability.emissionfactor')),
                ('marina',          models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='scope1_records', to='accounts.marina')),
            ],
        ),

        # ------------------------------------------------------------------
        # Scope2Record
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='Scope2Record',
            fields=[
                ('id',                  models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period',              models.CharField(db_index=True, max_length=7)),
                ('kwh_consumed',        models.DecimalField(decimal_places=3, max_digits=12)),
                ('kg_co2e_per_kwh_used',models.DecimalField(decimal_places=6, max_digits=8)),
                ('co2e_kg',             models.DecimalField(decimal_places=4, max_digits=12)),
                ('data_source',         models.CharField(choices=[('utility','Utility Module (auto)'),('manual','Manual Entry')], default='utility', max_length=20)),
                ('notes',               models.CharField(blank=True, max_length=500)),
                ('calculated_at',       models.DateTimeField(auto_now=True)),
                ('grid_intensity',      models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to='sustainability.gridcarbonintensity')),
                ('marina',              models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='scope2_records', to='accounts.marina')),
            ],
            options={'unique_together': {('marina', 'period')}},
        ),

        # ------------------------------------------------------------------
        # Scope3Record
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='Scope3Record',
            fields=[
                ('id',               models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period',           models.CharField(db_index=True, max_length=7)),
                ('category',         models.CharField(choices=[('fuel_sold_vessels','Fuel Sold to Vessels (fuel dock)'),('supplier_delivery','Supplier Deliveries'),('staff_commute','Staff Commute (optional)'),('other','Other (manual)')], max_length=30)),
                ('fuel_type',        models.CharField(blank=True, choices=[('diesel','Diesel'),('petrol','Petrol'),('lpg','LPG'),('natural_gas','Natural Gas'),('electricity','Grid Electricity'),('hvo','HVO (Hydrotreated Vegetable Oil)')], max_length=20)),
                ('quantity',         models.DecimalField(decimal_places=3, max_digits=12)),
                ('unit',             models.CharField(choices=[('litre','Litre'),('kwh','kWh'),('kg','kg'),('tkm','Tonne-kilometre'),('gbp','GBP (spend-based)'),('usd','USD (spend-based)'),('eur','EUR (spend-based)')], max_length=10)),
                ('co2e_kg',          models.DecimalField(decimal_places=4, max_digits=12)),
                ('data_source',      models.CharField(choices=[('fuel_dock_auto','Fuel Dock (auto-calculated)'),('manual','Manual Entry')], default='manual', max_length=20)),
                ('source_reference', models.CharField(blank=True, max_length=100)),
                ('distance_km',      models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('spend_amount',     models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('notes',            models.CharField(blank=True, max_length=500)),
                ('created_at',       models.DateTimeField(auto_now_add=True)),
                ('updated_at',       models.DateTimeField(auto_now=True)),
                ('emission_factor',  models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to='sustainability.emissionfactor')),
                ('marina',           models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='scope3_records', to='accounts.marina')),
            ],
            options={'unique_together': {('marina', 'period', 'category', 'fuel_type')}},
        ),

        # ------------------------------------------------------------------
        # WasteLog
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='WasteLog',
            fields=[
                ('id',                  models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date',                models.DateField()),
                ('category',            models.CharField(choices=[('general','General Waste'),('recycling','Recycling'),('hazardous','Hazardous Waste'),('antifouling','Antifouling Paint'),('bilge_oil','Bilge Oil'),('pump_out','Pump-out (sewage)')], max_length=20)),
                ('quantity',            models.DecimalField(decimal_places=3, max_digits=10)),
                ('unit',                models.CharField(choices=[('kg','kg'),('litres','litres')], editable=False, max_length=10)),
                ('disposal_method',     models.CharField(choices=[('landfill','Landfill'),('recycled','Recycled'),('composted','Composted'),('specialist','Specialist Disposal'),('incinerated','Incinerated (energy recovery)'),('returned_supplier','Returned to Supplier')], max_length=30)),
                ('waste_carrier',       models.CharField(blank=True, max_length=200)),
                ('carrier_licence_ref', models.CharField(blank=True, max_length=100)),
                ('disposal_note',       models.CharField(blank=True, max_length=500)),
                ('created_at',          models.DateTimeField(auto_now_add=True)),
                ('logged_by',           models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='staff.staffmember')),
                ('marina',              models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='waste_logs', to='accounts.marina')),
            ],
            options={'ordering': ['-date']},
        ),

        # ------------------------------------------------------------------
        # SustainabilityLedger
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='SustainabilityLedger',
            fields=[
                ('id',                      models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period',                  models.CharField(db_index=True, max_length=7)),
                ('scope1_co2e_kg',          models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ('scope2_co2e_kg',          models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ('scope3_co2e_kg',          models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ('total_co2e_kg',           models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ('revenue_gbp',             models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('berth_nights',            models.PositiveIntegerField(default=0)),
                ('co2e_kg_per_gbp_revenue', models.DecimalField(decimal_places=6, max_digits=12, null=True)),
                ('co2e_kg_per_berth_night', models.DecimalField(decimal_places=4, max_digits=12, null=True)),
                ('offset_co2e_kg',          models.DecimalField(decimal_places=4, default=0, max_digits=12)),
                ('computed_at',             models.DateTimeField(auto_now=True)),
                ('is_stale',                models.BooleanField(default=False, help_text='Set True by signals when source data changes. Cleared by recalculation.')),
                ('marina',                  models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sustainability_ledger', to='accounts.marina')),
            ],
            options={'ordering': ['-period'], 'unique_together': {('marina', 'period')}},
        ),

        # ------------------------------------------------------------------
        # OffsetContribution
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='OffsetContribution',
            fields=[
                ('id',                    models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('partner',               models.CharField(choices=[('play_it_green','Play It Green'),('manual','Manual / Other')], default='play_it_green', max_length=20)),
                ('amount_gbp',            models.DecimalField(decimal_places=2, max_digits=10)),
                ('local_currency_amount', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('local_currency_code',   models.CharField(blank=True, max_length=3)),
                ('exchange_rate_used',    models.DecimalField(blank=True, decimal_places=6, max_digits=12, null=True)),
                ('units_purchased',       models.DecimalField(blank=True, decimal_places=4, max_digits=10, null=True)),
                ('unit_type',             models.CharField(blank=True, max_length=50)),
                ('certificate_url',       models.URLField(blank=True)),
                ('pig_contribution_id',   models.CharField(blank=True, max_length=100)),
                ('co2e_offset_kg',        models.DecimalField(blank=True, decimal_places=4, max_digits=12, null=True)),
                ('synced_at',             models.DateTimeField(blank=True, null=True)),
                ('created_at',            models.DateTimeField(auto_now_add=True)),
                ('booking',               models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='offset_contributions', to='reservations.booking')),
                ('invoice_line_item',     models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='billing.invoicelineitem')),
                ('marina',                models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='offset_contributions', to='accounts.marina')),
            ],
        ),

        # ------------------------------------------------------------------
        # ESGReportArchive
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='ESGReportArchive',
            fields=[
                ('id',             models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period_from',    models.CharField(max_length=7)),
                ('period_to',      models.CharField(max_length=7)),
                ('framework',      models.CharField(choices=[('gri','GRI Standards'),('narrative','Narrative Only')], max_length=20)),
                ('status',         models.CharField(choices=[('pending','Pending'),('ready','Ready'),('failed','Failed')], default='pending', max_length=10)),
                ('pdf_file',       models.FileField(blank=True, upload_to='esg_reports/%Y/%m/')),
                ('celery_task_id', models.CharField(blank=True, max_length=255)),
                ('error_detail',   models.CharField(blank=True, max_length=500)),
                ('generated_at',   models.DateTimeField(blank=True, null=True)),
                ('created_at',     models.DateTimeField(auto_now_add=True)),
                ('generated_by',   models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='staff.staffmember')),
                ('marina',         models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='esg_report_archive', to='accounts.marina')),
            ],
            options={'ordering': ['-created_at']},
        ),

        # ------------------------------------------------------------------
        # PlayItGreenSync
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='PlayItGreenSync',
            fields=[
                ('id',            models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('direction',     models.CharField(choices=[('push','Push (contributions sent)'),('pull','Pull (certificates retrieved)')], max_length=10)),
                ('status',        models.CharField(choices=[('success','Success'),('failed','Failed'),('partial','Partial')], max_length=10)),
                ('records_count', models.PositiveIntegerField(default=0)),
                ('total_gbp',     models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('response_body', models.TextField(blank=True)),
                ('error_detail',  models.CharField(blank=True, max_length=500)),
                ('synced_at',     models.DateTimeField(auto_now_add=True)),
                ('marina',        models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pig_syncs', to='accounts.marina')),
            ],
        ),
    ]
