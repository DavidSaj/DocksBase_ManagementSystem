from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import User


@receiver(post_save, sender=User)
def auto_complete_invite_staff(sender, instance, **kwargs):
    if not instance.marina_id:
        return
    if instance.role == 'boater':
        return
    if not instance.is_active:
        return

    marina = instance.marina
    if marina.onboarding.get('invite_staff'):
        return  # already done, no-op

    count = User.objects.filter(
        marina=marina,
        is_active=True,
    ).exclude(role='boater').count()

    if count >= 2:
        marina.onboarding = {**marina.onboarding, 'invite_staff': True}
        marina.save(update_fields=['onboarding'])
