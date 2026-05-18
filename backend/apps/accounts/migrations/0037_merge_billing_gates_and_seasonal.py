from django.db import migrations


class Migration(migrations.Migration):
    """Merge the two parallel 0036 migrations:
    - 0036_marina_billing_admin_override_and_more (billing safety gates)
    - 0036_marina_charge_full_season_on_mid_start (seasonal berth tenancy)
    """

    dependencies = [
        ('accounts', '0036_marina_billing_admin_override_and_more'),
        ('accounts', '0036_marina_charge_full_season_on_mid_start'),
    ]

    operations = []
