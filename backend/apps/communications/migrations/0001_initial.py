from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0001_initial'),
        ('members', '0001_initial'),
        ('reservations', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='MessageLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('channel', models.CharField(choices=[('email', 'Email'), ('sms', 'SMS'), ('whatsapp', 'WhatsApp'), ('slack', 'Slack'), ('teams', 'Microsoft Teams'), ('push', 'Push Notification')], max_length=20)),
                ('direction', models.CharField(choices=[('outbound', 'Outbound'), ('inbound', 'Inbound')], default='outbound', max_length=20)),
                ('status', models.CharField(choices=[('queued', 'Queued'), ('sent', 'Sent'), ('delivered', 'Delivered'), ('opened', 'Opened'), ('clicked', 'Clicked'), ('failed', 'Failed'), ('bounced', 'Bounced')], default='queued', max_length=20)),
                ('recipient', models.CharField(max_length=500)),
                ('subject', models.CharField(blank=True, max_length=500)),
                ('body', models.TextField(blank=True)),
                ('provider_message_id', models.CharField(blank=True, max_length=500)),
                ('failed_reason', models.TextField(blank=True)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='message_logs', to='accounts.marina')),
                ('member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='message_logs', to='members.member')),
                ('booking', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='message_logs', to='reservations.booking')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='WhatsAppTemplate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('meta_name', models.CharField(max_length=200)),
                ('language_code', models.CharField(default='en', max_length=10)),
                ('body_text', models.TextField()),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('pending', 'Pending Approval'), ('approved', 'Approved'), ('rejected', 'Rejected')], default='draft', max_length=20)),
                ('rejection_reason', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='whatsapp_templates', to='accounts.marina')),
            ],
            options={
                'ordering': ['meta_name'],
                'unique_together': {('marina', 'meta_name', 'language_code')},
            },
        ),
        migrations.CreateModel(
            name='Journey',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('trigger_event', models.CharField(choices=[('booking_confirmed', 'Booking Confirmed'), ('booking_checkout', 'Booking Checkout'), ('renewal_due', 'Renewal Due'), ('insurance_expiring', 'Insurance Expiring'), ('invoice_overdue', 'Invoice Overdue'), ('document_unsigned', 'Document Unsigned'), ('manual', 'Manual'), ('activity_booked', 'Activity Booked')], max_length=40)),
                ('is_active', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='journeys', to='accounts.marina')),
            ],
            options={
                'ordering': ['name'],
            },
        ),
        migrations.CreateModel(
            name='JourneyStep',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('order', models.IntegerField(default=0)),
                ('step_type', models.CharField(choices=[('action', 'Send Message'), ('gate', 'Condition Gate'), ('delay', 'Delay')], default='action', max_length=20)),
                ('channel', models.CharField(blank=True, choices=[('email', 'Email'), ('sms', 'SMS'), ('whatsapp', 'WhatsApp'), ('slack', 'Slack'), ('teams', 'Microsoft Teams')], max_length=20)),
                ('delay_value', models.IntegerField(default=0)),
                ('delay_unit', models.CharField(choices=[('minutes', 'Minutes'), ('hours', 'Hours'), ('days', 'Days')], default='hours', max_length=10)),
                ('condition_field', models.CharField(blank=True, choices=[('member_type', 'Member Type'), ('insurance_status', 'Insurance Status'), ('docs_status', 'Documents Status'), ('booking_status', 'Booking Status'), ('payment_status', 'Payment Status'), ('whatsapp_opt_in', 'WhatsApp Opt-In')], max_length=40)),
                ('condition_operator', models.CharField(blank=True, max_length=20)),
                ('condition_value', models.CharField(blank=True, max_length=200)),
                ('body_template', models.TextField(blank=True)),
                ('subject_template', models.CharField(blank=True, max_length=500)),
                ('journey', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='steps', to='communications.journey')),
                ('whatsapp_template', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='journey_steps', to='communications.whatsapptemplate')),
            ],
            options={
                'ordering': ['journey', 'order'],
                'unique_together': {('journey', 'order')},
            },
        ),
        migrations.AddField(
            model_name='messagelog',
            name='journey_step',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='message_logs', to='communications.journeystep'),
        ),
        migrations.CreateModel(
            name='JourneyEnrollment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('active', 'Active'), ('completed', 'Completed'), ('cancelled', 'Cancelled'), ('failed', 'Failed')], default='active', max_length=20)),
                ('current_step_order', models.IntegerField(default=0)),
                ('next_step_due_at', models.DateTimeField(blank=True, null=True)),
                ('enrolled_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('journey', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='enrollments', to='communications.journey')),
                ('member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='journey_enrollments', to='members.member')),
                ('booking', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='journey_enrollments', to='reservations.booking')),
            ],
            options={
                'ordering': ['-enrolled_at'],
            },
        ),
        migrations.CreateModel(
            name='JourneyStepLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('skipped', models.BooleanField(default=False)),
                ('gate_timed_out', models.BooleanField(default=False)),
                ('executed_at', models.DateTimeField(auto_now_add=True)),
                ('enrollment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='step_logs', to='communications.journeyenrollment')),
                ('journey_step', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='step_logs', to='communications.journeystep')),
                ('message_log', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='step_logs', to='communications.messagelog')),
            ],
            options={
                'ordering': ['executed_at'],
            },
        ),
        migrations.CreateModel(
            name='AlertRoute',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('platform', models.CharField(choices=[('slack', 'Slack'), ('teams', 'Microsoft Teams')], max_length=20)),
                ('alert_type', models.CharField(choices=[('new_booking', 'New Booking'), ('payment_failure', 'Payment Failure'), ('critical_defect', 'Critical Defect'), ('stock_low', 'Stock Low'), ('overstay', 'Overstay'), ('review_negative', 'Negative Review'), ('instructor_conflict', 'Instructor Conflict')], max_length=40)),
                ('webhook_url', models.URLField(max_length=1000)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='alert_routes', to='accounts.marina')),
            ],
            options={
                'ordering': ['marina', 'alert_type'],
                'unique_together': {('marina', 'platform', 'alert_type')},
            },
        ),
        migrations.CreateModel(
            name='DotdigitalConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('api_username', models.CharField(max_length=200)),
                ('api_password', models.CharField(max_length=500)),
                ('region', models.CharField(default='r1', max_length=10)),
                ('address_book_id', models.CharField(blank=True, max_length=100)),
                ('last_sync_at', models.DateTimeField(blank=True, null=True)),
                ('sync_enabled', models.BooleanField(default=False)),
                ('marina', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='dotdigital_config', to='accounts.marina')),
            ],
        ),
        migrations.CreateModel(
            name='DotdigitalSegmentMapping',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('dotdigital_book_id', models.CharField(max_length=100)),
                ('last_sync_at', models.DateTimeField(blank=True, null=True)),
                ('last_sync_count', models.IntegerField(default=0)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dotdigital_segment_mappings', to='accounts.marina')),
                ('segment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='dotdigital_mappings', to='members.segment')),
            ],
            options={
                'unique_together': {('marina', 'segment')},
            },
        ),
        migrations.CreateModel(
            name='EmailCampaign',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('status', models.CharField(choices=[('draft', 'Draft'), ('scheduled', 'Scheduled'), ('sending', 'Sending'), ('sent', 'Sent'), ('cancelled', 'Cancelled')], default='draft', max_length=20)),
                ('scheduled_at', models.DateTimeField(blank=True, null=True)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('total_sent', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='email_campaigns', to='accounts.marina')),
                ('segment', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='email_campaigns', to='members.segment')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='EmailCampaignVariant',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=10)),
                ('subject', models.CharField(max_length=500)),
                ('body_html', models.TextField()),
                ('split_pct', models.IntegerField(default=50)),
                ('sent_count', models.IntegerField(default=0)),
                ('open_count', models.IntegerField(default=0)),
                ('click_count', models.IntegerField(default=0)),
                ('campaign', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='variants', to='communications.emailcampaign')),
            ],
            options={
                'unique_together': {('campaign', 'label')},
            },
        ),
        migrations.CreateModel(
            name='ABTest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('test_split_pct', models.IntegerField(default=50)),
                ('hold_hours', models.IntegerField(default=24)),
                ('winner_metric', models.CharField(choices=[('open_rate', 'Open Rate'), ('click_rate', 'Click Rate')], default='open_rate', max_length=20)),
                ('winner_action', models.CharField(choices=[('auto_send', 'Auto-Send to Remainder'), ('alert', 'Alert Only')], default='auto_send', max_length=20)),
                ('winner_sent_at', models.DateTimeField(blank=True, null=True)),
                ('campaign', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='ab_test', to='communications.emailcampaign')),
                ('winner_variant', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='won_tests', to='communications.emailcampaignvariant')),
            ],
        ),
        migrations.CreateModel(
            name='ReviewRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('platform', models.CharField(choices=[('google', 'Google'), ('tripadvisor', 'TripAdvisor'), ('dockwa', 'Dockwa')], max_length=20)),
                ('status', models.CharField(choices=[('sent', 'Sent'), ('opened', 'Opened'), ('clicked', 'Clicked'), ('responded', 'Responded')], default='sent', max_length=20)),
                ('sent_at', models.DateTimeField(auto_now_add=True)),
                ('opened_at', models.DateTimeField(blank=True, null=True)),
                ('clicked_at', models.DateTimeField(blank=True, null=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='review_requests', to='accounts.marina')),
                ('booking', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='review_requests', to='reservations.booking')),
                ('member', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='review_requests', to='members.member')),
            ],
            options={
                'ordering': ['-sent_at'],
            },
        ),
        migrations.CreateModel(
            name='ReviewConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('enabled', models.BooleanField(default=False)),
                ('delay_hours', models.IntegerField(default=24)),
                ('google_review_url', models.URLField(blank=True)),
                ('tripadvisor_url', models.URLField(blank=True)),
                ('dockwa_url', models.URLField(blank=True)),
                ('send_channel', models.CharField(choices=[('email', 'Email'), ('sms', 'SMS'), ('whatsapp', 'WhatsApp')], default='email', max_length=20)),
                ('negative_threshold', models.IntegerField(default=3, help_text='NPS score at or below which review request is suppressed')),
                ('marina', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='review_config', to='accounts.marina')),
            ],
        ),
    ]
