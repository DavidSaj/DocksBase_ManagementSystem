from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0004_chargeable_item_and_line_item_tax'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='billing_period',
            field=models.CharField(blank=True, db_index=True, default='', max_length=7),
            preserve_default=False,
        ),
    ]
