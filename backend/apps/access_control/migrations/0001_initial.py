"""
Track 11 initial migration — all 13 models.

Prerequisites that must be migrated first:
  - berths 0028_berth_pier_label  (adds Berth.pier_label)
  - billing Invoice (already exists)
  - staff StaffMember (already exists)
  - fuel_dock 0003_fueldockentry_is_internal_use (so FK compiles; not a hard dep here)
"""

import django.db.models.deletion
from django.db import migrations, models

import apps.accounting.fields


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0016_remove_marina_channel_fields'),
        ('berths',   '0028_berth_pier_label'),
        ('billing',  '0001_initial'),
        ('fuel_dock','0003_fueldockentry_is_internal_use'),
        ('members',  '0001_initial'),
        ('staff',    '0001_initial'),
    ]

    operations = [
        # ------------------------------------------------------------------
        # AccessZone
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='AccessZone',
            fields=[
                ('id',           models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name',         models.CharField(max_length=100)),
                ('description',  models.CharField(blank=True, max_length=300)),
                ('is_restricted',models.BooleanField(default=False)),
                ('marina',       models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='access_zones', to='accounts.marina')),
            ],
            options={'ordering': ['name'], 'unique_together': {('marina', 'name')}},
        ),

        # ------------------------------------------------------------------
        # AccessReader
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='AccessReader',
            fields=[
                ('id',             models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reader_uid',     models.CharField(max_length=100)),
                ('location_label', models.CharField(max_length=200)),
                ('hardware_type',  models.CharField(choices=[('rfid','RFID/NFC Reader'),('anpr','ANPR Camera'),('biometric','Biometric Terminal'),('keypad','PIN Keypad')], default='rfid', max_length=20)),
                ('ip_address',     models.GenericIPAddressField(blank=True, null=True)),
                ('last_heartbeat', models.DateTimeField(blank=True, null=True)),
                ('is_active',      models.BooleanField(default=True)),
                ('notes',          models.TextField(blank=True)),
                ('marina',         models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='access_readers', to='accounts.marina')),
                ('zone',           models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='readers', to='access_control.accesszone')),
            ],
            options={'unique_together': {('marina', 'reader_uid')}},
        ),

        # ------------------------------------------------------------------
        # ZoneAccessRule
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='ZoneAccessRule',
            fields=[
                ('id',                 models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('member_type',        models.CharField(choices=[('seasonal','Seasonal'),('transient','Transient'),('associate','Associate')], max_length=20)),
                ('link_to_berth_pier', models.BooleanField(default=False, help_text="When True, ignore zones M2M. Instead check whether the member's active Booking/Contract berth pier_label matches the AccessZone name.")),
                ('allowed_piers',      models.JSONField(blank=True, default=list, help_text='Explicit pier label allow-list when link_to_berth_pier=True.')),
                ('marina',             models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='zone_rules', to='accounts.marina')),
                ('zones',              models.ManyToManyField(blank=True, related_name='rules', to='access_control.accesszone')),
            ],
            options={'unique_together': {('marina', 'member_type')}},
        ),

        # ------------------------------------------------------------------
        # CCTVCamera (before AccessEvent which M2Ms it)
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='CCTVCamera',
            fields=[
                ('id',                  models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('camera_uid',          models.CharField(max_length=100)),
                ('location_label',      models.CharField(max_length=200)),
                ('nvr_ip',              models.GenericIPAddressField(blank=True, null=True)),
                ('nvr_channel',         models.IntegerField(blank=True, null=True)),
                ('viewer_url_template', models.CharField(blank=True, help_text='URL template. Use {timestamp_iso} and {camera_uid} as placeholders.', max_length=500)),
                ('is_active',           models.BooleanField(default=True)),
                ('marina',              models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='cctv_cameras', to='accounts.marina')),
                ('zone',                models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='cctv_cameras', to='access_control.accesszone')),
            ],
            options={'unique_together': {('marina', 'camera_uid')}},
        ),

        # ------------------------------------------------------------------
        # AccessCard
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='AccessCard',
            fields=[
                ('id',                  models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('card_uid',            models.CharField(max_length=100)),
                ('facility_code',       models.CharField(blank=True, max_length=20)),
                ('label',               models.CharField(blank=True, max_length=100)),
                ('sub_type',            models.CharField(choices=[('owner','Owner'),('crew','Crew'),('family','Family'),('contractor','Contractor')], default='owner', max_length=20)),
                ('is_active',           models.BooleanField(default=False)),
                ('valid_from',          models.DateField(blank=True, null=True)),
                ('valid_to',            models.DateField(blank=True, null=True)),
                ('issued_at',           models.DateTimeField(auto_now_add=True)),
                ('deactivated_at',      models.DateTimeField(blank=True, null=True)),
                ('deactivation_reason', models.CharField(blank=True, max_length=200)),
                ('marina',              models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='access_cards', to='accounts.marina')),
                ('member',              models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='access_cards', to='members.member')),
                ('zones_override',      models.ManyToManyField(blank=True, help_text='If set, overrides ZoneAccessRule for this card only.', related_name='card_overrides', to='access_control.accesszone')),
            ],
        ),
        migrations.AddConstraint(
            model_name='accesscard',
            constraint=models.UniqueConstraint(
                condition=models.Q(is_active=True),
                fields=['marina', 'card_uid'],
                name='unique_active_card_uid_per_marina',
            ),
        ),

        # ------------------------------------------------------------------
        # AccessEvent
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='AccessEvent',
            fields=[
                ('id',              models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('credential_type', models.CharField(choices=[('card','RFID Card'),('face','Biometric Face'),('anpr','ANPR Plate'),('pin','PIN Code')], max_length=10)),
                ('raw_credential',  models.CharField(blank=True, help_text="Card UID, plate string, or 'biometric'. Never raw biometric data.", max_length=100)),
                ('granted',         models.BooleanField()),
                ('denial_reason',   models.CharField(blank=True, max_length=200)),
                ('occurred_at',     models.DateTimeField(db_index=True)),
                ('card',            models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='events', to='access_control.accesscard')),
                ('cctv_cameras',    models.ManyToManyField(blank=True, related_name='access_events', to='access_control.cctvcamera')),
                ('marina',          models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='access_events', to='accounts.marina')),
                ('member',          models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='access_events', to='members.member')),
                ('reader',          models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='events', to='access_control.accessreader')),
            ],
            options={'ordering': ['-occurred_at']},
        ),
        migrations.AddIndex(
            model_name='accessevent',
            index=models.Index(fields=['marina', 'occurred_at'], name='ac_event_marina_occurred_idx'),
        ),
        migrations.AddIndex(
            model_name='accessevent',
            index=models.Index(fields=['marina', 'member', 'occurred_at'], name='ac_event_marina_member_idx'),
        ),
        migrations.AddIndex(
            model_name='accessevent',
            index=models.Index(fields=['marina', 'reader', 'occurred_at'], name='ac_event_marina_reader_idx'),
        ),

        # ------------------------------------------------------------------
        # ANPRCamera
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='ANPRCamera',
            fields=[
                ('id',             models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('camera_uid',     models.CharField(max_length=100)),
                ('location_label', models.CharField(max_length=200)),
                ('ip_address',     models.GenericIPAddressField(blank=True, null=True)),
                ('last_frame_at',  models.DateTimeField(blank=True, null=True)),
                ('is_active',      models.BooleanField(default=True)),
                ('marina',         models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='anpr_cameras', to='accounts.marina')),
                ('zone',           models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='anpr_cameras', to='access_control.accesszone')),
            ],
            options={'unique_together': {('marina', 'camera_uid')}},
        ),

        # ------------------------------------------------------------------
        # VehicleRegistration
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='VehicleRegistration',
            fields=[
                ('id',            models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('plate_number',  models.CharField(max_length=20)),
                ('make',          models.CharField(blank=True, max_length=100)),
                ('model',         models.CharField(blank=True, max_length=100)),
                ('colour',        models.CharField(blank=True, max_length=50)),
                ('is_active',     models.BooleanField(default=True)),
                ('registered_at', models.DateTimeField(auto_now_add=True)),
                ('marina',        models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='vehicle_registrations', to='accounts.marina')),
                ('member',        models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='vehicles', to='members.member')),
            ],
            options={'unique_together': {('marina', 'plate_number')}},
        ),

        # ------------------------------------------------------------------
        # ANPREvent
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='ANPREvent',
            fields=[
                ('id',             models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('plate_detected', models.CharField(max_length=20)),
                ('access_granted', models.BooleanField()),
                ('confidence',     models.FloatField(default=1.0)),
                ('occurred_at',    models.DateTimeField(db_index=True)),
                ('staff_reviewed', models.BooleanField(default=False)),
                ('camera',         models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='events', to='access_control.anprcamera')),
                ('marina',         models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='anpr_events', to='accounts.marina')),
                ('matched_member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='anpr_events', to='members.member')),
                ('staff_reviewer', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='reviewed_anpr_events', to='staff.staffmember')),
                ('vehicle',        models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='anpr_events', to='access_control.vehicleregistration')),
            ],
            options={'ordering': ['-occurred_at']},
        ),
        migrations.AddIndex(
            model_name='anprevent',
            index=models.Index(fields=['marina', 'occurred_at'], name='anpr_event_marina_occurred_idx'),
        ),
        migrations.AddIndex(
            model_name='anprevent',
            index=models.Index(fields=['marina', 'plate_detected'], name='anpr_event_plate_idx'),
        ),

        # ------------------------------------------------------------------
        # BiometricEnrolment
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='BiometricEnrolment',
            fields=[
                ('id',                     models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('subject_type',           models.CharField(choices=[('member','Member'),('staff','Staff')], max_length=10)),
                ('terminal_uid',           models.CharField(max_length=100)),
                ('template_handle',        apps.accounting.fields.EncryptedCharField(max_length=500)),
                ('consent_given_at',       models.DateTimeField()),
                ('consent_ip',             models.GenericIPAddressField(blank=True, null=True)),
                ('consent_method',         models.CharField(choices=[('portal','Boater Portal'),('staff_app','Staff App'),('admin','Admin UI')], max_length=20)),
                ('enrolled_at',            models.DateTimeField(auto_now_add=True)),
                ('revoked_at',             models.DateTimeField(blank=True, null=True)),
                ('pending_deletion',       models.BooleanField(default=False, help_text='Set True immediately on DELETE. Hidden from all UI via default manager.')),
                ('pending_deletion_since', models.DateTimeField(blank=True, help_text='Timestamp of DELETE request. Task escalates after 24h stall.', null=True)),
                ('marina',                 models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='biometric_enrolments', to='accounts.marina')),
                ('member',                 models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='biometric_enrolment', to='members.member')),
                ('staff_member',           models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='biometric_enrolment', to='staff.staffmember')),
            ],
        ),
        migrations.AddConstraint(
            model_name='biometricenrolment',
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(subject_type='member', member__isnull=False, staff_member__isnull=True) |
                    models.Q(subject_type='staff',  staff_member__isnull=False, member__isnull=True)
                ),
                name='biometric_enrolment_subject_consistency',
            ),
        ),

        # ------------------------------------------------------------------
        # SpendAuthorisationRule
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='SpendAuthorisationRule',
            fields=[
                ('id',                     models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role',                   models.CharField(choices=[('staff','Staff'),('manager','Manager'),('owner','Owner')], max_length=20)),
                ('action_type',            models.CharField(choices=[('discount','Discount'),('write_off','Write-off'),('refund','Refund'),('override','Price Override')], max_length=20)),
                ('threshold_amount',       models.DecimalField(decimal_places=2, max_digits=10)),
                ('requires_approver_role', models.CharField(choices=[('manager','Manager'),('owner','Owner')], max_length=20)),
                ('marina',                 models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='spend_rules', to='accounts.marina')),
            ],
            options={'unique_together': {('marina', 'role', 'action_type')}},
        ),

        # ------------------------------------------------------------------
        # FraudAnomalyAlert (before SpendAuthorisationRequest)
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='FraudAnomalyAlert',
            fields=[
                ('id',                 models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('alert_type',         models.CharField(choices=[('repeated_discount','Repeated Discounts'),('large_write_off','Large Write-off'),('unusual_refund','Unusual Refund Pattern'),('after_hours_sale','After-hours Sale'),('forced_override','Force-approved spend — retrospective sign-off required'),('biometric_deletion_stalled','Biometric terminal unreachable — GDPR deletion pending > 24 h'),('duplicate_card','Duplicate Active Card Detected'),('unusual_spend','Unusual Spend Pattern')], max_length=30)),
                ('period_start',       models.DateTimeField()),
                ('period_end',         models.DateTimeField()),
                ('event_count',        models.IntegerField()),
                ('total_amount',       models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('threshold_exceeded', models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ('sent_at',            models.DateTimeField(auto_now_add=True)),
                ('resolved_at',        models.DateTimeField(blank=True, null=True)),
                ('resolution_note',    models.TextField(blank=True)),
                ('marina',             models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='fraud_alerts', to='accounts.marina')),
                ('resolved_by',        models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='resolved_fraud_alerts', to='staff.staffmember')),
                ('staff_member',       models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='fraud_alerts', to='staff.staffmember')),
            ],
            options={'ordering': ['-sent_at']},
        ),

        # ------------------------------------------------------------------
        # SpendAuthorisationRequest
        # ------------------------------------------------------------------
        migrations.CreateModel(
            name='SpendAuthorisationRequest',
            fields=[
                ('id',                  models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action_type',         models.CharField(choices=[('discount','Discount'),('write_off','Write-off'),('refund','Refund'),('override','Price Override')], max_length=20)),
                ('amount',              models.DecimalField(decimal_places=2, max_digits=10)),
                ('description',         models.TextField()),
                ('status',              models.CharField(choices=[('pending','Pending — POS terminal blocked'),('suspended','Parked — terminal freed, awaiting manager'),('overridden','Force-approved by staff — retrospective sign-off required'),('approved','Approved'),('denied','Denied'),('expired','Expired')], default='pending', max_length=12)),
                ('requested_at',        models.DateTimeField(auto_now_add=True)),
                ('actioned_at',         models.DateTimeField(blank=True, null=True)),
                ('approver_note',       models.TextField(blank=True)),
                ('suspended_at',        models.DateTimeField(blank=True, null=True)),
                ('override_forced_at',  models.DateTimeField(blank=True, null=True)),
                ('approver',            models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='spend_requests_actioned', to='staff.staffmember')),
                ('fuel_dock_entry',     models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='spend_requests', to='fuel_dock.fueldockentry')),
                ('invoice',             models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='spend_requests', to='billing.invoice')),
                ('marina',              models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='spend_requests', to='accounts.marina')),
                ('override_forced_by',  models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='forced_spend_overrides', to='staff.staffmember')),
                ('override_fraud_alert',models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='spend_override_request', to='access_control.fraudanomalyalert')),
                ('requested_by',        models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='spend_requests_made', to='staff.staffmember')),
                ('rule',                models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='requests', to='access_control.spendauthorisationrule')),
            ],
            options={'ordering': ['-requested_at']},
        ),
        migrations.AddConstraint(
            model_name='spendauthorisationrequest',
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(invoice__isnull=False) |
                    models.Q(fuel_dock_entry__isnull=False)
                ),
                name='spend_auth_requires_financial_reference',
            ),
        ),
    ]
