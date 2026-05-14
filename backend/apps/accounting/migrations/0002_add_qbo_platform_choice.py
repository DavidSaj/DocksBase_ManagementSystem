"""Add QuickBooks Online to AccountingIntegrationConfig.platform choices."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounting', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='accountingintegrationconfig',
            name='platform',
            field=models.CharField(
                choices=[
                    ('xero', 'Xero'),
                    ('qbo', 'QuickBooks Online'),
                    ('netsuite', 'Oracle NetSuite'),
                    ('dynamics365', 'Microsoft Dynamics 365 Business Central'),
                    ('sage_intacct', 'Sage Intacct'),
                    ('myob', 'MYOB'),
                ],
                max_length=30,
            ),
        ),
    ]
