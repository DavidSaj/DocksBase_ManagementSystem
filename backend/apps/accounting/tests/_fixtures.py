"""Shared fixture builders for the accounting & tax export tests."""

import datetime
from decimal import Decimal

from apps.accounts.models import Marina
from apps.billing.models import (
    ChargeableItem, Invoice, InvoiceLineItem, TaxRate, Payment,
)
from apps.members.models import Member
from apps.accounting.models import GLCodeMapping, TaxCode


def make_marina(name='Test Marina', stripe_account_id='acct_test_123'):
    return Marina.objects.create(name=name, stripe_account_id=stripe_account_id)


def seed_basic_taxes(marina):
    standard = TaxRate.objects.create(marina=marina, name='Standard 20%', rate=Decimal('20.00'), is_default=True)
    transient = TaxRate.objects.create(marina=marina, name='Transient 8%', rate=Decimal('8.00'))
    zero = TaxRate.objects.create(marina=marina, name='Zero 0%', rate=Decimal('0.00'))
    return {'standard': standard, 'transient': transient, 'zero': zero}


def seed_chargeable_items(marina, taxes):
    items = {}
    items['berth'] = ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=Decimal('100.00'),
        tax_category=taxes['transient'],
    )
    items['utility'] = ChargeableItem.objects.create(
        marina=marina, name='Shore Power', category='utility',
        pricing_model='flat_fee', unit_price=Decimal('25.00'),
        tax_category=taxes['standard'],
    )
    items['retail'] = ChargeableItem.objects.create(
        marina=marina, name='Bag of Ice', category='retail',
        pricing_model='flat_fee', unit_price=Decimal('5.00'),
        tax_category=taxes['standard'],
    )
    items['service'] = ChargeableItem.objects.create(
        marina=marina, name='Pump-Out', category='service',
        pricing_model='flat_fee', unit_price=Decimal('30.00'),
        tax_category=taxes['standard'],
    )
    items['booking_fee'] = ChargeableItem.objects.create(
        marina=marina, name='Booking Fee', category='booking_fee',
        pricing_model='flat_fee', unit_price=Decimal('10.00'),
        tax_category=taxes['zero'],
    )
    return items


def seed_gl_mappings(marina):
    rows = [
        ('berth',       '4100', 'Slip Rentals'),
        ('utility',     '4200', 'Utilities'),
        ('retail',      '4300', 'Retail Sales'),
        ('service',     '4400', 'Services'),
        ('booking_fee', '4500', 'Booking Fees'),
        ('tax_collected', '2200', 'Sales Tax Payable'),
    ]
    out = []
    for cat, code, name in rows:
        out.append(GLCodeMapping.objects.create(
            marina=marina, chargeable_category=cat,
            external_gl_code=code, external_gl_name=name,
        ))
    return out


def seed_tax_codes(marina, taxes):
    standard = TaxCode.objects.create(
        marina=marina, name='UK VAT Standard 20%',
        rate=Decimal('20.00'),
        jurisdiction_country='GB',
        reportable_category=TaxCode.ReportableCategory.VAT_STANDARD,
        tax_rate=taxes['standard'],
        external_qbo_code='VAT20', external_xero_code='OUTPUT2',
    )
    transient = TaxCode.objects.create(
        marina=marina, name='FL Transient 8%',
        rate=Decimal('8.00'),
        jurisdiction_country='US', jurisdiction_state='FL',
        jurisdiction_county='Broward',
        reportable_category=TaxCode.ReportableCategory.TRANSIENT_TAX,
        tax_rate=taxes['transient'],
        external_qbo_code='TRANSIENT8', external_xero_code='TRANSIENT',
    )
    zero = TaxCode.objects.create(
        marina=marina, name='Zero Rated',
        rate=Decimal('0.00'),
        reportable_category=TaxCode.ReportableCategory.VAT_ZERO,
        tax_rate=taxes['zero'],
        external_qbo_code='ZERO', external_xero_code='ZERORATED',
    )
    return {'standard': standard, 'transient': transient, 'zero': zero}


def _add_line(invoice, item, qty=Decimal('1')):
    total = (Decimal(qty) * item.unit_price).quantize(Decimal('0.01'))
    return InvoiceLineItem.objects.create(
        invoice=invoice,
        description=item.name,
        quantity=Decimal(qty),
        unit_price=item.unit_price,
        total_price=total,
        chargeable_item=item,
        tax_rate=Decimal(item.tax_category.rate),
    )


def make_invoice(marina, number, member=None, items=None, created_at=None,
                 paid_intent='', invoice_type='invoice', booking=None):
    """Create an open invoice + lines. `items` is a list of (ChargeableItem, qty)."""
    invoice = Invoice.objects.create(
        marina=marina, member=member, booking=booking,
        invoice_number=number, status='open', invoice_type=invoice_type,
        stripe_payment_intent_id=paid_intent,
    )
    if created_at is not None:
        Invoice.objects.filter(pk=invoice.pk).update(created_at=created_at)
        invoice.refresh_from_db()
    for item, qty in (items or []):
        _add_line(invoice, item, qty=qty)
    # Roll up totals.
    subtotal = sum((l.total_price for l in invoice.items.all()), Decimal('0.00'))
    tax_total = sum((l.line_tax    for l in invoice.items.all()), Decimal('0.00'))
    invoice.subtotal = subtotal
    invoice.tax_total = tax_total
    invoice.total = subtotal + tax_total
    invoice.save(update_fields=['subtotal', 'tax_total', 'total'])
    return invoice


def build_fixture(marina_name='Fixture Marina'):
    """
    Build the golden fixture: 5 invoices over the period 2026-04-01..2026-04-30,
    covering all categories, mixed tax codes, plus 1 credit note. Returns a dict.
    """
    marina = make_marina(name=marina_name)
    taxes = seed_basic_taxes(marina)
    items = seed_chargeable_items(marina, taxes)
    mappings = seed_gl_mappings(marina)
    tax_codes = seed_tax_codes(marina, taxes)

    member = Member.objects.create(marina=marina, name='Alice Skipper',
                                   email='alice@example.com', member_type='transient')

    base = datetime.datetime(2026, 4, 1, 12, 0, 0, tzinfo=datetime.timezone.utc)
    invs = []
    for i, (number, item, qty) in enumerate([
        ('INV-2026-0001', items['berth'],       Decimal('3')),  # transient tax
        ('INV-2026-0002', items['utility'],     Decimal('1')),
        ('INV-2026-0003', items['retail'],      Decimal('2')),
        ('INV-2026-0004', items['service'],     Decimal('1')),
        ('INV-2026-0005', items['booking_fee'], Decimal('1')),
    ]):
        created = base + datetime.timedelta(days=i)
        invs.append(make_invoice(
            marina, number, member=member,
            items=[(item, qty)], created_at=created,
            paid_intent=f'pi_test_{i}',
        ))

    # Credit note for INV-2026-0003 (retail).
    credit = make_invoice(
        marina, 'CN-2026-0001', member=member,
        items=[(items['retail'], Decimal('-2'))],
        created_at=base + datetime.timedelta(days=5),
        paid_intent='', invoice_type='credit_note',
    )
    credit.related_invoice = invs[2]
    credit.save(update_fields=['related_invoice'])

    return {
        'marina': marina,
        'taxes': taxes,
        'items': items,
        'mappings': mappings,
        'tax_codes': tax_codes,
        'member': member,
        'invoices': invs,
        'credit_note': credit,
    }
