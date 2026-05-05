import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('berths', '0014_berth_berth_type'),
        ('billing', '0008_account_payment_member_null'),
    ]

    operations = [
        migrations.AlterField(
            model_name='berth',
            name='pricing_tier',
            field=models.ForeignKey(
                blank=True,
                limit_choices_to={'category': 'berth'},
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='berths',
                to='billing.chargeableitem',
            ),
        ),
    ]
