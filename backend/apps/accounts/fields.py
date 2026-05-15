"""Custom Django model fields with at-rest encryption."""

from django.db import models

from .encryption import encrypt, decrypt


class EncryptedCharField(models.CharField):
    """
    A CharField whose value is Fernet-encrypted on the way to the database
    and decrypted on the way back. Application code sees plaintext.

    Storage notes
    -------------
    Fernet ciphertext is ~100 chars for short inputs and grows roughly linearly
    with plaintext length. Always allocate a generous ``max_length`` (512 is a
    safe default for tokens / passwords / API secrets).

    Mixed-state safety
    ------------------
    ``decrypt()`` falls back to returning its input verbatim when the value
    is not a valid Fernet token, so plaintext rows that predate the migration
    are returned as-is. Re-saving a row picks up encryption automatically.
    """

    description = 'Fernet-encrypted CharField'

    def from_db_value(self, value, expression, connection):
        return decrypt(value) if value is not None else value

    def to_python(self, value):
        # `to_python` is called with already-Python values (e.g. from forms).
        # Treat both encrypted-string and plaintext gracefully.
        if value is None:
            return value
        return decrypt(value)

    def get_prep_value(self, value):
        if value is None:
            return value
        return encrypt(str(value))
