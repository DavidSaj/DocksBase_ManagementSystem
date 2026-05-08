import django.contrib.postgres.constraints
import django.contrib.postgres.fields
import django.db.models.deletion
from django.contrib.postgres.fields import RangeOperators
from django.db import migrations, models


def _enable_btree_gist(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('CREATE EXTENSION IF NOT EXISTS btree_gist;')


def _create_asset_reservation(apps, schema_editor):
    """PostgreSQL-only: creates the tstzrange column and exclusion constraint."""
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(
        'CREATE TABLE IF NOT EXISTS activities_assetreservation ('
        '  id bigserial PRIMARY KEY,'
        '  time_range tstzrange NOT NULL,'
        '  activity_booking_id bigint NOT NULL REFERENCES activities_activitybooking(id) ON DELETE CASCADE,'
        '  asset_id bigint NOT NULL REFERENCES maintenance_asset(id) ON DELETE CASCADE,'
        '  marina_id bigint NOT NULL REFERENCES accounts_marina(id) ON DELETE CASCADE'
        ');'
    )
    schema_editor.execute(
        'CREATE INDEX IF NOT EXISTS activities_assetres_asset_idx'
        ' ON activities_assetreservation (asset_id);'
    )
    schema_editor.execute(
        'ALTER TABLE activities_assetreservation'
        ' ADD CONSTRAINT prevent_asset_double_booking'
        ' EXCLUDE USING gist (asset_id WITH =, time_range WITH &&);'
    )


def _drop_asset_reservation(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('DROP TABLE IF EXISTS activities_assetreservation;')


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0002_marina_operations_paused'),
        ('billing', '0012_chargeableitem_is_discountable_and_more'),
        ('maintenance', '0004_maintenancetask'),
        ('members', '0003_alter_member_options_alter_segment_options'),
        ('staff', '0001_initial'),
    ]

    operations = [
        # btree_gist is required for ExclusionConstraint on non-geometric types
        # (DateTimeRangeField). Only runs on PostgreSQL — no-op on SQLite (dev).
        migrations.RunPython(_enable_btree_gist, migrations.RunPython.noop),
        migrations.CreateModel(
            name='CancellationPolicy',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('full_refund_hours', models.PositiveIntegerField(default=48)),
                ('partial_refund_hours', models.PositiveIntegerField(default=24)),
                ('partial_refund_pct', models.DecimalField(decimal_places=2, default=50, max_digits=5)),
                ('is_default', models.BooleanField(default=False)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='cancellation_policies', to='accounts.marina')),
            ],
        ),
        migrations.CreateModel(
            name='Activity',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('category', models.CharField(choices=[('water_sport', 'Water Sport'), ('lesson', 'Lesson / Course'), ('equipment', 'Equipment Hire'), ('guided_trip', 'Guided Trip'), ('wellness', 'Wellness'), ('other', 'Other')], default='other', max_length=30)),
                ('duration_minutes', models.PositiveIntegerField()),
                ('capacity_min', models.PositiveIntegerField(default=1)),
                ('capacity_max', models.PositiveIntegerField()),
                ('min_age', models.PositiveIntegerField(default=0)),
                ('photo', models.ImageField(blank=True, null=True, upload_to='activities/photos/')),
                ('is_active', models.BooleanField(default=True)),
                ('season_start', models.DateField(blank=True, null=True)),
                ('season_end', models.DateField(blank=True, null=True)),
                ('group_discount_threshold', models.PositiveIntegerField(blank=True, null=True)),
                ('group_discount_pct', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('cancellation_policy', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='activities', to='activities.cancellationpolicy')),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='activities', to='accounts.marina')),
            ],
        ),
        migrations.CreateModel(
            name='ActivityPricingRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('customer_type', models.CharField(choices=[('member', 'Member'), ('guest', 'Guest'), ('child', 'Child')], max_length=20)),
                ('activity', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pricing_rules', to='activities.activity')),
                ('chargeable_item', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='activity_pricing_rules', to='billing.chargeableitem')),
            ],
            options={
                'unique_together': {('activity', 'customer_type')},
            },
        ),
        migrations.CreateModel(
            name='ActivityResourceRequirement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('resource_type', models.CharField(choices=[('instructor', 'Instructor (Staff)'), ('asset', 'Equipment Asset')], max_length=20)),
                ('required_role', models.CharField(blank=True, max_length=100)),
                ('quantity_required', models.PositiveIntegerField(default=1)),
                ('activity', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='resource_requirements', to='activities.activity')),
                ('asset', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='activity_requirements', to='maintenance.asset')),
                ('staff_member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='activity_requirements', to='staff.staffmember')),
            ],
        ),
        migrations.CreateModel(
            name='ActivityExtra',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('is_active', models.BooleanField(default=True)),
                ('activity', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='extras', to='activities.activity')),
                ('chargeable_item', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='activity_extras', to='billing.chargeableitem')),
            ],
        ),
        migrations.CreateModel(
            name='ActivityBooking',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('lead_name', models.CharField(blank=True, max_length=200)),
                ('lead_email', models.EmailField(blank=True)),
                ('lead_phone', models.CharField(blank=True, max_length=30)),
                ('start_datetime', models.DateTimeField()),
                ('end_datetime', models.DateTimeField()),
                ('participant_count', models.PositiveIntegerField(default=1)),
                ('status', models.CharField(choices=[('confirmed', 'Confirmed'), ('cancelled', 'Cancelled'), ('completed', 'Completed'), ('no_show', 'No Show')], default='confirmed', max_length=20)),
                ('payment_mode', models.CharField(choices=[('berth_invoice', 'Add to Berth Invoice'), ('direct', 'Direct Payment')], default='direct', max_length=20)),
                ('season_override', models.BooleanField(default=False)),
                ('cancelled_at', models.DateTimeField(blank=True, null=True)),
                ('cancellation_reason', models.TextField(blank=True)),
                ('refund_amount', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('expires_at', models.DateTimeField(blank=True, help_text='TTL for direct-payment bookings. Sweep task cancels and releases assets on expiry.', null=True)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('activity', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='bookings', to='activities.activity')),
                ('assigned_instructor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='activity_bookings', to='staff.staffmember')),
                ('invoice', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='activity_bookings', to='billing.invoice')),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='activity_bookings', to='accounts.marina')),
                ('member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='members.member')),
            ],
            options={
                'ordering': ['start_datetime'],
            },
        ),
        migrations.CreateModel(
            name='ActivityBookingParticipant',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(blank=True, max_length=200)),
                ('age', models.PositiveIntegerField(blank=True, null=True)),
                ('customer_type', models.CharField(choices=[('member', 'Member'), ('guest', 'Guest'), ('child', 'Child')], default='guest', max_length=20)),
                ('booking', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='participants', to='activities.activitybooking')),
            ],
        ),
        migrations.CreateModel(
            name='ActivityBookingExtra',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('quantity', models.PositiveIntegerField(default=1)),
                ('booking', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='booking_extras', to='activities.activitybooking')),
                ('extra', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='activities.activityextra')),
            ],
        ),
        # AssetReservation uses DateTimeRangeField + ExclusionConstraint — PostgreSQL only.
        # SeparateDatabaseAndState keeps Django's model state consistent on SQLite (dev)
        # while the RunPython below handles the actual DB work on PostgreSQL (prod).
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='AssetReservation',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('time_range', django.contrib.postgres.fields.DateTimeRangeField(help_text='Reservation window [start, end). Derived from ActivityBooking.start/end.')),
                        ('activity_booking', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='asset_reservations', to='activities.activitybooking')),
                        ('asset', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reservations', to='maintenance.asset')),
                        ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='asset_reservations', to='accounts.marina')),
                    ],
                ),
                migrations.AddIndex(
                    model_name='assetreservation',
                    index=models.Index(fields=['asset'], name='activities_assetres_asset_idx'),
                ),
                migrations.AddConstraint(
                    model_name='assetreservation',
                    constraint=django.contrib.postgres.constraints.ExclusionConstraint(
                        expressions=[
                            ('asset', RangeOperators.EQUAL),
                            ('time_range', RangeOperators.OVERLAPS),
                        ],
                        name='prevent_asset_double_booking',
                    ),
                ),
            ],
            database_operations=[
                migrations.RunPython(_create_asset_reservation, _drop_asset_reservation),
            ],
        ),
    ]
