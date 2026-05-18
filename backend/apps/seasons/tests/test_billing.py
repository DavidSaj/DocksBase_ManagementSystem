"""Invoice-per-instalment + deposit-invoice billing tests (spec §3.3 Option A)."""
from datetime import date
from decimal import Decimal

import pytest

from apps.seasons import services


@pytest.mark.django_db
def test_instalment_invoice_creation(make_lease):
    lease = make_lease()
    services.transition_lease(lease, 'deposit_paid')
    inst = lease.instalments.first()
    inv = services.issue_instalment_invoice(inst)
    assert inv.source_type == 'lease_instalment'
    assert inv.source_id == str(inst.pk)
    assert inv.status == 'open'
    inst.refresh_from_db()
    assert inst.status == 'invoiced'
    assert inst.invoice_id == inv.pk
    # Idempotent.
    inv2 = services.issue_instalment_invoice(inst)
    assert inv2.pk == inv.pk


@pytest.mark.django_db
def test_mark_instalment_paid(make_lease):
    lease = make_lease()
    services.transition_lease(lease, 'deposit_paid')
    inst = lease.instalments.first()
    services.mark_instalment_paid(inst, method='cash')
    inst.refresh_from_db()
    assert inst.status == 'paid'
    assert inst.invoice.status == 'paid'


@pytest.mark.django_db
def test_deposit_invoice_creation(make_lease):
    lease = make_lease()  # deposit=€500 from rate_card snapshot
    inv = services.issue_deposit_invoice(lease)
    assert inv.source_type == 'lease_deposit'
    assert inv.total == Decimal('500.00')


@pytest.mark.django_db
def test_instalment_amounts_sum_to_remaining(make_lease):
    """6 monthly instalments of (4500 - 500) / 6 = 666.67 with rounding
    drift absorbed by the last instalment."""
    lease = make_lease()
    services.transition_lease(lease, 'deposit_paid')
    amounts = [Decimal(i.amount) for i in lease.instalments.order_by('sequence')]
    assert sum(amounts) == Decimal('4000.00')
    assert len(amounts) == 6
