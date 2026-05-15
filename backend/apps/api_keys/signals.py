from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone


@receiver(post_save, sender='accounts.User')
def _revoke_keys_on_deactivation(sender, instance, created, **kwargs):
    if created or instance.is_active:
        return
    from .models import APIKey
    APIKey.objects.filter(
        created_by=instance,
        revoked_at__isnull=True,
    ).update(revoked_at=timezone.now())
