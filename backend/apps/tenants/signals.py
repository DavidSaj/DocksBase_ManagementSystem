from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from apps.tenants.models import Tenancy


@receiver(post_save, sender=Tenancy)
def auto_create_deposit_invoice(sender, instance, created, **kwargs):
    if not created or instance.deposit_amount <= 0:
        return
    if not instance.deposit_chargeable_item_id:
        return

    def _create():
        from apps.billing.models import Invoice, InvoiceLineItem
        from apps.accounts.utils import generate_invoice_number

        invoice = Invoice.objects.create(
            marina=instance.marina,
            tenant=instance.tenant,
            member=None,
            source_type='tenancy_deposit',
            source_id=str(instance.pk),
            invoice_number=generate_invoice_number(instance.marina),
            status='draft',
        )
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Security Deposit — {instance.unit.unit_ref}',
            chargeable_item=instance.deposit_chargeable_item,
            quantity=1,
            unit_price=instance.deposit_amount,
            total_price=instance.deposit_amount,
            tax_rate=instance.deposit_chargeable_item.tax_rate,
        )
        Tenancy.objects.filter(pk=instance.pk).update(deposit_invoice=invoice)

    transaction.on_commit(_create)
