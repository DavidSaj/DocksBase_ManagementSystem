"""
Track 11 data migration — seed default fraud detection thresholds
into Marina.features for all existing marinas.

These defaults are also the fallback values used in code (fraud_detector.py),
so seeding them is informational/overridable per marina.
"""

from django.db import migrations


def seed_fraud_defaults(apps, schema_editor):
    Marina = apps.get_model('accounts', 'Marina')
    defaults = {
        'fraud_discount_count_threshold': 3,
        'fraud_writeoff_threshold_amount': '200.00',
        'fraud_after_hours_start': '22:00',
        'fraud_after_hours_end':   '06:00',
        'max_cards_per_member':    4,
        'anpr_debounce_seconds':   60,
        'anpr_confidence_threshold': 0.85,
        'access_log_retention_days': 730,
    }
    for marina in Marina.objects.all():
        features = marina.features or {}
        for key, val in defaults.items():
            features.setdefault(key, val)
        marina.features = features
        marina.save(update_fields=['features'])


def remove_fraud_defaults(apps, schema_editor):
    """Reverse: remove the seeded keys (best-effort)."""
    Marina = apps.get_model('accounts', 'Marina')
    keys_to_remove = [
        'fraud_discount_count_threshold', 'fraud_writeoff_threshold_amount',
        'fraud_after_hours_start', 'fraud_after_hours_end',
        'max_cards_per_member', 'anpr_debounce_seconds',
        'anpr_confidence_threshold', 'access_log_retention_days',
    ]
    for marina in Marina.objects.all():
        features = marina.features or {}
        for key in keys_to_remove:
            features.pop(key, None)
        marina.features = features
        marina.save(update_fields=['features'])


class Migration(migrations.Migration):

    dependencies = [
        ('access_control', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_fraud_defaults, remove_fraud_defaults),
    ]
