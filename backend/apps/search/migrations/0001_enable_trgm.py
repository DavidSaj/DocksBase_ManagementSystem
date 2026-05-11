from django.db import migrations, connection


def enable_trgm(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm;')


def disable_trgm(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute('DROP EXTENSION IF EXISTS pg_trgm;')


class Migration(migrations.Migration):
    dependencies = []

    operations = [
        migrations.RunPython(enable_trgm, disable_trgm),
    ]
