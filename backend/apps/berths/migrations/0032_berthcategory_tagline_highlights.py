from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('berths', '0031_berth_booking_tier_berth_lease_expiry_berth_owner'),
    ]

    operations = [
        migrations.AddField(
            model_name='berthcategory',
            name='tagline',
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name='berthcategory',
            name='highlights',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
