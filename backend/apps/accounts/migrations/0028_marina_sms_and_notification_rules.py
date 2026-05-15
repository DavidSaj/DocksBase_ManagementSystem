from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0026_marina_smtp_config'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='sms_enabled',
            field=models.BooleanField(default=False, help_text='Master switch for outgoing SMS from this marina.'),
        ),
        migrations.AddField(
            model_name='marina',
            name='sms_provider',
            field=models.CharField(blank=True, choices=[('twilio', 'Twilio'), ('vonage', 'Vonage'), ('messagebird', 'MessageBird')], default='twilio', max_length=20),
        ),
        migrations.AddField(
            model_name='marina',
            name='twilio_account_sid',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='marina',
            name='twilio_auth_token',
            field=models.CharField(blank=True, help_text='Stored in plaintext — use environment secrets for production deployments.', max_length=64),
        ),
        migrations.AddField(
            model_name='marina',
            name='twilio_from_number',
            field=models.CharField(blank=True, help_text='E.164 format, e.g. +14155551234.', max_length=32),
        ),
        migrations.AddField(
            model_name='marina',
            name='vonage_api_key',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='marina',
            name='vonage_api_secret',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='marina',
            name='vonage_from',
            field=models.CharField(blank=True, help_text='Sender ID or E.164 number.', max_length=32),
        ),
        migrations.AddField(
            model_name='marina',
            name='messagebird_access_key',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='marina',
            name='messagebird_originator',
            field=models.CharField(blank=True, help_text='Sender ID or E.164 number.', max_length=32),
        ),
        migrations.AddField(
            model_name='marina',
            name='notification_rules',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
