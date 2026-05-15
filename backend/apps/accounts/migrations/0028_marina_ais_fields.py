from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0027_marina_integration_api_keys'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='basin_polygon',
            field=models.JSONField(
                blank=True, default=list,
                help_text='Marina basin polygon as list of [lat, lng] vertices. Used for AIS arrival detection.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='ais_poll_radius_nm',
            field=models.IntegerField(
                default=10,
                help_text='Bounding-box radius around marina lat/lng (nautical miles) used to query AIS providers.',
            ),
        ),
    ]
