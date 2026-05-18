from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0023_refund'),
    ]

    operations = [
        migrations.AlterField(
            model_name='payment',
            name='method',
            field=models.CharField(
                choices=[
                    ('cash', 'Cash'),
                    ('external_card', 'External Card'),
                    ('bank_transfer', 'Bank Transfer'),
                    ('cheque', 'Cheque'),
                ],
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='payment',
            name='notes',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
    ]
