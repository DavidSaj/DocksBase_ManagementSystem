"""
Data migration: convert Berth.price_per_night values into ChargeableItem records
and assign the pricing_tier FK accordingly.

Rules:
- For each unique non-null price_per_night, create one ChargeableItem named
  "Legacy Rate — €{price:.2f}" using the marina of the first berth with that price.
- For all berths where price_per_night IS NULL, create a single shared
  "Unpriced Slip — €0.00" ChargeableItem (marina from first such berth) and
  assign it to all of them.
- Does NOT drop price_per_night (that is Task 5).
"""

from decimal import Decimal

from django.db import migrations


def migrate_prices(apps, schema_editor):
    Berth = apps.get_model('berths', 'Berth')
    ChargeableItem = apps.get_model('billing', 'ChargeableItem')

    # ------------------------------------------------------------------ #
    # 1. Handle non-null prices                                            #
    # ------------------------------------------------------------------ #
    # Collect all berths that have a price, grouped by price value
    berths_with_price = list(
        Berth.objects.filter(price_per_night__isnull=False)
        .select_related('pier__marina')
        .order_by('price_per_night', 'id')
    )

    price_to_item = {}  # Decimal -> ChargeableItem

    for berth in berths_with_price:
        price = berth.price_per_night

        if price not in price_to_item:
            # Resolve marina: Berth → Pier → Marina
            marina = berth.pier.marina

            item = ChargeableItem.objects.create(
                marina=marina,
                name=f'Legacy Rate — €{price:.2f}',
                category='berth',
                pricing_model='per_night',
                unit_price=price,
                tax_rate=Decimal('0.00'),
                is_active=True,
            )
            price_to_item[price] = item

        berth.pricing_tier = price_to_item[price]
        berth.save(update_fields=['pricing_tier'])

    # ------------------------------------------------------------------ #
    # 2. Handle null prices                                                #
    # ------------------------------------------------------------------ #
    null_berths = list(
        Berth.objects.filter(price_per_night__isnull=True)
        .select_related('pier__marina')
        .order_by('id')
    )

    if null_berths:
        first_marina = null_berths[0].pier.marina

        unpriced_item = ChargeableItem.objects.create(
            marina=first_marina,
            name='Unpriced Slip — €0.00',
            category='berth',
            pricing_model='per_night',
            unit_price=Decimal('0.00'),
            tax_rate=Decimal('0.00'),
            is_active=True,
        )

        for berth in null_berths:
            berth.pricing_tier = unpriced_item
            berth.save(update_fields=['pricing_tier'])


def reverse_migrate_prices(apps, schema_editor):
    """
    Reverse: clear pricing_tier FK on all berths and delete any ChargeableItems
    whose name starts with the legacy prefixes created by this migration.
    """
    Berth = apps.get_model('berths', 'Berth')
    ChargeableItem = apps.get_model('billing', 'ChargeableItem')

    Berth.objects.update(pricing_tier=None)
    ChargeableItem.objects.filter(
        name__startswith='Legacy Rate'
    ).delete()
    ChargeableItem.objects.filter(
        name__startswith='Unpriced Slip'
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('berths', '0010_remove_mapprefab_marina_remove_berth_canvas_rotation_and_more'),
        ('billing', '0008_account_payment_member_null'),
    ]

    operations = [
        migrations.RunPython(migrate_prices, reverse_code=reverse_migrate_prices),
    ]
