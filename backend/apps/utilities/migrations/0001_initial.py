"""
Track 6 — utilities app initial migration.

Creates all utilities models:
  UtilityIntegration, SmartMeter, MeterReading, MeterOutageAlert,
  UtilityWallet, UtilityWalletTransaction, ServiceBollard,
  BollardFaultLog, BollardSwitchEvent, WashToken

IMPORTANT — MeterReading scale note:
  At 500 meters * 4 reads/hour = 17.5M rows/year per marina.
  After applying this migration, choose ONE partitioning strategy and run
  the corresponding SQL documented in apps/utilities/INSTALL.md before
  going to production. Do NOT run on an unpartitioned table beyond 6 months
  of data.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0018_marina_no_show_grace_minutes'),
        ('berths', '__first__'),
        ('billing', '__first__'),
        ('boatyard', '0003_track6_drystack_concierge'),
        ('members', '__first__'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # -----------------------------------------------------------------
        # UtilityIntegration
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='UtilityIntegration',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('vendor', models.CharField(
                    max_length=20,
                    choices=[('rolec', 'Rolec'), ('marinesync', 'MarineSync')],
                )),
                ('credentials', models.JSONField(
                    default=dict,
                    help_text='DEVELOPMENT FALLBACK — install django-fernet-fields for encryption at rest.',
                )),
                ('is_active', models.BooleanField(default=True)),
                ('last_sync_at', models.DateTimeField(null=True, blank=True)),
                ('last_sync_ok', models.BooleanField(default=True)),
                ('last_sync_error', models.TextField(blank=True)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='utility_integrations',
                )),
            ],
            options={
                'unique_together': {('marina', 'vendor')},
            },
        ),

        # -----------------------------------------------------------------
        # SmartMeter
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='SmartMeter',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('vendor', models.CharField(
                    max_length=20,
                    choices=[('rolec', 'Rolec'), ('marinesync', 'MarineSync')],
                )),
                ('meter_type', models.CharField(
                    max_length=20,
                    choices=[('electricity', 'Electricity'), ('water', 'Water')],
                )),
                ('device_id', models.CharField(max_length=100)),
                ('label', models.CharField(max_length=100, blank=True)),
                ('poll_interval_minutes', models.IntegerField(default=60)),
                ('is_active', models.BooleanField(default=True)),
                ('last_polled', models.DateTimeField(null=True, blank=True)),
                ('is_online', models.BooleanField(default=True)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='smart_meters',
                )),
                ('berth', models.ForeignKey(
                    to='berths.berth',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='smart_meters',
                )),
            ],
            options={
                'ordering': ['berth__code', 'meter_type'],
                'unique_together': {('marina', 'vendor', 'device_id')},
            },
        ),

        # -----------------------------------------------------------------
        # MeterReading
        # SCALE WARNING: 17.5M rows/year at 500 meters * 4 reads/hour.
        # Partition BEFORE production data ingestion. See INSTALL.md.
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='MeterReading',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reading_kwh', models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)),
                ('reading_m3', models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)),
                ('recorded_at', models.DateTimeField(db_index=True)),
                ('source', models.CharField(
                    max_length=20, default='auto',
                    choices=[('auto', 'Auto-poll'), ('manual', 'Manual entry')],
                )),
                ('meter', models.ForeignKey(
                    to='utilities.smartmeter',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='readings',
                )),
            ],
            options={
                'ordering': ['recorded_at'],
                'indexes': [
                    models.Index(fields=['meter', 'recorded_at'], name='utilities_m_meter_i_idx'),
                ],
            },
        ),

        # -----------------------------------------------------------------
        # MeterOutageAlert
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='MeterOutageAlert',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('resolved_at', models.DateTimeField(null=True, blank=True)),
                ('notified', models.BooleanField(default=False)),
                ('meter', models.ForeignKey(
                    to='utilities.smartmeter',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='outage_alerts',
                )),
            ],
            options={
                'ordering': ['-started_at'],
            },
        ),

        # -----------------------------------------------------------------
        # UtilityWallet
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='UtilityWallet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('balance', models.DecimalField(max_digits=10, decimal_places=2, default=0.00)),
                ('low_balance_threshold', models.DecimalField(max_digits=8, decimal_places=2, default=10.00)),
                ('auto_deduct_enabled', models.BooleanField(default=False)),
                ('last_low_balance_alert', models.DateTimeField(null=True, blank=True)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='utility_wallets',
                )),
                ('member', models.ForeignKey(
                    to='members.member',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='utility_wallets',
                )),
            ],
            options={
                'unique_together': {('marina', 'member')},
            },
        ),

        # -----------------------------------------------------------------
        # UtilityWalletTransaction
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='UtilityWalletTransaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tx_type', models.CharField(
                    max_length=20,
                    choices=[
                        ('top_up',     'Top-up (Portal)'),
                        ('staff_load', 'Staff Load (Office)'),
                        ('deduction',  'Charge Deduction'),
                        ('refund',     'Refund'),
                    ],
                )),
                ('amount', models.DecimalField(max_digits=10, decimal_places=2)),
                ('balance_after', models.DecimalField(max_digits=10, decimal_places=2)),
                ('description', models.CharField(max_length=300, blank=True)),
                ('stripe_payment_intent', models.CharField(max_length=100, blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('wallet', models.ForeignKey(
                    to='utilities.utilitywallet',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='transactions',
                )),
                ('invoice_line', models.ForeignKey(
                    to='billing.invoicelineitem',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='wallet_deductions',
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),

        # -----------------------------------------------------------------
        # ServiceBollard
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='ServiceBollard',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=100)),
                ('max_amps', models.IntegerField(default=16)),
                ('voltage', models.IntegerField(default=230)),
                ('has_remote_switch', models.BooleanField(default=False)),
                ('vendor', models.CharField(max_length=20, blank=True)),
                ('vendor_device_id', models.CharField(max_length=100, blank=True)),
                ('status', models.CharField(
                    max_length=20,
                    choices=[
                        ('active',    'Active'),
                        ('fault',     'Fault — Power Unavailable'),
                        ('suspended', 'Suspended (Account)'),
                        ('offline',   'Offline / Decommissioned'),
                    ],
                    default='active',
                )),
                ('notes', models.TextField(blank=True)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='service_bollards',
                )),
                ('berth', models.ForeignKey(
                    to='berths.berth',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='service_bollards',
                )),
                ('smart_meter', models.ForeignKey(
                    to='utilities.smartmeter',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='bollards',
                )),
            ],
            options={
                'ordering': ['label'],
                'unique_together': {('marina', 'label')},
            },
        ),

        # -----------------------------------------------------------------
        # BollardFaultLog
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='BollardFaultLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fault_type', models.CharField(
                    max_length=30,
                    choices=[
                        ('supply_failure',   'Supply Failure'),
                        ('overcurrent_trip', 'Overcurrent Trip'),
                        ('comms_error',      'Communications Error'),
                        ('other',            'Other'),
                    ],
                )),
                ('description', models.TextField(blank=True)),
                ('reported_at', models.DateTimeField(auto_now_add=True)),
                ('resolved_at', models.DateTimeField(null=True, blank=True)),
                ('bollard', models.ForeignKey(
                    to='utilities.servicebollard',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='fault_logs',
                )),
                ('work_order', models.ForeignKey(
                    to='boatyard.workorder',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='bollard_faults',
                )),
            ],
            options={
                'ordering': ['-reported_at'],
            },
        ),

        # -----------------------------------------------------------------
        # BollardSwitchEvent
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='BollardSwitchEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(
                    max_length=5,
                    choices=[('on', 'Power On'), ('off', 'Power Off')],
                )),
                ('reason', models.CharField(max_length=300, blank=True)),
                ('success', models.BooleanField(default=True)),
                ('vendor_response', models.JSONField(default=dict, blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('bollard', models.ForeignKey(
                    to='utilities.servicebollard',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='switch_events',
                )),
                ('triggered_by', models.ForeignKey(
                    to=settings.AUTH_USER_MODEL,
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),

        # -----------------------------------------------------------------
        # WashToken
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='WashToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('facility', models.CharField(
                    max_length=20,
                    choices=[
                        ('shower',  'Shower'),
                        ('laundry', 'Laundry'),
                        ('carwash', 'Car Wash'),
                    ],
                )),
                ('token_code', models.CharField(
                    max_length=20, db_index=True,
                    help_text='6-digit alphanumeric PIN. Unique within marina; NOT globally unique.',
                )),
                ('status', models.CharField(
                    max_length=20,
                    choices=[
                        ('issued',   'Issued'),
                        ('redeemed', 'Redeemed'),
                        ('expired',  'Expired'),
                        ('voided',   'Voided'),
                    ],
                    default='issued',
                )),
                ('expires_at', models.DateTimeField(null=True, blank=True)),
                ('issued_at', models.DateTimeField(auto_now_add=True)),
                ('redeemed_at', models.DateTimeField(null=True, blank=True)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='wash_tokens',
                )),
                ('member', models.ForeignKey(
                    to='members.member',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='wash_tokens',
                )),
                ('invoice_line', models.ForeignKey(
                    to='billing.invoicelineitem',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='wash_tokens',
                )),
                ('chargeable_item', models.ForeignKey(
                    to='billing.chargeableitem',
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='wash_tokens',
                )),
            ],
            options={
                'ordering': ['-issued_at'],
                'unique_together': {('marina', 'token_code')},
            },
        ),
    ]
