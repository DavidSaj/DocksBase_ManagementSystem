from django.db import migrations, models


class Migration(migrations.Migration):
    """Add API-key fields for MarineTraffic, OpenWeatherMap, and DocuSign integrations."""

    dependencies = [
        ('accounts', '0026_marina_smtp_config'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='marinetraffic_api_key',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='marina',
            name='openweathermap_api_key',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='marina',
            name='docusign_api_key',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='marina',
            name='docusign_account_id',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
    ]
