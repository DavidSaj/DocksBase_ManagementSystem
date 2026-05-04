from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('berths', '0013_pier_type_choices_canvas_float'),
    ]

    operations = [
        migrations.AddField(
            model_name='berth',
            name='berth_type',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
    ]
