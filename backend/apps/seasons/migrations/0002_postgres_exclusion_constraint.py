"""
Postgres-only DB-level guard against overlapping live leases on the same
berth (spec §7.3).  Runs as a vendor-gated ``RunSQL`` so that SQLite
test runs (which use the application-level pre-check in
``services._assert_no_overlap``) are unaffected.
"""
from django.db import migrations


SQL_FORWARD = r"""
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE seasons_berthlease
    ADD CONSTRAINT no_overlapping_live_leases
    EXCLUDE USING GIST (
        berth_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status IN ('offered', 'accepted', 'deposit_paid', 'active', 'ending'));
"""

SQL_REVERSE = r"""
ALTER TABLE seasons_berthlease DROP CONSTRAINT IF EXISTS no_overlapping_live_leases;
"""


def forwards(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(SQL_FORWARD)


def backwards(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(SQL_REVERSE)


class Migration(migrations.Migration):
    dependencies = [
        ('seasons', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
