from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('berths', '0022_ota_connection_target_pct_validators'),
    ]

    operations = [
        migrations.AddField(
            model_name='berth',
            name='ota_connection',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='berths',
                to='berths.otaconnection',
            ),
        ),
        migrations.AddField(
            model_name='berth',
            name='channel_locked',
            field=models.BooleanField(default=False),
        ),
    ]
