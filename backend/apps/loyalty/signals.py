from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender='billing.Payment')
def award_points_on_payment(sender, instance, created, **kwargs):
    """Award loyalty points when a payment is recorded on an invoice."""
    if not created:
        return

    invoice = instance.invoice
    member = invoice.member
    if not member:
        return

    from apps.loyalty.services import (
        get_or_create_membership,
        calculate_points_earned,
        earn_points,
        check_pending_referral_benefits,
    )

    membership = get_or_create_membership(member, invoice.marina)
    points = calculate_points_earned(invoice, membership)
    if points > 0:
        earn_points(
            membership_pk=membership.pk,
            invoice=invoice,
            points=points,
            entry_type='earn',
            description=f'Invoice {invoice.invoice_number} payment',
        )

    check_pending_referral_benefits(invoice)
