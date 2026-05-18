from django.db import migrations, models


CHOICES = [
    ('litre', 'Litre'),
    ('kwh',   'kWh'),
    ('kg',    'kg'),
    ('tkm',   'Tonne-kilometre'),
    ('gbp',   'GBP (spend-based)'),
    ('usd',   'USD (spend-based)'),
    ('eur',   'EUR (spend-based)'),
    ('chf',   'CHF (spend-based)'),
]


class Migration(migrations.Migration):

    dependencies = [
        ('sustainability', '0002_seed_emission_factors'),
    ]

    operations = [
        migrations.AlterField(
            model_name='emissionfactor',
            name='unit',
            field=models.CharField(choices=CHOICES, max_length=10),
        ),
        migrations.AlterField(
            model_name='scope1record',
            name='unit',
            field=models.CharField(choices=CHOICES, editable=False, max_length=10),
        ),
        migrations.AlterField(
            model_name='scope3record',
            name='unit',
            field=models.CharField(choices=CHOICES, max_length=10),
        ),
    ]
