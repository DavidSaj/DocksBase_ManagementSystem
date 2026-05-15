import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0028_marina_ais_fields'),
        ('vessels', '0004_alter_vessel_options_alter_vesselcertificate_options'),
    ]

    operations = [
        migrations.CreateModel(
            name='VesselPosition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('mmsi', models.CharField(db_index=True, max_length=20)),
                ('lat', models.DecimalField(decimal_places=6, max_digits=9)),
                ('lng', models.DecimalField(decimal_places=6, max_digits=9)),
                ('speed_kn', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
                ('course_deg', models.IntegerField(blank=True, null=True)),
                ('heading_deg', models.IntegerField(blank=True, null=True)),
                ('nav_status', models.CharField(blank=True, max_length=30)),
                ('reported_at', models.DateTimeField()),
                ('received_at', models.DateTimeField(auto_now=True)),
                ('source', models.CharField(default='marinetraffic', max_length=30)),
                ('in_basin', models.BooleanField(default=False)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ais_positions',
                    to='accounts.marina',
                )),
                ('vessel', models.ForeignKey(
                    blank=True, help_text='Set when MMSI matches a known marina vessel.',
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='ais_positions',
                    to='vessels.vessel',
                )),
            ],
            options={
                'constraints': [
                    models.UniqueConstraint(
                        fields=['marina', 'mmsi'],
                        name='ais_position_marina_mmsi_uniq',
                    ),
                ],
                'indexes': [
                    models.Index(
                        fields=['marina', '-reported_at'],
                        name='ais_position_marina_reported_idx',
                    ),
                ],
            },
        ),
    ]
