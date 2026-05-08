"""
management command: seed_emission_factors

Upserts DEFRA 2023 (UK) and EPA eGRID 2022 (US) emission factors for all marinas.
Safe to re-run — uses update_or_create on (marina, energy_type, jurisdiction, valid_from).

Usage:
    python manage.py seed_emission_factors
    python manage.py seed_emission_factors --marina-id 1  # single marina
"""

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand

DEFRA_2023_UK = [
    # (energy_type, unit, kg_co2e_per_unit, source_url)
    ('diesel',      'litre', '2.51823', 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023'),
    ('petrol',      'litre', '2.31370', 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023'),
    ('lpg',         'kg',    '1.55540', 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023'),
    ('natural_gas', 'kwh',   '0.18254', 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023'),
    ('electricity', 'kwh',   '0.23314', 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023'),
    ('hvo',         'litre', '0.19500', 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023'),
]

EPA_EGRID_2022_US = [
    ('diesel',      'litre', '2.67600', 'https://www.epa.gov/egrid'),
    ('petrol',      'litre', '2.34700', 'https://www.epa.gov/egrid'),
    ('electricity', 'kwh',   '0.38600', 'https://www.epa.gov/egrid'),
]


class Command(BaseCommand):
    help = 'Seed DEFRA 2023 (UK) and EPA eGRID 2022 (US) emission factors for all marinas.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--marina-id', type=int, default=None,
            help='Only seed for this marina PK (default: all marinas).',
        )

    def handle(self, *args, **options):
        from apps.accounts.models import Marina
        from apps.sustainability.models import EmissionFactor

        valid_from = date(2023, 1, 1)
        marina_qs  = Marina.objects.all()
        if options['marina_id']:
            marina_qs = marina_qs.filter(pk=options['marina_id'])

        created_total = updated_total = 0

        for marina in marina_qs:
            for (et, unit, kg, url) in DEFRA_2023_UK:
                _, created = EmissionFactor.objects.update_or_create(
                    marina=marina, energy_type=et, jurisdiction='UK', valid_from=valid_from,
                    defaults={
                        'kg_co2e_per_unit': Decimal(kg),
                        'unit':             unit,
                        'source':           'defra',
                        'source_url':       url,
                    }
                )
                if created:
                    created_total += 1
                else:
                    updated_total += 1

            for (et, unit, kg, url) in EPA_EGRID_2022_US:
                valid_from_us = date(2022, 1, 1)
                _, created = EmissionFactor.objects.update_or_create(
                    marina=marina, energy_type=et, jurisdiction='US', valid_from=valid_from_us,
                    defaults={
                        'kg_co2e_per_unit': Decimal(kg),
                        'unit':             unit,
                        'source':           'epa_egrid',
                        'source_url':       url,
                    }
                )
                if created:
                    created_total += 1
                else:
                    updated_total += 1

        self.stdout.write(self.style.SUCCESS(
            f'Done. Created {created_total}, updated {updated_total} emission factors across {marina_qs.count()} marina(s).'
        ))
