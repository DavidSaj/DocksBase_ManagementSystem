from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0020_marina_support_access_granted_until'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='dropboxsign_api_key',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='marina',
            name='dropboxsign_client_id',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
    ]
