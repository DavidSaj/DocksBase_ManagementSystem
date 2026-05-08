import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0001_initial'),
        ('berths', '0001_initial'),
        ('billing', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ShippingAgent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('contact_name', models.CharField(blank=True, max_length=200)),
                ('email', models.EmailField(blank=True)),
                ('phone', models.CharField(blank=True, max_length=30)),
                ('address', models.TextField(blank=True)),
                ('vat_number', models.CharField(blank=True, max_length=50)),
                ('notes', models.TextField(blank=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shipping_agents', to='accounts.marina')),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='HarbourTariff',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('due_type', models.CharField(choices=[('pilotage', 'Pilotage'), ('tug', 'Tug'), ('harbour_dues', 'Harbour Dues / Port Dues'), ('passenger_landing', 'Passenger Landing'), ('cargo_handling', 'Cargo Handling')], max_length=30)),
                ('vessel_type', models.CharField(choices=[('ferry', 'Ferry'), ('cargo', 'Cargo Vessel'), ('fishing', 'Fishing Vessel (Commercial)'), ('research', 'Research Vessel'), ('pilot', 'Pilot Vessel'), ('dredger', 'Dredger'), ('supply', 'Supply Vessel'), ('cruise_tender', 'Cruise Ship Tender'), ('all', 'All Types')], default='all', max_length=20)),
                ('base_fee', models.DecimalField(decimal_places=4, default=0, max_digits=10)),
                ('multiplier_fee', models.DecimalField(decimal_places=6, default=0, max_digits=10)),
                ('flag_state', models.CharField(blank=True, max_length=3)),
                ('min_gt', models.IntegerField(blank=True, null=True)),
                ('max_gt', models.IntegerField(blank=True, null=True)),
                ('effective_from', models.DateField()),
                ('effective_to', models.DateField(blank=True, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('notes', models.TextField(blank=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='harbour_tariffs', to='accounts.marina')),
                ('chargeable_item', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='harbour_tariffs', to='billing.chargeableitem')),
            ],
            options={
                'ordering': ['due_type', 'vessel_type', 'min_gt'],
            },
        ),
        migrations.CreateModel(
            name='CommercialMovement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('vessel_name', models.CharField(max_length=200)),
                ('imo_number', models.CharField(blank=True, max_length=20)),
                ('flag', models.CharField(blank=True, max_length=3)),
                ('vessel_type', models.CharField(choices=[('ferry', 'Ferry'), ('cargo', 'Cargo Vessel'), ('fishing', 'Fishing Vessel (Commercial)'), ('research', 'Research Vessel'), ('pilot', 'Pilot Vessel'), ('dredger', 'Dredger'), ('supply', 'Supply Vessel'), ('cruise_tender', 'Cruise Ship Tender'), ('all', 'All Types')], max_length=20)),
                ('gross_tonnage', models.IntegerField(blank=True, null=True)),
                ('net_tonnage', models.IntegerField(blank=True, null=True)),
                ('cargo_type', models.CharField(blank=True, max_length=200)),
                ('cargo_weight_mt', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('crew_count', models.IntegerField(default=0)),
                ('passenger_count', models.IntegerField(default=0)),
                ('port_of_origin', models.CharField(blank=True, max_length=200)),
                ('next_port', models.CharField(blank=True, max_length=200)),
                ('agent_name', models.CharField(blank=True, max_length=200)),
                ('agent_email', models.EmailField(blank=True)),
                ('berth_label', models.CharField(blank=True, max_length=100)),
                ('eta', models.DateTimeField(blank=True, null=True)),
                ('etd', models.DateTimeField(blank=True, null=True)),
                ('actual_arrival', models.DateTimeField(blank=True, null=True)),
                ('actual_departure', models.DateTimeField(blank=True, null=True)),
                ('pilotage_distance_nm', models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ('tug_duration_hours', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
                ('status', models.CharField(choices=[('expected', 'Expected'), ('arrived', 'Arrived'), ('departed', 'Departed'), ('cancelled', 'Cancelled')], default='expected', max_length=20)),
                ('psc_flag', models.BooleanField(default=False)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='commercial_movements', to='accounts.marina')),
                ('shipping_agent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movements', to='harbour.shippingagent')),
                ('berth_assigned', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='commercial_movements', to='berths.berth')),
            ],
            options={
                'ordering': ['-eta'],
            },
        ),
        migrations.CreateModel(
            name='HarbourDueInvoice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('due_type', models.CharField(choices=[('pilotage', 'Pilotage'), ('tug', 'Tug'), ('harbour_dues', 'Harbour Dues / Port Dues'), ('passenger_landing', 'Passenger Landing'), ('cargo_handling', 'Cargo Handling')], max_length=30)),
                ('quantity', models.DecimalField(decimal_places=4, max_digits=10)),
                ('calculated_amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='harbour_due_invoices', to='accounts.marina')),
                ('movement', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='due_invoices', to='harbour.commercialmovement')),
                ('tariff', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='due_invoices', to='harbour.harbourtariff')),
                ('invoice', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='harbour_due_invoices', to='billing.invoice')),
            ],
        ),
        migrations.CreateModel(
            name='PortStateControlRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('inspection_date', models.DateField()),
                ('inspector_name', models.CharField(blank=True, max_length=200)),
                ('authority', models.CharField(blank=True, max_length=200)),
                ('outcome', models.CharField(choices=[('no_deficiencies', 'No Deficiencies'), ('deficiencies', 'Deficiencies Noted'), ('detained', 'Vessel Detained')], max_length=20)),
                ('deficiency_codes', models.TextField(blank=True)),
                ('rectification_deadline', models.DateField(blank=True, null=True)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='psc_records', to='accounts.marina')),
                ('movement', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='psc_records', to='harbour.commercialmovement')),
            ],
        ),
    ]
