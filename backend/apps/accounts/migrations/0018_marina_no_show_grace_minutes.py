"""
Track 6 — add no_show_grace_minutes to Marina.

Dependency: must run before the boatyard Track 6 migration that
references marina.no_show_grace_minutes in the enforce_no_show task.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0017_marina_berth_intelligence_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='no_show_grace_minutes',
            field=models.IntegerField(
                default=30,
                help_text='Minutes after scheduled_for before a LaunchRequest is flagged as a no-show.',
            ),
        ),
    ]
