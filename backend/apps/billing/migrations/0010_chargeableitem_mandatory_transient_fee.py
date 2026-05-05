from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0009_invoice_booking_fk'),
    ]

    operations = [
        migrations.AddField(
            model_name='chargeableitem',
            name='is_mandatory_transient_fee',
            field=models.BooleanField(default=False),
        ),
    ]
