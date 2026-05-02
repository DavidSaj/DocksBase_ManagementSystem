from decimal import Decimal
from datetime import date
from django.test import TestCase
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.billing.models import Invoice, AccountPayment, PaymentAllocation
from apps.billing.allocation_service import allocate_payment


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_member(marina, name='Hans', email='hans@test.com'):
    return Member.objects.create(marina=marina, name=name, email=email)


def make_invoice(marina, member, total, due_date=None, source_type='berth'):
    count = Invoice.objects.filter(marina=marina).count()
    inv = Invoice.objects.create(
        marina=marina,
        member=member,
        invoice_number=f'INV-{count + 1:04d}',
        status='open',
        subtotal=total,
        total=total,
        source_type=source_type,
    )
    if due_date:
        inv.due_date = due_date
        inv.save(update_fields=['due_date'])
    return inv


class AllocationEngineTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    def test_full_payment_settles_all_invoices(self):
        inv1 = make_invoice(self.marina, self.member, Decimal('200.00'), date(2026, 3, 1))
        inv2 = make_invoice(self.marina, self.member, Decimal('300.00'), date(2026, 4, 1))
        payment, result = allocate_payment(self.member, Decimal('500.00'), 'bank_transfer')
        inv1.refresh_from_db()
        inv2.refresh_from_db()
        self.assertEqual(inv1.status, 'paid')
        self.assertEqual(inv2.status, 'paid')
        self.assertEqual(result['credit_remaining'], '0.00')
        self.assertIn(inv1.pk, result['invoices_settled'])
        self.assertIn(inv2.pk, result['invoices_settled'])

    def test_oldest_due_date_settled_first(self):
        inv_new = make_invoice(self.marina, self.member, Decimal('300.00'), date(2026, 4, 1))
        inv_old = make_invoice(self.marina, self.member, Decimal('200.00'), date(2026, 3, 1))
        allocate_payment(self.member, Decimal('200.00'), 'cash')
        inv_old.refresh_from_db()
        inv_new.refresh_from_db()
        self.assertEqual(inv_old.status, 'paid')
        self.assertEqual(inv_new.status, 'open')

    def test_partial_payment_leaves_invoice_open(self):
        inv = make_invoice(self.marina, self.member, Decimal('500.00'))
        payment, result = allocate_payment(self.member, Decimal('300.00'), 'cash')
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'open')
        self.assertIn(inv.pk, result['invoices_partial'])
        self.assertEqual(result['credit_remaining'], '0.00')
        alloc = PaymentAllocation.objects.get(payment=payment, invoice=inv)
        self.assertEqual(alloc.allocated_amount, Decimal('300.00'))

    def test_overpayment_stores_credit_on_payment(self):
        inv = make_invoice(self.marina, self.member, Decimal('200.00'))
        payment, result = allocate_payment(self.member, Decimal('350.00'), 'cash')
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'paid')
        self.assertEqual(result['credit_remaining'], '150.00')
        payment.refresh_from_db()
        self.assertEqual(payment.credit_remaining, Decimal('150.00'))

    def test_zero_amount_raises_value_error(self):
        with self.assertRaises(ValueError):
            allocate_payment(self.member, Decimal('0.00'), 'cash')

    def test_negative_amount_raises_value_error(self):
        with self.assertRaises(ValueError):
            allocate_payment(self.member, Decimal('-10.00'), 'cash')

    def test_no_open_invoices_records_full_credit(self):
        payment, result = allocate_payment(self.member, Decimal('500.00'), 'cash')
        self.assertEqual(result['credit_remaining'], '500.00')
        self.assertEqual(result['invoices_settled'], [])
        self.assertEqual(result['invoices_partial'], [])

    def test_second_payment_uses_remaining_balance_not_invoice_total(self):
        inv = make_invoice(self.marina, self.member, Decimal('500.00'))
        allocate_payment(self.member, Decimal('300.00'), 'cash')
        payment2, result2 = allocate_payment(self.member, Decimal('200.00'), 'cash')
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'paid')
        self.assertIn(inv.pk, result2['invoices_settled'])
        self.assertEqual(result2['credit_remaining'], '0.00')

    def test_result_dict_has_correct_shape(self):
        make_invoice(self.marina, self.member, Decimal('100.00'))
        _, result = allocate_payment(self.member, Decimal('100.00'), 'cash')
        for key in ('payment_id', 'amount_received', 'amount_allocated', 'credit_remaining',
                    'invoices_settled', 'invoices_partial'):
            self.assertIn(key, result)
