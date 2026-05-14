"""Add Sage Business Cloud Accounting to AccountingIntegrationConfig.platform choices."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('accounting', '0002_add_qbo_platform_choice'),
    ]

    operations = [
        migrations.AlterField(
            model_name='accountingintegrationconfig',
            name='platform',
            field=models.CharField(
                choices=[
                    ('xero', 'Xero'),
                    ('qbo', 'QuickBooks Online'),
                    ('sage_business_cloud', 'Sage Business Cloud Accounting'),
                    ('netsuite', 'Oracle NetSuite'),
                    ('dynamics365', 'Microsoft Dynamics 365 Business Central'),
                    ('sage_intacct', 'Sage Intacct'),
                    ('myob', 'MYOB'),
                ],
                max_length=30,
            ),
        ),
    ]
