"""
Force-encrypt every Marina credential row that's still sitting in plaintext.

Idempotent — rows whose raw stored value already decrypts under the current
key are skipped. Safe to run multiple times.

Usage::

    DOCKSBASE_FERNET_KEY=... python manage.py encrypt_marina_credentials
    python manage.py encrypt_marina_credentials --dry-run
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.accounts.encryption import is_configured, looks_encrypted
from apps.accounts.models import Marina


_ENCRYPTED_FIELDS = (
    'smtp_password',
    'twilio_auth_token',
    'vonage_api_secret',
    'messagebird_access_key',
)


def _raw_credentials():
    """
    Yield (marina_id, {field: raw_stored_value}) tuples, bypassing the ORM so
    we can see the *stored* bytes (which may be plaintext or ciphertext)
    instead of the auto-decrypted value EncryptedCharField returns.
    """
    cols = ', '.join(_ENCRYPTED_FIELDS)
    with connection.cursor() as cur:
        cur.execute(f'SELECT id, {cols} FROM accounts_marina')
        for row in cur.fetchall():
            mid = row[0]
            values = dict(zip(_ENCRYPTED_FIELDS, row[1:]))
            yield mid, values


class Command(BaseCommand):
    help = 'Re-save every Marina credential field so plaintext values get encrypted at rest.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report what would change without writing to the database.',
        )

    def handle(self, *args, **options):
        if not is_configured():
            raise CommandError(
                'DOCKSBASE_FERNET_KEY is not set — refusing to run. The command '
                'would be a no-op (no key means no encryption).'
            )

        dry = options['dry_run']
        rewritten = 0
        skipped = 0

        for mid, raw in _raw_credentials():
            dirty = [
                f for f, v in raw.items()
                if v and not looks_encrypted(v)
            ]
            if not dirty:
                skipped += 1
                continue

            marina = Marina.objects.get(pk=mid)
            if dry:
                self.stdout.write(
                    f'[dry] marina {mid} ({marina.name}): would encrypt '
                    f'{", ".join(dirty)}'
                )
            else:
                # Reading each attribute through the descriptor decrypted it
                # (or returned the legacy plaintext verbatim). Saving with
                # update_fields re-runs get_prep_value, encrypting on the way
                # to the database.
                marina.save(update_fields=dirty)
                self.stdout.write(
                    f'marina {mid} ({marina.name}): encrypted {", ".join(dirty)}'
                )
            rewritten += 1

        verb = 'would encrypt' if dry else 'encrypted'
        self.stdout.write(self.style.SUCCESS(
            f'Done — {verb} {rewritten} marina(s); skipped {skipped} already-clean.'
        ))
