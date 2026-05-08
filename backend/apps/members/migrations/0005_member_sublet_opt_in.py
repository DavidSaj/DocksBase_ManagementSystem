from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('members', '0004_member_boater_user'),
    ]

    operations = [
        migrations.AddField(
            model_name='member',
            name='sublet_opt_in',
            field=models.BooleanField(
                default=False,
                help_text='Holder consents to berth being sub-let during temporary absences.',
            ),
        ),
    ]
