from django.db import migrations, models


class Migration(migrations.Migration):
    """Add provider field + parallel DocuSign id columns to DocTemplate and Envelope."""

    dependencies = [
        ('documents', '0003_alter_doctemplate_category'),
    ]

    operations = [
        migrations.AddField(
            model_name='doctemplate',
            name='provider',
            field=models.CharField(
                choices=[('dropboxsign', 'Dropbox Sign'), ('docusign', 'DocuSign')],
                default='dropboxsign',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='doctemplate',
            name='docusign_template_id',
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name='envelope',
            name='provider',
            field=models.CharField(
                choices=[('dropboxsign', 'Dropbox Sign'), ('docusign', 'DocuSign')],
                default='dropboxsign',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='envelope',
            name='docusign_envelope_id',
            field=models.CharField(blank=True, max_length=200),
        ),
    ]
