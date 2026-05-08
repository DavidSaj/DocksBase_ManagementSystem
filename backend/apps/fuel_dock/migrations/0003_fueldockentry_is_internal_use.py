from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Track 12 prerequisite: adds is_internal_use to FuelDockEntry so that
    sustainability Scope 3 aggregation can exclude the marina's own vehicle/workboat
    fuel from 'fuel_sold_vessels' (it belongs in Scope 1 instead).
    """

    dependencies = [
        ('fuel_dock', '0002_fueldockentry_fuel_berth_fk'),
    ]

    operations = [
        migrations.AddField(
            model_name='fueldockentry',
            name='is_internal_use',
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Set True when the marina fills its own workboat/vehicle at its own fuel dock. "
                    "These litres are counted in Scope 1 (workboat_fuel) and must NOT appear in "
                    "Scope 3 fuel_sold_vessels — counting here would double-tax the marina."
                ),
            ),
        ),
    ]
