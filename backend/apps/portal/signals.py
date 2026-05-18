"""Cache invalidation for the boater-access resolver.

Fires only on `post_save` when a row is newly *created* — status changes don't
affect access, so they don't bust the cache.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.members.models import Member
from apps.reservations.models import Booking, Reservation

from .boater_access import invalidate_boater_access


@receiver(post_save, sender=Booking)
def _booking_created(sender, instance, created, **kwargs):
    if not created:
        return
    email = (instance.guest_email or '').strip().lower()
    if email and instance.marina_id:
        invalidate_boater_access(email, instance.marina.slug)


@receiver(post_save, sender=Reservation)
def _reservation_created(sender, instance, created, **kwargs):
    if not created:
        return
    email = (instance.guest_email or '').strip().lower()
    if email and instance.marina_id:
        invalidate_boater_access(email, instance.marina.slug)


@receiver(post_save, sender=Member)
def _member_created(sender, instance, created, **kwargs):
    if not created:
        return
    email = (instance.email or '').strip().lower()
    if email and instance.marina_id:
        invalidate_boater_access(email, instance.marina.slug)
