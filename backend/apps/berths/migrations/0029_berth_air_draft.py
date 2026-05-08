from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('berths', '0028_berth_pier_label'),
    ]

    operations = [
        migrations.AddField(
            model_name='berth',
            name='max_air_draft_m',
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=5, null=True,
                help_text=(
                    'Standard bridge/powerline clearance in metres at mid-tide. '
                    'Vessels exceeding this are flagged with an amber warning, not hard-excluded.'
                ),
            ),
        ),
    ]
