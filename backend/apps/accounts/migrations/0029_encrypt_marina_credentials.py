"""
Switch four credential columns on accounts.Marina from plain CharField to
EncryptedCharField. Widens the columns to max_length=512 to accommodate
Fernet ciphertext (typically ~100 chars for short tokens; we leave headroom).

Existing rows are not rewritten by this migration — EncryptedCharField
tolerates plaintext on read and re-encrypts on next save. To force-upgrade
every row in one pass, run:

    python manage.py encrypt_marina_credentials
"""

from django.db import migrations

import apps.accounts.fields


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0028_marina_sms_and_notification_rules'),
    ]

    operations = [
        migrations.AlterField(
            model_name='marina',
            name='smtp_password',
            field=apps.accounts.fields.EncryptedCharField(
                blank=True,
                help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.',
                max_length=512,
            ),
        ),
        migrations.AlterField(
            model_name='marina',
            name='twilio_auth_token',
            field=apps.accounts.fields.EncryptedCharField(
                blank=True,
                help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.',
                max_length=512,
            ),
        ),
        migrations.AlterField(
            model_name='marina',
            name='vonage_api_secret',
            field=apps.accounts.fields.EncryptedCharField(
                blank=True,
                help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.',
                max_length=512,
            ),
        ),
        migrations.AlterField(
            model_name='marina',
            name='messagebird_access_key',
            field=apps.accounts.fields.EncryptedCharField(
                blank=True,
                help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.',
                max_length=512,
            ),
        ),
    ]
