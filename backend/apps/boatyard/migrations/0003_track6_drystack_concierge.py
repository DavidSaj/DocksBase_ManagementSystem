"""
Track 6 — Boatyard additions:
  - New fields on LaunchRequest (additive — no data loss)
  - ConciergeCatalogueItem
  - PickTicket, PickTicketLine
  - ForkliftDeviceToken
  - BatteryChargeRequest
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0018_marina_no_show_grace_minutes'),
        ('berths', '__first__'),
        ('billing', '__first__'),
        ('boatyard', '0002_alter_haulout_options_alter_part_options_and_more'),
        ('vessels', '__first__'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # -----------------------------------------------------------------
        # LaunchRequest — new fields
        # -----------------------------------------------------------------
        migrations.AddField(
            model_name='launchrequest',
            name='request_type',
            field=models.CharField(
                max_length=20,
                choices=[('launch', 'Launch'), ('retrieval', 'Retrieval')],
                default='launch',
            ),
        ),
        migrations.AddField(
            model_name='launchrequest',
            name='scheduled_for',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='launchrequest',
            name='confirmed_by_customer',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='launchrequest',
            name='confirmation_deadline',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='launchrequest',
            name='arrived_at',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='launchrequest',
            name='no_show',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='launchrequest',
            name='no_show_fee_line',
            field=models.ForeignKey(
                to='billing.invoicelineitem',
                on_delete=django.db.models.deletion.SET_NULL,
                null=True, blank=True,
                related_name='no_show_launch_requests',
            ),
        ),
        migrations.AddField(
            model_name='launchrequest',
            name='pick_ticket_complete',
            field=models.BooleanField(default=False),
        ),

        # -----------------------------------------------------------------
        # ConciergeCatalogueItem
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='ConciergeCatalogueItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('timing', models.CharField(
                    max_length=20,
                    choices=[
                        ('before_launch',   'Before Launch'),
                        ('after_retrieval', 'After Retrieval'),
                        ('at_pickup',       'At Customer Pick-up'),
                    ],
                    default='before_launch',
                )),
                ('estimated_minutes', models.IntegerField(default=15)),
                ('is_active', models.BooleanField(default=True)),
                ('sort_order', models.IntegerField(default=0)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='concierge_items',
                )),
                ('chargeable_item', models.ForeignKey(
                    to='billing.chargeableitem',
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='concierge_items',
                )),
            ],
            options={
                'ordering': ['sort_order', 'name'],
                'unique_together': {('marina', 'name')},
            },
        ),

        # -----------------------------------------------------------------
        # PickTicket
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='PickTicket',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(null=True, blank=True)),
                ('assigned_to', models.CharField(max_length=200, blank=True)),
                ('launch_request', models.OneToOneField(
                    to='boatyard.launchrequest',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='pick_ticket',
                )),
            ],
        ),

        # -----------------------------------------------------------------
        # PickTicketLine
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='PickTicketLine',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(
                    max_length=20,
                    choices=[
                        ('pending', 'Pending'),
                        ('done',    'Done'),
                        ('skipped', 'Skipped'),
                    ],
                    default='pending',
                )),
                ('completed_at', models.DateTimeField(null=True, blank=True)),
                ('notes', models.TextField(blank=True)),
                ('pick_ticket', models.ForeignKey(
                    to='boatyard.pickticket',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='lines',
                )),
                ('catalogue_item', models.ForeignKey(
                    to='boatyard.conciergecatalogueitem',
                    on_delete=django.db.models.deletion.PROTECT,
                )),
                ('invoice_line', models.ForeignKey(
                    to='billing.invoicelineitem',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='pick_ticket_lines',
                )),
            ],
            options={
                'ordering': ['catalogue_item__sort_order'],
            },
        ),

        # -----------------------------------------------------------------
        # ForkliftDeviceToken
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='ForkliftDeviceToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=100)),
                ('token', models.CharField(max_length=64, unique=True, db_index=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('last_used_at', models.DateTimeField(null=True, blank=True)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='forklift_device_tokens',
                )),
                ('created_by', models.ForeignKey(
                    to=settings.AUTH_USER_MODEL,
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                )),
            ],
            options={
                'ordering': ['label'],
            },
        ),

        # -----------------------------------------------------------------
        # BatteryChargeRequest
        # -----------------------------------------------------------------
        migrations.CreateModel(
            name='BatteryChargeRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(
                    max_length=20,
                    choices=[
                        ('queued',      'Queued'),
                        ('in_progress', 'Charging'),
                        ('complete',    'Complete'),
                        ('notified',    'Owner Notified'),
                    ],
                    default='queued',
                )),
                ('requested_at', models.DateTimeField(auto_now_add=True)),
                ('started_at', models.DateTimeField(null=True, blank=True)),
                ('completed_at', models.DateTimeField(null=True, blank=True)),
                ('notes', models.TextField(blank=True)),
                ('marina', models.ForeignKey(
                    to='accounts.marina',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='battery_charge_requests',
                )),
                ('vessel', models.ForeignKey(
                    to='vessels.vessel',
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='battery_charge_requests',
                )),
                ('storage_slot', models.ForeignKey(
                    to='boatyard.storageslot',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                )),
                ('invoice_line', models.ForeignKey(
                    to='billing.invoicelineitem',
                    on_delete=django.db.models.deletion.SET_NULL,
                    null=True, blank=True,
                    related_name='battery_charge_requests',
                )),
            ],
            options={
                'ordering': ['requested_at'],
            },
        ),
    ]
