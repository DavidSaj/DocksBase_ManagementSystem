# Manually created to match the database state applied by a previous agent.
# The berths_pier table was restructured to use polygon_points instead of
# canvas_x/y/width/height, and the berths_amenity table was created with
# type/scale/rotation fields.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0007_marina_onboarding_emailverification'),
        ('berths', '0002_berth_canvas_height_berth_canvas_rotation_and_more'),
    ]

    operations = [
        # Remove canvas fields from Pier (replaced by polygon_points)
        migrations.RemoveField(model_name='pier', name='canvas_x'),
        migrations.RemoveField(model_name='pier', name='canvas_y'),
        migrations.RemoveField(model_name='pier', name='canvas_width'),
        migrations.RemoveField(model_name='pier', name='canvas_height'),
        migrations.RemoveField(model_name='pier', name='cx'),
        migrations.AddField(
            model_name='pier',
            name='polygon_points',
            field=models.JSONField(
                blank=True, default=list,
                help_text='List of [x, y] pairs defining the pier polygon on the canvas',
            ),
        ),
        migrations.CreateModel(
            name='Amenity',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=100)),
                ('type', models.CharField(
                    choices=[
                        ('fuel', 'Fuel'), ('electricity', 'Electricity'), ('water', 'Water'),
                        ('wifi', 'WiFi'), ('toilet', 'Toilet'), ('shower', 'Shower'),
                        ('laundry', 'Laundry'), ('parking', 'Parking'),
                        ('restaurant', 'Restaurant'), ('shop', 'Shop'),
                        ('pump_out', 'Pump Out'), ('crane', 'Crane'), ('other', 'Other'),
                    ],
                    default='other', max_length=30,
                )),
                ('canvas_x', models.FloatField(blank=True, null=True)),
                ('canvas_y', models.FloatField(blank=True, null=True)),
                ('scale', models.FloatField(default=1.0)),
                ('rotation', models.FloatField(default=0.0)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='amenities', to='accounts.marina',
                )),
            ],
            options={'ordering': ['label']},
        ),
    ]
