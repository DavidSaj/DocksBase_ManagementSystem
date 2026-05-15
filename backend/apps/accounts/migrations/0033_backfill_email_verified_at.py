"""
Data migration: backfill email_verified_at = created_at for all existing users
that have not yet had it set.

Without this backfill, every existing user would immediately hit the 210-day
hard block the moment the feature goes live, because email_verified_at would be
NULL and status_for() would fall back to created_at — which may be well over
210 days ago for long-standing accounts. By setting email_verified_at = created_at,
all existing users start the 210-day clock from their account creation date,
giving accounts created recently a natural grace period.

Note: This migration does NOT reset the clock for very old accounts. Accounts
created > 210 days ago will still eventually be in the blocked state once
email_verified_at + 210d is reached. This is intentional per spec.
"""

from django.db import migrations, models


def backfill_email_verified_at(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    User.objects.filter(email_verified_at__isnull=True).update(
        email_verified_at=models.F('created_at')
    )


def reverse_backfill(apps, schema_editor):
    # No-op reverse: we don't want to wipe email_verified_at values
    # that may have been updated by real re-verification flows after this
    # migration ran.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0032_user_email_verified_at'),
    ]

    operations = [
        migrations.RunPython(backfill_email_verified_at, reverse_backfill),
    ]
