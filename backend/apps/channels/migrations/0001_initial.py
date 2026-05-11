from django.db import migrations, models
import django.db.models.deletion
import apps.accounting.fields


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0001_initial'),
        ('reservations', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='OTAChannel',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider', models.CharField(choices=[('rentals_united', 'Rentals United'), ('pitchup', 'PitchUp'), ('snag_a_slip', 'Snag-A-Slip'), ('dockwa', 'Dockwa'), ('mysea', 'MySea'), ('noforeignland', 'Noforeignland')], max_length=40)),
                ('is_active', models.BooleanField(default=False)),
                ('api_key', apps.accounting.fields.EncryptedCharField(max_length=500)),
                ('api_secret', apps.accounting.fields.EncryptedCharField(max_length=500)),
                ('property_id', models.CharField(blank=True, max_length=200)),
                ('pricing_policy', models.CharField(choices=[('parity', 'Rate Parity'), ('markup', 'Fixed Markup (%)'), ('discount', 'Fixed Discount (%)')], default='parity', max_length=20)),
                ('pricing_delta_pct', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('last_push_at', models.DateTimeField(blank=True, null=True)),
                ('last_pull_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='accounts.marina')),
            ],
            options={
                'unique_together': {('marina', 'provider')},
            },
        ),
        migrations.CreateModel(
            name='OTABooking',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('ota_ref', models.CharField(max_length=200)),
                ('raw_payload', models.JSONField(default=dict)),
                ('commission_pct', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ('commission_amount', models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                ('imported_at', models.DateTimeField(auto_now_add=True)),
                ('channel', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ota_bookings', to='ota_channels.otachannel')),
                ('booking', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='reservations.booking')),
            ],
            options={
                'unique_together': {('channel', 'ota_ref')},
            },
        ),
    ]
