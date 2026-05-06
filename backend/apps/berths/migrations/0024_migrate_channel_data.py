import uuid
from django.db import migrations


def migrate_channel_data(apps, schema_editor):
    """
    For marinas with auto_allocate_inventory=True:
      - Create one OTAConnection with name/slug='mysea'
      - Assign berths that had sales_channel='mysea' to that connection
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
                'target_pct': marina.mysea_target_pct or 20,
                'auto_allocate': False,
                'last_synced': marina.mysea_last_synced,
            }
        )
        Berth.objects.filter(marina=marina, sales_channel='mysea').update(ota_connection=conn)


def reverse_migrate_channel_data(apps, schema_editor):
    """Restore sales_channel='mysea' for berths that point at a mysea OTAConnection, then delete those connections."""
    OTAConnection = apps.get_model('berths', 'OTAConnection')
    Berth = apps.get_model('berths', 'Berth')

    mysea_conns = OTAConnection.objects.filter(slug='mysea')
    for conn in mysea_conns:
        Berth.objects.filter(ota_connection=conn).update(sales_channel='mysea', ota_connection=None)
    mysea_conns.delete()


class Migration(migrations.Migration):
    dependencies = [
        ('berths', '0023_berth_add_ota_fields'),
    ]
    operations = [
        migrations.RunPython(migrate_channel_data, reverse_migrate_channel_data),
    ]
