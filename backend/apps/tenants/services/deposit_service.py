def auto_create_deposit_invoice(tenancy_id: int):
    from apps.tenants.models import Tenancy
    from apps.billing.models import Invoice, InvoiceLineItem
    from apps.accounts.utils import generate_invoice_number

    tenancy = Tenancy.objects.select_related('marina', 'tenant', 'deposit_chargeable_item', 'unit').get(pk=tenancy_id)

    if not tenancy.deposit_chargeable_item_id or tenancy.deposit_amount <= 0:
        return

    invoice = Invoice.objects.create(
        marina=tenancy.marina,
        tenant=tenancy.tenant,
        member=None,
        source_type='tenancy_deposit',
        source_id=str(tenancy.pk),
        invoice_number=generate_invoice_number(tenancy.marina),
        status='draft',
    )
    InvoiceLineItem.objects.create(
        invoice=invoice,
        description=f'Security Deposit — {tenancy.unit.unit_ref}',
        chargeable_item=tenancy.deposit_chargeable_item,
        quantity=1,
        unit_price=tenancy.deposit_amount,
        total_price=tenancy.deposit_amount,
        tax_rate=tenancy.deposit_chargeable_item.tax_rate,
    )
    invoice.subtotal = tenancy.deposit_amount
    invoice.total = tenancy.deposit_amount
    invoice.save(update_fields=['subtotal', 'total'])

    Tenancy.objects.filter(pk=tenancy.pk).update(deposit_invoice=invoice)
    return invoice
