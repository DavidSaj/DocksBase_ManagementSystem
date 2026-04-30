from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('maintenance', '0002_asset_notes'),
    ]

    operations = [
        migrations.AddField(
            model_name='incident',
            name='notes',
            field=models.TextField(blank=True, default=''),
            preserve_default=False,
        ),
    ]
