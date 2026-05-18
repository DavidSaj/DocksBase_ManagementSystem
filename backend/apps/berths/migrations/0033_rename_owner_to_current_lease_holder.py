# F5 (2026-05-18 backlog) — rename Berth.owner to Berth.current_lease_holder.
#
# `Berth.owner` was a misleading name: the field is a denormalised projection
# of the currently-active BerthLease holder (see _project_to_berth in
# apps/seasons/services.py), not a true ownership relation. Renaming preserves
# data via RenameField + AlterField; Django's makemigrations defaulted to
# Remove+Add which would have dropped every projection on prod.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('berths', '0032_berthcategory_tagline_highlights'),
        ('members', '0008_merge_broadcast_opt_in_tax_exempt'),
    ]

    operations = [
        migrations.RenameField(
            model_name='berth',
            old_name='owner',
            new_name='current_lease_holder',
        ),
        migrations.AlterField(
            model_name='berth',
            name='current_lease_holder',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='held_berths',
                to='members.member',
            ),
        ),
    ]
