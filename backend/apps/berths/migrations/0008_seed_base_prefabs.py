from django.db import migrations

BASE_PREFABS = [
    {
        'name': 'Standard Pontoon (10 berths)',
        'pier_type': 'pontoon',
        'label_template': 'Pontoon {n}',
        'polygon_points': [[0,0],[30,0],[30,8],[0,8]],
        'berth_slots': [
            {'x': 3,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 9,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 15, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 21, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 27, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 3,  'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 9,  'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 15, 'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 21, 'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 27, 'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
        ],
    },
    {
        'name': 'T-Dock End Piece',
        'pier_type': 'concrete',
        'label_template': 'T-Dock {n}',
        'polygon_points': [
            [6,0],[14,0],[14,6],[20,6],[20,12],[14,12],[14,18],[6,18],[6,12],[0,12],[0,6],[6,6]
        ],
        'berth_slots': [],
    },
    {
        'name': 'Parallel Docking Wall (6 berths)',
        'pier_type': 'concrete',
        'label_template': 'Dock {n}',
        'polygon_points': [[0,0],[36,0],[36,4],[0,4]],
        'berth_slots': [
            {'x': 3,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 9,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 15, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 21, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 27, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 33, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
        ],
    },
    {
        'name': 'Grass Breakwater',
        'pier_type': 'land',
        'label_template': 'Breakwater {n}',
        'polygon_points': [[0,0],[50,0],[50,6],[0,6]],
        'berth_slots': [],
    },
]


def seed_prefabs(apps, schema_editor):
    MapPrefab = apps.get_model('berths', 'MapPrefab')
    for p in BASE_PREFABS:
        MapPrefab.objects.get_or_create(
            name=p['name'],
            is_base=True,
            defaults={
                'pier_type':      p['pier_type'],
                'label_template': p['label_template'],
                'polygon_points': p['polygon_points'],
                'berth_slots':    p['berth_slots'],
                'marina':         None,
            },
        )


def unseed_prefabs(apps, schema_editor):
    MapPrefab = apps.get_model('berths', 'MapPrefab')
    MapPrefab.objects.filter(is_base=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('berths', '0007_mapprefab'),
    ]
    operations = [
        migrations.RunPython(seed_prefabs, unseed_prefabs),
    ]
