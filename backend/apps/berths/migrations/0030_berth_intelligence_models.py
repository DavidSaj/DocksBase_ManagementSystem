from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def create_default_score_weights(apps, schema_editor):
    """Create a BerthScoreWeights row for every existing marina."""
    Marina = apps.get_model('accounts', 'Marina')
    BerthScoreWeights = apps.get_model('berths', 'BerthScoreWeights')
    for marina in Marina.objects.all():
        BerthScoreWeights.objects.get_or_create(marina=marina)


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0017_marina_berth_intelligence_fields'),
        ('berths', '0029_berth_air_draft'),
        ('members', '0005_member_sublet_opt_in'),
        ('reservations', '0012_booking_track2_fields'),
        ('vessels', '0004_alter_vessel_options_alter_vesselcertificate_options'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ── BerthScoreWeights ─────────────────────────────────────────────────
        migrations.CreateModel(
            name='BerthScoreWeights',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('w_size_fit', models.IntegerField(default=40)),
                ('w_gap_min', models.IntegerField(default=25)),
                ('w_amenity_match', models.IntegerField(default=20)),
                ('w_pier_cluster', models.IntegerField(default=15)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('marina', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='score_weights',
                    to='accounts.marina',
                )),
            ],
        ),

        # ── BerthAlert ────────────────────────────────────────────────────────
        # Must be created before TemporaryDeparture (which is FK'd from BerthAlert)
        # and before DockWalkEntry (which references BerthAlert).
        migrations.CreateModel(
            name='BerthAlert',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('alert_type', models.CharField(choices=[
                    ('unexpected_empty', 'Unexpected Empty Berth'),
                    ('unexpected_vessel', 'Unexpected Vessel in Berth'),
                    ('overstay', 'Overstay'),
                    ('non_return', 'Vessel Non-Return'),
                    ('meter_anomaly', 'Meter Reading Anomaly'),
                ], max_length=30)),
                ('status', models.CharField(choices=[
                    ('open', 'Open'),
                    ('critical', 'Critical'),
                    ('resolved', 'Resolved'),
                    ('escalated', 'Escalated'),
                ], default='open', max_length=20)),
                ('detail', models.TextField(blank=True)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('coastguard_report_text', models.TextField(blank=True)),
                ('coastguard_escalated_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='berth_alerts', to='accounts.marina')),
                ('berth', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='alerts', to='berths.berth')),
                ('vessel', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='berth_alerts', to='vessels.vessel')),
                ('resolved_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='resolved_alerts', to=settings.AUTH_USER_MODEL)),
                ('coastguard_escalated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='coastguard_escalations', to=settings.AUTH_USER_MODEL)),
                # departure FK added after TemporaryDeparture is created (see AddField below)
            ],
            options={'ordering': ['-created_at']},
        ),

        # ── TemporaryDeparture ────────────────────────────────────────────────
        migrations.CreateModel(
            name='TemporaryDeparture',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('depart_date', models.DateField()),
                ('expected_return', models.DateField()),
                ('actual_return', models.DateField(blank=True, null=True)),
                ('status', models.CharField(choices=[
                    ('scheduled', 'Scheduled'),
                    ('active', 'Active'),
                    ('returned', 'Returned'),
                    ('cancelled', 'Cancelled'),
                ], default='scheduled', max_length=20)),
                ('sublet_enabled', models.BooleanField(default=False)),
                ('revenue_share_pct', models.DecimalField(decimal_places=2, default=50, max_digits=5)),
                ('departure_heading', models.CharField(blank=True, max_length=100)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='temporary_departures', to='accounts.marina')),
                ('berth', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='temporary_departures', to='berths.berth')),
                ('vessel', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='temporary_departures', to='vessels.vessel')),
                ('member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='temporary_departures', to='members.member')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_departures', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-depart_date']},
        ),

        # Now wire BerthAlert.departure -> TemporaryDeparture
        migrations.AddField(
            model_name='berthalert',
            name='departure',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='alerts',
                to='berths.temporarydeparture',
            ),
        ),

        # ── SubLetBooking ─────────────────────────────────────────────────────
        migrations.CreateModel(
            name='SubLetBooking',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('total_revenue', models.DecimalField(decimal_places=2, max_digits=10)),
                ('holder_share', models.DecimalField(decimal_places=2, max_digits=10)),
                ('marina_share', models.DecimalField(decimal_places=2, max_digits=10)),
                ('credit_invoice_id', models.IntegerField(blank=True, null=True)),
                ('credit_applied_at', models.DateTimeField(blank=True, null=True)),
                ('inventory_collision', models.BooleanField(default=False)),
                ('actual_nights_sublet', models.IntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sublet_bookings', to='accounts.marina')),
                ('departure', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='sublet_bookings', to='berths.temporarydeparture')),
                ('booking', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name='sublet_record', to='reservations.booking')),
                ('relocation_booking', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='relocated_from_sublet', to='reservations.booking')),
            ],
        ),

        # ── FleetAssignJob ────────────────────────────────────────────────────
        migrations.CreateModel(
            name='FleetAssignJob',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[
                    ('pending', 'Pending'),
                    ('processing', 'Processing'),
                    ('complete', 'Complete'),
                    ('failed', 'Failed'),
                ], default='pending', max_length=20)),
                ('request_payload', models.JSONField()),
                ('result_payload', models.JSONField(blank=True, null=True)),
                ('celery_task_id', models.CharField(blank=True, max_length=100)),
                ('error_detail', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='fleet_assign_jobs', to='accounts.marina')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='fleet_assign_jobs', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),

        # ── DockWalkSession ───────────────────────────────────────────────────
        migrations.CreateModel(
            name='DockWalkSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('started_at', models.DateTimeField()),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('berth_order', models.JSONField(default=list)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dock_walk_sessions', to='accounts.marina')),
                ('pier', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='dock_walk_sessions', to='berths.logicalpier')),
                ('walked_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='dock_walks', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-started_at']},
        ),

        # ── DockWalkEntry ─────────────────────────────────────────────────────
        migrations.CreateModel(
            name='DockWalkEntry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('observed_occupancy', models.CharField(choices=[
                    ('occupied', 'Occupied'),
                    ('empty', 'Empty'),
                    ('unknown', 'Unknown'),
                ], max_length=20)),
                ('discrepancy', models.CharField(choices=[
                    ('none', 'None'),
                    ('unexpected_empty', 'Unexpected Empty'),
                    ('unexpected_vessel', 'Unexpected Vessel'),
                    ('overstay', 'Overstay'),
                ], default='none', max_length=25)),
                ('electric_reading_kwh', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('water_reading_litres', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('notes', models.TextField(blank=True)),
                ('photo', models.ImageField(blank=True, null=True, upload_to='dock_walk/')),
                ('observed_at', models.DateTimeField()),
                ('synced_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dock_walk_entries', to='accounts.marina')),
                ('session', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='entries', to='berths.dockwalksession')),
                ('berth', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='dock_walk_entries', to='berths.berth')),
                ('alert', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='dock_walk_entries', to='berths.berthalert')),
            ],
            options={'ordering': ['session', 'berth__position_index'], 'unique_together': {('session', 'berth')}},
        ),

        # ── BerthListing ──────────────────────────────────────────────────────
        migrations.CreateModel(
            name='BerthListing',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('asking_price', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('licence_terms', models.TextField(blank=True)),
                ('description', models.TextField(blank=True)),
                ('status', models.CharField(choices=[
                    ('active', 'Active'),
                    ('under_offer', 'Under Offer'),
                    ('sold', 'Sold'),
                    ('withdrawn', 'Withdrawn'),
                ], default='active', max_length=20)),
                ('listed_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='berth_listings', to='accounts.marina')),
                ('berth', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='listing', to='berths.berth')),
                ('seller_member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='berth_listings', to='members.member')),
            ],
            options={'ordering': ['-listed_at']},
        ),

        # ── BerthListingEnquiry ───────────────────────────────────────────────
        migrations.CreateModel(
            name='BerthListingEnquiry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enquirer_name', models.CharField(blank=True, max_length=200)),
                ('enquirer_email', models.EmailField(blank=True)),
                ('enquirer_phone', models.CharField(blank=True, max_length=50)),
                ('message', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='berth_listing_enquiries', to='accounts.marina')),
                ('listing', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='enquiries', to='berths.berthlisting')),
                ('enquirer_member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='berth_enquiries', to='members.member')),
            ],
            options={'ordering': ['-created_at']},
        ),

        # ── Data migration: default BerthScoreWeights for all existing marinas ─
        migrations.RunPython(create_default_score_weights, migrations.RunPython.noop),
    ]
