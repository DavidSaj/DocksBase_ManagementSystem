from django.db import migrations, models


class Migration(migrations.Migration):
    """Add the rest of the DocuSign JWT-auth fields (user id, private key, base URL)."""

    dependencies = [
        ('accounts', '0027_marina_integration_api_keys'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='docusign_user_id',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='marina',
            name='docusign_private_key',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='marina',
            name='docusign_base_url',
            field=models.CharField(
                blank=True, default='', max_length=255,
                help_text='Account base URL, e.g. https://demo.docusign.net/restapi or https://na2.docusign.net/restapi',
            ),
        ),
    ]
