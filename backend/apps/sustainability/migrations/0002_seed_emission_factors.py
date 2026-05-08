"""
Track 12 data migration — seed DEFRA 2023 (UK) emission factors
for all existing marinas.

In production, run `python manage.py seed_emission_factors` after deploying
to seed US (EPA eGRID) factors as well (this migration only seeds UK DEFRA).
"""

from datetime import date
from decimal import Decimal

from django.db import migrations


def seed_uk_factors(apps, schema_editor):
    Marina         = apps.get_model('accounts', 'Marina')
    EmissionFactor = apps.get_model('sustainability', 'EmissionFactor')

    valid_from = date(2023, 1, 1)
    uk_factors = [
        ('diesel',      'litre', '2.51823', 'defra'),
        ('petrol',      'litre', '2.31370', 'defra'),
        ('lpg',         'kg',    '1.55540', 'defra'),
        ('natural_gas', 'kwh',   '0.18254', 'defra'),
        ('electricity', 'kwh',   '0.23314', 'defra'),
        ('hvo',         'litre', '0.19500', 'defra'),
    ]

    for marina in Marina.objects.all():
        for (et, unit, kg, src) in uk_factors:
            EmissionFactor.objects.get_or_create(
                marina=marina, energy_type=et, jurisdiction='UK', valid_from=valid_from,
                defaults={
                    'kg_co2e_per_unit': Decimal(kg),
                    'unit':             unit,
                    'source':           src,
                    'source_url':       'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023',
                }
            )


def remove_seeded_factors(apps, schema_editor):
    """Best-effort reverse: remove only DEFRA 2023-01-01 factors."""
    EmissionFactor = apps.get_model('sustainability', 'EmissionFactor')
    EmissionFactor.objects.filter(source='defra', valid_from=date(2023, 1, 1)).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('sustainability', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_uk_factors, remove_seeded_factors),
    ]
