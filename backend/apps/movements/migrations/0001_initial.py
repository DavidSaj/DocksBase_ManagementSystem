from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0017_marina_berth_intelligence_fields'),
        ('berths', '0030_berth_intelligence_models'),
        ('reservations', '0012_booking_track2_fields'),
        ('vessels', '0004_alter_vessel_options_alter_vesselcertificate_options'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='VesselMovement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('movement_type', models.CharField(choices=[
                    ('arrival', 'Arrival'),
                    ('departure', 'Departure'),
                    ('inter_marina', 'Inter-Marina Transfer'),
                    ('haul_out', 'Haul Out'),
                    ('relaunch', 'Relaunch'),
                    ('berth_change', 'Berth Change'),
                    ('temp_departure', 'Temporary Departure'),
                    ('temp_return', 'Temporary Return'),
                    ('correction', 'Correction'),
                ], max_length=20)),
                ('scheduled_at', models.DateTimeField(blank=True, null=True)),
                ('actual_at', models.DateTimeField(blank=True, null=True)),
                ('completed', models.BooleanField(default=False)),
                ('heading', models.CharField(blank=True, max_length=100)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='vessel_movements', to='accounts.marina')),
                ('vessel', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='movements', to='vessels.vessel')),
                ('berth_from', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movements_from', to='berths.berth')),
                ('berth_to', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movements_to', to='berths.berth')),
                ('booking', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movements', to='reservations.booking')),
                ('departure', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='movements', to='berths.temporarydeparture')),
                ('recorded_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='recorded_movements', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
