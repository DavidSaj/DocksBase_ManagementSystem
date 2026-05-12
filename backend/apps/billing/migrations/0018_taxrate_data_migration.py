from decimal import Decimal
from django.db import migrations


def seed_tax_rates(apps, schema_editor):
    Marina = apps.get_model('accounts', 'Marina')
    TaxRate = apps.get_model('billing', 'TaxRate')
    ChargeableItem = apps.get_model('billing', 'ChargeableItem')

    for marina in Marina.objects.all():
        items = ChargeableItem.objects.filter(marina=marina)
        if not items.exists():
            continue

        standard, _ = TaxRate.objects.get_or_create(
            marina=marina, name='Standard — 20.00%',
            defaults={'rate': Decimal('20.00'), 'is_default': True},
        )
        zero_rated, _ = TaxRate.objects.get_or_create(
            marina=marina, name='Zero Rated — 0.00%',
            defaults={'rate': Decimal('0.00')},
        )
        TaxRate.objects.get_or_create(
            marina=marina, name='Exempt — 0.00%',
            defaults={'rate': Decimal('0.00')},
        )

        for item in items:
            if item.tax_rate == Decimal('0.00'):
                item.tax_category = zero_rated
            elif item.tax_rate == Decimal('20.00'):
                item.tax_category = standard
            else:
                # Non-standard rate: create a dedicated TaxRate record for it
                custom_name = f'Custom — {item.tax_rate}%'
                custom_rate, _ = TaxRate.objects.get_or_create(
                    marina=marina, name=custom_name,
                    defaults={'rate': item.tax_rate},
                )
                item.tax_category = custom_rate
            item.save(update_fields=['tax_category'])


def reverse_seed(apps, schema_editor):
    ChargeableItem = apps.get_model('billing', 'ChargeableItem')
    ChargeableItem.objects.all().update(tax_category=None)


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0017_taxrate_nullable_fk'),
    ]

    operations = [
        migrations.RunPython(seed_tax_rates, reverse_seed),
    ]
