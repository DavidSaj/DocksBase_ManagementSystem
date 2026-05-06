from django.db import migrations
import uuid


def migrate_channel_data(apps, schema_editor):
    """
    For marinas with auto_allocate_inventory=True:
      - Create one OTAConnection with name/slug='mysea', copying mysea_ical_url + mysea_target_pct
      - Assign berths that had sales_channel='mysea' to that connection
    Berths on other marinas or with sales_channel='direct' get ota_connection=NULL (direct).
    This migration is a no-op if there are no mysea-configured marinas.
    """
    Marina = apps.get_model('accounts', 'Marina')
    OTAConnection = apps.get_model('berths', 'OTAConnection')
    Berth = apps.get_model('berths', 'Berth')

    for marina in Marina.objects.filter(auto_allocate_inventory=True).exclude(mysea_ical_url=''):
        conn, _ = OTAConnection.objects.get_or_create(
            marina=marina, slug='mysea',
            defaults={
                'name': 'mySea',
                'inbound_ical_url': marina.mysea_ical_url,
                'outbound_token': uuid.uuid4(),
                'target_pct': marina.mysea_target_pct,
                'auto_allocate': False,
                'last_synced': marina.mysea_last_synced,
            }
        )
        Berth.objects.filter(marina=marina, sales_channel='mysea').update(ota_connection=conn)


class Migration(migrations.Migration):

    dependencies = [
        ('berths', '0022_ota_connection_target_pct_validators'),
    ]

    operations = [
        migrations.RunPython(migrate_channel_data, migrations.RunPython.noop),
    ]
