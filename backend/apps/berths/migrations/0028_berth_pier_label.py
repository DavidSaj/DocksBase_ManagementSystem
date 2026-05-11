from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Track 11 prerequisite: adds pier_label to Berth so that
    access_control.services.zone_engine.member_can_access_zone()
    can perform the spatial pier check when ZoneAccessRule.link_to_berth_pier=True.
    """

    dependencies = [
        ('berths', '0027_logical_pier'),
    ]

    operations = [
        migrations.AddField(
            model_name='berth',
            name='pier_label',
            field=models.CharField(
                blank=True,
                help_text=(
                    "Human-readable pier label set by the map editor pier-grouping tool. "
                    "Used by access_control.ZoneAccessRule(link_to_berth_pier=True) to match "
                    "a member's berth to an AccessZone by name."
                ),
                max_length=50,
            ),
        ),
    ]
