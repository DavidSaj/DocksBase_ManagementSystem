from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0010_add_module_permissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='custom_domain',
            field=models.CharField(blank=True, max_length=255, null=True, unique=True),
        ),
    ]
