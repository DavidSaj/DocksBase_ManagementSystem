# Boater Unified Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the manager "Boater Accounts" ledger tab, a payment allocation engine, a boater portal invite flow, and a headless mobile API — giving every dollar a visible home before any live payment processing is wired.

**Architecture:** New `AccountPayment` + `PaymentAllocation` models power an oldest-first allocation engine called from a new `account_views.py`. A shared `_build_detail()` helper serialises member balances for both the manager detail view and the mobile `my-account` endpoint. The boater portal invite uses Django's built-in `PasswordResetTokenGenerator` + Resend email via the existing `anymail` setup.

**Tech Stack:** Django 4.x, DRF, `rest_framework_simplejwt`, `django-anymail` (Resend), React 18, existing `APIClient` test pattern.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/apps/billing/models.py` | Add `AccountPayment`, `PaymentAllocation` |
| Create | `backend/apps/billing/allocation_service.py` | Pure allocation engine function |
| Create | `backend/apps/billing/account_views.py` | 4 account-scoped views + `_build_detail` helper |
| Modify | `backend/apps/billing/urls.py` | Add account URL patterns |
| Create | `backend/apps/billing/tests_allocation.py` | Allocation engine unit tests |
| Create | `backend/apps/billing/tests_account_views.py` | Account views integration tests |
| Create | `backend/apps/mobile/__init__.py` | App init |
| Create | `backend/apps/mobile/apps.py` | App config |
| Create | `backend/apps/mobile/views.py` | `MyAccountView`, `ActivatePortalView` |
| Create | `backend/apps/mobile/urls.py` | Mobile URL patterns |
| Create | `backend/apps/mobile/tests.py` | Mobile view tests |
| Modify | `backend/config/urls.py` | Mount `mobile/` namespace |
| Modify | `backend/config/settings/base.py` | Add `apps.mobile` + `PORTAL_BASE_URL` |
| Create | `frontend/src/hooks/useBoaterAccounts.js` | Fetch accounts list + drawer data |
| Modify | `frontend/src/screens/Billing.jsx` | Add "Boater Accounts" tab, list table, drawer |

---

## Task 1: Add AccountPayment and PaymentAllocation models

**Files:**
- Modify: `backend/apps/billing/models.py`

- [ ] **Step 1: Append the two new models to the end of `billing/models.py`**

Open `backend/apps/billing/models.py`. After the `ChargeableItem` class (currently the last class), append:

```python
class AccountPayment(models.Model):
    METHOD_CHOICES = [
        ('cash',          'Cash'),
        ('external_card', 'External Card'),
        ('bank_transfer', 'Bank Transfer'),
    ]

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='account_payments')
    member           = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='account_payments')
    amount           = models.DecimalField(max_digits=10, decimal_places=2)
    credit_remaining = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    method           = models.CharField(max_length=20, choices=METHOD_CHOICES)
    recorded_by      = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True)
    notes            = models.CharField(max_length=500, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'AP-{self.pk} — {self.member} (€{self.amount})'


class PaymentAllocation(models.Model):
    payment          = models.ForeignKey(AccountPayment, on_delete=models.CASCADE, related_name='allocations')
    invoice          = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name='allocations')
    allocated_amount = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f'Alloc {self.pk}: €{self.allocated_amount} → {self.invoice}'
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd backend
python manage.py makemigrations billing --name account_payment_allocation
python manage.py migrate
```

Expected output: `Applying billing.XXXX_account_payment_allocation... OK`

- [ ] **Step 3: Verify models exist in the shell**

```bash
python manage.py shell -c "from apps.billing.models import AccountPayment, PaymentAllocation; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/billing/models.py backend/apps/billing/migrations/
git commit -m "feat(billing): add AccountPayment and PaymentAllocation models"
```

---

## Task 2: Allocation service — TDD

**Files:**
- Create: `backend/apps/billing/allocation_service.py`
- Create: `backend/apps/billing/tests_allocation.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/billing/tests_allocation.py`:

```python
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
```

- [ ] **Step 2: Run tests — expect ImportError (module doesn't exist yet)**

```bash
cd backend
python manage.py test apps.billing.tests_allocation --verbosity=2
```

Expected: `ImportError: cannot import name 'allocate_payment'`

- [ ] **Step 3: Create the allocation service**

Create `backend/apps/billing/allocation_service.py`:

```python
from decimal import Decimal
from django.db.models import F, Sum, Value, DecimalField
from django.db.models.functions import Coalesce
from django.utils import timezone


def allocate_payment(member, amount, method, notes='', recorded_by=None):
    """
    Create an AccountPayment and allocate it across the member's open invoices
    oldest-due-date first, then oldest-created-at as tie-breaker.

    Returns (AccountPayment instance, result_dict).
    Caller is responsible for wrapping in transaction.atomic() when needed.
    """
    from .models import AccountPayment, PaymentAllocation, Invoice

    amount = Decimal(str(amount))
    if amount <= Decimal('0'):
        raise ValueError('amount must be greater than zero')

    payment = AccountPayment.objects.create(
        marina=member.marina,
        member=member,
        amount=amount,
        credit_remaining=Decimal('0.00'),
        method=method,
        recorded_by=recorded_by,
        notes=notes,
    )

    open_invoices = list(
        Invoice.objects
        .filter(member=member, status='open')
        .annotate(
            already_paid=Coalesce(
                Sum('allocations__allocated_amount'),
                Value(Decimal('0.00'), output_field=DecimalField()),
            )
        )
        .order_by(F('due_date').asc(nulls_last=True), 'created_at')
    )

    remaining = amount
    settled = []
    partial = []

    for inv in open_invoices:
        if remaining <= Decimal('0'):
            break
        balance_due = inv.total - inv.already_paid
        if balance_due <= Decimal('0'):
            continue
        apply = min(remaining, balance_due)
        PaymentAllocation.objects.create(
            payment=payment,
            invoice=inv,
            allocated_amount=apply,
        )
        remaining -= apply
        if apply >= balance_due:
            Invoice.objects.filter(pk=inv.pk, status='open').update(
                status='paid',
                paid_at=timezone.now(),
            )
            settled.append(inv.pk)
        else:
            partial.append(inv.pk)

    payment.credit_remaining = remaining
    payment.save(update_fields=['credit_remaining'])

    return payment, {
        'payment_id': payment.pk,
        'amount_received': str(amount),
        'amount_allocated': str(amount - remaining),
        'credit_remaining': str(remaining),
        'invoices_settled': settled,
        'invoices_partial': partial,
    }
```

- [ ] **Step 4: Run tests — expect all 8 to pass**

```bash
python manage.py test apps.billing.tests_allocation --verbosity=2
```

Expected: `Ran 8 tests in X.XXXs — OK`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/billing/allocation_service.py backend/apps/billing/tests_allocation.py
git commit -m "feat(billing): add allocation engine with oldest-first cascade"
```

---

## Task 3: Account list and detail views — TDD

**Files:**
- Create: `backend/apps/billing/account_views.py`
- Create: `backend/apps/billing/tests_account_views.py` (partial — list + detail)

- [ ] **Step 1: Write failing tests for AccountListView and AccountDetailView**

Create `backend/apps/billing/tests_account_views.py`:

```python
from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.billing.models import Invoice, AccountPayment, PaymentAllocation


def make_marina(name='Test Marina'):
    return Marina.objects.create(name=name)


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='manager')


def make_member(marina, name='Hans', email='hans@test.com'):
    return Member.objects.create(marina=marina, name=name, email=email)


def make_open_invoice(marina, member, total, source_type='berth'):
    count = Invoice.objects.filter(marina=marina).count()
    return Invoice.objects.create(
        marina=marina, member=member,
        invoice_number=f'INV-{count + 1:04d}',
        status='open', subtotal=total, total=total,
        source_type=source_type,
    )


class AccountListViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_only_members_with_outstanding_balance(self):
        m1 = make_member(self.marina, 'Alice', 'alice@test.com')
        m2 = make_member(self.marina, 'Bob', 'bob@test.com')
        make_open_invoice(self.marina, m1, Decimal('100.00'))
        resp = self.client.get('/api/v1/billing/accounts/')
        self.assertEqual(resp.status_code, 200)
        names = [r['name'] for r in resp.json()['results']]
        self.assertIn('Alice', names)
        self.assertNotIn('Bob', names)

    def test_show_all_includes_zero_balance_members(self):
        make_member(self.marina, 'Zero', 'zero@test.com')
        resp = self.client.get('/api/v1/billing/accounts/', {'show_all': 'true'})
        self.assertEqual(resp.status_code, 200)
        names = [r['name'] for r in resp.json()['results']]
        self.assertIn('Zero', names)

    def test_search_filters_by_name_case_insensitive(self):
        make_member(self.marina, 'Hans Müller', 'hans@test.com')
        make_member(self.marina, 'Maria Schmidt', 'maria@test.com')
        resp = self.client.get('/api/v1/billing/accounts/', {'search': 'hans', 'show_all': 'true'})
        names = [r['name'] for r in resp.json()['results']]
        self.assertIn('Hans Müller', names)
        self.assertNotIn('Maria Schmidt', names)

    def test_response_includes_required_fields(self):
        m = make_member(self.marina)
        make_open_invoice(self.marina, m, Decimal('500.00'))
        resp = self.client.get('/api/v1/billing/accounts/')
        row = resp.json()['results'][0]
        for field in ('member_id', 'name', 'member_type', 'total_outstanding',
                      'credit_on_account', 'open_invoice_count', 'portal_active'):
            self.assertIn(field, row)

    def test_scoped_to_requesting_marina(self):
        other = make_marina('Other Marina')
        foreign_member = make_member(other, 'Foreigner', 'f@test.com')
        make_open_invoice(other, foreign_member, Decimal('999.00'))
        resp = self.client.get('/api/v1/billing/accounts/')
        names = [r['name'] for r in resp.json()['results']]
        self.assertNotIn('Foreigner', names)

    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.get('/api/v1/billing/accounts/')
        self.assertEqual(resp.status_code, 401)


class AccountDetailViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.member = make_member(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_correct_structure(self):
        make_open_invoice(self.marina, self.member, Decimal('500.00'), 'berth')
        resp = self.client.get(f'/api/v1/billing/accounts/{self.member.pk}/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('member', data)
        self.assertIn('summary', data)
        self.assertIn('open_invoices', data)

    def test_total_outstanding_reflects_partial_allocations(self):
        inv = make_open_invoice(self.marina, self.member, Decimal('500.00'))
        payment = AccountPayment.objects.create(
            marina=self.marina, member=self.member,
            amount=Decimal('300.00'), method='cash',
        )
        PaymentAllocation.objects.create(
            payment=payment, invoice=inv, allocated_amount=Decimal('300.00')
        )
        resp = self.client.get(f'/api/v1/billing/accounts/{self.member.pk}/')
        data = resp.json()
        self.assertEqual(data['summary']['total_outstanding'], '200.00')
        self.assertEqual(data['open_invoices'][0]['amount_paid_so_far'], '300.00')

    def test_by_category_aggregation(self):
        make_open_invoice(self.marina, self.member, Decimal('400.00'), 'berth')
        make_open_invoice(self.marina, self.member, Decimal('100.00'), 'fuel_dock')
        resp = self.client.get(f'/api/v1/billing/accounts/{self.member.pk}/')
        cats = resp.json()['summary']['by_category']
        self.assertEqual(cats['berth'], '400.00')
        self.assertEqual(cats['fuel'], '100.00')

    def test_404_for_member_in_different_marina(self):
        other = make_marina('Other')
        foreign = make_member(other, 'Foreigner', 'f@test.com')
        resp = self.client.get(f'/api/v1/billing/accounts/{foreign.pk}/')
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run tests — expect ImportError**

```bash
python manage.py test apps.billing.tests_account_views --verbosity=2
```

Expected: `ImportError` (views don't exist yet)

- [ ] **Step 3: Create `account_views.py` with list and detail views**

Create `backend/apps/billing/account_views.py`:

```python
from decimal import Decimal
from django.db import transaction
from django.db.models import F, Sum, Value, DecimalField
from django.db.models.functions import Coalesce
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.members.models import Member
from .models import Invoice, AccountPayment


SOURCE_TO_CAT = {
    'berth': 'berth',
    'booking': 'berth',
    'fuel_dock': 'fuel',
    'restaurant_order': 'restaurant',
}


def _berth_code_for_member(member):
    from apps.reservations.models import Booking
    booking = (
        Booking.objects
        .filter(vessel__owner=member, status='checked_in')
        .select_related('berth')
        .order_by('-check_in')
        .first()
    )
    return booking.berth.code if (booking and booking.berth) else None


def _credit_on_account(member):
    return member.account_payments.aggregate(
        total=Coalesce(
            Sum('credit_remaining'),
            Value(Decimal('0.00'), output_field=DecimalField()),
        )
    )['total']


def _build_detail(member):
    """
    Shared serialiser used by AccountDetailView and MyAccountView.
    Returns the full account detail dict for a member.
    """
    open_invoices = list(
        Invoice.objects
        .filter(member=member, status='open')
        .prefetch_related('allocations', 'items')
        .order_by(F('due_date').asc(nulls_last=True), 'created_at')
    )

    total_outstanding = Decimal('0.00')
    by_category = {
        'berth': Decimal('0'), 'fuel': Decimal('0'),
        'restaurant': Decimal('0'), 'other': Decimal('0'),
    }
    invoices_data = []

    for inv in open_invoices:
        already_paid = inv.allocations.aggregate(
            s=Coalesce(
                Sum('allocated_amount'),
                Value(Decimal('0.00'), output_field=DecimalField()),
            )
        )['s']
        balance = inv.total - already_paid
        total_outstanding += balance
        cat = SOURCE_TO_CAT.get(inv.source_type, 'other')
        by_category[cat] += balance
        invoices_data.append({
            'id': inv.pk,
            'invoice_number': inv.invoice_number,
            'source_type': inv.source_type,
            'total': str(inv.total),
            'amount_paid_so_far': str(already_paid),
            'due_date': str(inv.due_date) if inv.due_date else None,
            'status': inv.status,
            'created_at': inv.created_at.isoformat(),
            'items': [
                {
                    'description': item.description,
                    'quantity': str(item.quantity),
                    'unit_price': str(item.unit_price),
                    'total_price': str(item.total_price),
                }
                for item in inv.items.all()
            ],
        })

    credit = _credit_on_account(member)
    portal_active = bool(member.boater_user_id and member.boater_user.is_active)

    return {
        'member': {
            'id': member.pk,
            'name': member.name,
            'email': member.email,
            'member_type': member.member_type,
            'berth_code': _berth_code_for_member(member),
            'portal_active': portal_active,
        },
        'summary': {
            'total_outstanding': str(total_outstanding),
            'credit_on_account': str(credit),
            'by_category': {k: str(v) for k, v in by_category.items()},
        },
        'open_invoices': invoices_data,
    }


class AccountListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        qs = (
            Member.objects
            .filter(marina=marina)
            .prefetch_related('invoices__allocations', 'account_payments')
            .select_related('boater_user')
        )
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(name__icontains=search)

        show_all = request.query_params.get('show_all', '').lower() == 'true'
        results = []

        for member in qs:
            open_invoices = [inv for inv in member.invoices.all() if inv.status == 'open']
            total_outstanding = Decimal('0.00')
            oldest_due = None

            for inv in open_invoices:
                already_paid = inv.allocations.aggregate(
                    s=Coalesce(
                        Sum('allocated_amount'),
                        Value(Decimal('0.00'), output_field=DecimalField()),
                    )
                )['s']
                total_outstanding += inv.total - already_paid
                if inv.due_date and (oldest_due is None or inv.due_date < oldest_due):
                    oldest_due = inv.due_date

            if not show_all and total_outstanding == Decimal('0.00'):
                continue

            credit = _credit_on_account(member)
            results.append({
                'member_id': member.pk,
                'name': member.name,
                'member_type': member.member_type,
                'berth_code': _berth_code_for_member(member),
                'total_outstanding': str(total_outstanding),
                'credit_on_account': str(credit),
                'open_invoice_count': len(open_invoices),
                'oldest_due_date': str(oldest_due) if oldest_due else None,
                'portal_active': bool(member.boater_user_id and member.boater_user.is_active),
            })

        results.sort(key=lambda r: Decimal(r['total_outstanding']), reverse=True)
        return Response({'results': results})


class AccountDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, member_id):
        try:
            member = (
                Member.objects
                .select_related('boater_user')
                .get(pk=member_id, marina=request.user.marina)
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        return Response(_build_detail(member))


class RecordPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, member_id):
        try:
            member = Member.objects.get(pk=member_id, marina=request.user.marina)
        except Member.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        try:
            amount = Decimal(str(request.data.get('amount', 0)))
        except Exception:
            return Response({'detail': 'Invalid amount.'}, status=http_status.HTTP_400_BAD_REQUEST)

        method = request.data.get('method', '')
        valid_methods = [m[0] for m in AccountPayment.METHOD_CHOICES]
        if method not in valid_methods:
            return Response(
                {'detail': f"method must be one of: {', '.join(valid_methods)}"},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        from .allocation_service import allocate_payment
        try:
            with transaction.atomic():
                _, result = allocate_payment(
                    member=member,
                    amount=amount,
                    method=method,
                    notes=request.data.get('notes', ''),
                )
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response(result)


class GenerateInviteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, member_id):
        try:
            member = (
                Member.objects
                .select_related('boater_user')
                .get(pk=member_id, marina=request.user.marina)
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if not member.email:
            return Response(
                {'detail': 'Member has no email address.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        from django.contrib.auth import get_user_model
        from django.contrib.auth.tokens import default_token_generator
        from django.core.mail import send_mail
        from django.conf import settings
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode

        User = get_user_model()

        if member.boater_user is None:
            user = User.objects.create_user(
                email=member.email,
                password=None,
                marina=member.marina,
                role='boater',
                is_active=False,
            )
            member.boater_user = user
            member.save(update_fields=['boater_user'])
        else:
            user = member.boater_user

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        portal_url = getattr(settings, 'PORTAL_BASE_URL', 'https://portal.docksbase.com')
        link = f'{portal_url}/activate/{uid}/{token}/'

        try:
            send_mail(
                subject='Your DocksBase Boater Portal Access',
                message=(
                    f'Hello {member.name},\n\n'
                    f'You have been invited to access your boater account at '
                    f'{request.user.marina.name}.\n\n'
                    f'Set your password here:\n{link}\n\n'
                    f'This link expires in 3 days.\n\nDocksBase'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[member.email],
                fail_silently=False,
            )
        except Exception:
            return Response(
                {'detail': 'Failed to send invite email. Please try again.'},
                status=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({'detail': f'Invite sent to {member.email}.'})
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
python manage.py test apps.billing.tests_account_views --verbosity=2
```

Expected: `Ran 10 tests in X.XXXs — OK`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/billing/account_views.py backend/apps/billing/tests_account_views.py
git commit -m "feat(billing): add AccountListView, AccountDetailView, RecordPaymentView, GenerateInviteView"
```

---

## Task 4: Add RecordPaymentView and GenerateInviteView tests

**Files:**
- Modify: `backend/apps/billing/tests_account_views.py`

The views were already created in Task 3. Now add the tests for the two action views.

- [ ] **Step 1: Append RecordPaymentView and GenerateInviteView tests to `tests_account_views.py`**

Append to the end of `backend/apps/billing/tests_account_views.py`:

```python
class RecordPaymentViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.member = make_member(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_allocates_payment_and_returns_result(self):
        make_open_invoice(self.marina, self.member, Decimal('300.00'))
        resp = self.client.post(
            f'/api/v1/billing/accounts/{self.member.pk}/payments/',
            {'amount': '300.00', 'method': 'cash'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['credit_remaining'], '0.00')
        self.assertEqual(len(data['invoices_settled']), 1)

    def test_rejects_zero_amount(self):
        resp = self.client.post(
            f'/api/v1/billing/accounts/{self.member.pk}/payments/',
            {'amount': '0', 'method': 'cash'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_rejects_invalid_method(self):
        resp = self.client.post(
            f'/api/v1/billing/accounts/{self.member.pk}/payments/',
            {'amount': '100', 'method': 'bitcoin'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_404_for_foreign_member(self):
        other = make_marina('Other')
        foreign = make_member(other, 'F', 'f@test.com')
        resp = self.client.post(
            f'/api/v1/billing/accounts/{foreign.pk}/payments/',
            {'amount': '100', 'method': 'cash'},
            format='json',
        )
        self.assertEqual(resp.status_code, 404)


class GenerateInviteViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.member = make_member(self.marina, email='hans@test.com')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_creates_inactive_boater_user_and_sends_email(self):
        from django.core import mail
        resp = self.client.post(f'/api/v1/billing/accounts/{self.member.pk}/generate-invite/')
        self.assertEqual(resp.status_code, 200)
        self.member.refresh_from_db()
        self.assertIsNotNone(self.member.boater_user)
        self.assertFalse(self.member.boater_user.is_active)
        self.assertEqual(self.member.boater_user.role, 'boater')
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('hans@test.com', mail.outbox[0].to)
        self.assertIn('/activate/', mail.outbox[0].body)

    def test_resends_invite_without_creating_duplicate_user(self):
        from django.core import mail
        from apps.accounts.models import User
        self.client.post(f'/api/v1/billing/accounts/{self.member.pk}/generate-invite/')
        user_count_before = User.objects.filter(email='hans@test.com').count()
        resp = self.client.post(f'/api/v1/billing/accounts/{self.member.pk}/generate-invite/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(User.objects.filter(email='hans@test.com').count(), user_count_before)
        self.assertEqual(len(mail.outbox), 2)

    def test_400_when_member_has_no_email(self):
        no_email = Member.objects.create(marina=self.marina, name='NoEmail')
        resp = self.client.post(f'/api/v1/billing/accounts/{no_email.pk}/generate-invite/')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('email', resp.json()['detail'].lower())
```

- [ ] **Step 2: Run all account view tests**

```bash
python manage.py test apps.billing.tests_account_views --verbosity=2
```

Expected: `Ran 17 tests in X.XXXs — OK`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/billing/tests_account_views.py
git commit -m "test(billing): add RecordPaymentView and GenerateInviteView tests"
```

---

## Task 5: Wire billing account URLs

**Files:**
- Modify: `backend/apps/billing/urls.py`

- [ ] **Step 1: Add account URL patterns to `billing/urls.py`**

Open `backend/apps/billing/urls.py`. The current imports block is:

```python
from django.urls import path
from .views import (
    StripeWebhookView, InvoiceListView, ...
)
```

Add the account view imports after the existing import block, then add 4 new URL patterns:

```python
from .account_views import (
    AccountListView, AccountDetailView, RecordPaymentView, GenerateInviteView,
)
```

Add to `urlpatterns`:

```python
    path('accounts/',                                AccountListView.as_view(),    name='account_list'),
    path('accounts/<int:member_id>/',                AccountDetailView.as_view(),  name='account_detail'),
    path('accounts/<int:member_id>/payments/',       RecordPaymentView.as_view(),  name='account_payments'),
    path('accounts/<int:member_id>/generate-invite/',GenerateInviteView.as_view(), name='account_generate_invite'),
```

- [ ] **Step 2: Run all billing tests to confirm no regressions**

```bash
python manage.py test apps.billing --verbosity=2
```

Expected: All tests pass.

- [ ] **Step 3: Smoke-test the list endpoint manually**

```bash
python manage.py shell -c "
from apps.accounts.models import Marina, User
m = Marina.objects.create(name='Smoke')
u = User.objects.create_user(email='s@t.com', password='pass', marina=m, role='manager')
print('marina pk:', m.pk, 'user pk:', u.pk)
"
```

Then hit the endpoint (requires a running dev server): `GET /api/v1/billing/accounts/` with the test user's token. Expected: `{"results": []}`.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/billing/urls.py
git commit -m "feat(billing): wire account list/detail/payments/invite URLs"
```

---

## Task 6: Mobile app — MyAccountView (TDD)

**Files:**
- Create: `backend/apps/mobile/__init__.py`
- Create: `backend/apps/mobile/apps.py`
- Create: `backend/apps/mobile/urls.py`
- Create: `backend/apps/mobile/views.py`
- Create: `backend/apps/mobile/tests.py`

- [ ] **Step 1: Write failing tests**

Create `backend/apps/mobile/tests.py`:

```python
from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.billing.models import Invoice


def make_marina(name='Test Marina'):
    return Marina.objects.create(name=name)


def make_open_invoice(marina, member, total):
    count = Invoice.objects.count()
    return Invoice.objects.create(
        marina=marina, member=member,
        invoice_number=f'INV-{count + 1:04d}',
        status='open', subtotal=total, total=total, source_type='berth',
    )


class MyAccountViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.boater_user = User.objects.create_user(
            email='boater@test.com', password='pass',
            marina=self.marina, role='boater',
        )
        self.member = Member.objects.create(
            marina=self.marina, name='Hans', email='boater@test.com',
            boater_user=self.boater_user,
        )
        self.client = APIClient()

    def test_returns_account_data_for_boater(self):
        make_open_invoice(self.marina, self.member, Decimal('500.00'))
        self.client.force_authenticate(user=self.boater_user)
        resp = self.client.get('/api/v1/mobile/my-account/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['member']['name'], 'Hans')
        self.assertEqual(data['summary']['total_outstanding'], '500.00')

    def test_403_for_staff_user_without_member_profile(self):
        staff = User.objects.create_user(
            email='staff@test.com', password='pass',
            marina=self.marina, role='manager',
        )
        self.client.force_authenticate(user=staff)
        resp = self.client.get('/api/v1/mobile/my-account/')
        self.assertEqual(resp.status_code, 403)

    def test_401_for_unauthenticated(self):
        resp = self.client.get('/api/v1/mobile/my-account/')
        self.assertEqual(resp.status_code, 401)


class ActivatePortalViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.boater_user = User.objects.create_user(
            email='boater@test.com', password=None,
            marina=self.marina, role='boater', is_active=False,
        )
        Member.objects.create(
            marina=self.marina, name='Hans',
            boater_user=self.boater_user,
        )
        self.client = APIClient()

    def _make_token(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        uid = urlsafe_base64_encode(force_bytes(self.boater_user.pk))
        token = default_token_generator.make_token(self.boater_user)
        return uid, token

    def test_valid_token_activates_user_and_returns_jwt(self):
        uid, token = self._make_token()
        resp = self.client.post('/api/v1/mobile/activate/', {
            'uid': uid, 'token': token, 'password': 'NewPass123!',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.json())
        self.assertIn('refresh', resp.json())
        self.boater_user.refresh_from_db()
        self.assertTrue(self.boater_user.is_active)
        self.assertTrue(self.boater_user.check_password('NewPass123!'))

    def test_invalid_token_returns_400(self):
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        uid = urlsafe_base64_encode(force_bytes(self.boater_user.pk))
        resp = self.client.post('/api/v1/mobile/activate/', {
            'uid': uid, 'token': 'invalid-token', 'password': 'Pass123!',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.boater_user.refresh_from_db()
        self.assertFalse(self.boater_user.is_active)

    def test_missing_fields_returns_400(self):
        resp = self.client.post('/api/v1/mobile/activate/', {}, format='json')
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run tests — expect ImportError**

```bash
python manage.py test apps.mobile --verbosity=2
```

Expected: `ModuleNotFoundError: No module named 'apps.mobile'`

- [ ] **Step 3: Create the mobile app skeleton**

```bash
# Create the directory and files
```

Create `backend/apps/mobile/__init__.py` (empty file).

Create `backend/apps/mobile/apps.py`:

```python
from django.apps import AppConfig


class MobileConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.mobile'
```

- [ ] **Step 4: Create `mobile/views.py`**

Create `backend/apps/mobile/views.py`:

```python
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import status as http_status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.billing.account_views import _build_detail

User = get_user_model()


class MyAccountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            member = request.user.member_profile
        except Exception:
            return Response(
                {'detail': 'No member account linked to this user.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        return Response(_build_detail(member))


class ActivatePortalView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        uid   = request.data.get('uid', '')
        token = request.data.get('token', '')
        password = request.data.get('password', '')

        if not all([uid, token, password]):
            return Response(
                {'detail': 'uid, token, and password are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_pk = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_pk)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response(
                {'detail': 'Invalid or expired activation link.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if not default_token_generator.check_token(user, token):
            return Response(
                {'detail': 'Invalid or expired activation link.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(password)
        user.is_active = True
        user.save(update_fields=['password', 'is_active'])

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        })
```

- [ ] **Step 5: Create `mobile/urls.py`**

Create `backend/apps/mobile/urls.py`:

```python
from django.urls import path
from .views import MyAccountView, ActivatePortalView

urlpatterns = [
    path('my-account/', MyAccountView.as_view(), name='mobile_my_account'),
    path('activate/',   ActivatePortalView.as_view(), name='mobile_activate'),
]
```

- [ ] **Step 6: Run tests — expect all 7 to pass**

```bash
python manage.py test apps.mobile --verbosity=2
```

Expected: `Ran 7 tests in X.XXXs — OK`

- [ ] **Step 7: Commit**

```bash
git add backend/apps/mobile/
git commit -m "feat(mobile): add MyAccountView and ActivatePortalView"
```

---

## Task 7: Wire mobile URLs and settings

**Files:**
- Modify: `backend/config/settings/base.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Add `apps.mobile` to `INSTALLED_APPS` and `PORTAL_BASE_URL` to `base.py`**

Open `backend/config/settings/base.py`.

In the `LOCAL_APPS` list, add `'apps.mobile'` after `'apps.portal'`:

```python
LOCAL_APPS = [
    ...
    'apps.portal',
    'apps.admin_portal',
    'apps.mobile',      # ← add this
]
```

After the `DEFAULT_FROM_EMAIL` line (currently line 110), add:

```python
PORTAL_BASE_URL = os.environ.get('PORTAL_BASE_URL', 'https://portal.docksbase.com')
```

- [ ] **Step 2: Mount mobile URLs in `config/urls.py`**

Open `backend/config/urls.py`. Inside the `api/v1/` include block, add:

```python
        path('mobile/', include('apps.mobile.urls')),
```

The `urlpatterns` block becomes:

```python
urlpatterns = [
    path('_platform/admin/', admin.site.urls),
    path('api/v1/', include([
        path('auth/', include('apps.accounts.urls')),
        path('admin/', include('apps.admin_portal.urls')),
        path('', include('apps.berths.urls')),
        path('', include('apps.reservations.urls')),
        path('', include('apps.vessels.urls')),
        path('', include('apps.members.urls')),
        path('billing/', include('apps.billing.urls')),
        path('', include('apps.maintenance.urls')),
        path('', include('apps.staff.urls')),
        path('', include('apps.boatyard.urls')),
        path('', include('apps.documents.urls')),
        path('', include('apps.restaurant.urls')),
        path('', include('apps.events.urls')),
        path('', include('apps.sales.urls')),
        path('', include('apps.reports.urls')),
        path('', include('apps.fuel_dock.urls')),
        path('marina/', include('apps.accounts.marina_urls')),
        path('', include('apps.portal.urls')),
        path('mobile/', include('apps.mobile.urls')),   # ← add this
    ])),
]
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
python manage.py test --verbosity=1
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/config/settings/base.py backend/config/urls.py
git commit -m "feat(mobile): wire mobile URLs and PORTAL_BASE_URL setting"
```

---

## Task 8: Frontend hook — useBoaterAccounts

**Files:**
- Create: `frontend/src/hooks/useBoaterAccounts.js`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useBoaterAccounts.js`:

```javascript
import { useState, useCallback } from 'react';
import api from '../api.js';

export default function useBoaterAccounts() {
  const [accounts, setAccounts]           = useState([]);
  const [loading, setLoading]             = useState(false);
  const [selectedId, setSelectedId]       = useState(null);
  const [drawerData, setDrawerData]       = useState(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const fetchAccounts = useCallback(async ({ search = '', showAll = false } = {}) => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (showAll) params.show_all = 'true';
    try {
      const r = await api.get('/billing/accounts/', { params });
      setAccounts(r.data.results ?? r.data);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const openDrawer = useCallback(async (memberId) => {
    setSelectedId(memberId);
    setDrawerLoading(true);
    try {
      const r = await api.get(`/billing/accounts/${memberId}/`);
      setDrawerData(r.data);
    } catch {
      setDrawerData(null);
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const refreshDrawer = useCallback(async (memberId) => {
    if (!memberId) return;
    setDrawerLoading(true);
    try {
      const r = await api.get(`/billing/accounts/${memberId}/`);
      setDrawerData(r.data);
    } catch {
      // keep existing data on refetch failure
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedId(null);
    setDrawerData(null);
  }, []);

  return {
    accounts, loading, fetchAccounts,
    selectedId, drawerData, drawerLoading,
    openDrawer, refreshDrawer, closeDrawer,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useBoaterAccounts.js
git commit -m "feat(frontend): add useBoaterAccounts hook"
```

---

## Task 9: Frontend — Boater Accounts list tab

**Files:**
- Modify: `frontend/src/screens/Billing.jsx`

- [ ] **Step 1: Import the hook and add the tab to the tab row**

Open `frontend/src/screens/Billing.jsx`.

At the top of the file, add the import after the existing hook imports:

```javascript
import useBoaterAccounts from '../hooks/useBoaterAccounts.js';
```

Inside the `Billing()` component, after the `useFuelEntries` line, add:

```javascript
const {
  accounts, loading: acctLoading, fetchAccounts,
  selectedId, drawerData, drawerLoading,
  openDrawer, refreshDrawer, closeDrawer,
} = useBoaterAccounts();
```

Add state for the search input and show-all toggle just after:

```javascript
const [acctSearch, setAcctSearch]   = useState('');
const [acctShowAll, setAcctShowAll] = useState(false);
```

Add a `useEffect` to load accounts when the tab becomes active. Find the existing `useEffect` for Z-report and add alongside it:

```javascript
useEffect(() => {
  if (tab === 'boater-accounts') fetchAccounts({ search: acctSearch, showAll: acctShowAll });
}, [tab, acctSearch, acctShowAll, fetchAccounts]);
```

In the tab row definition, add `['boater-accounts', 'Boater Accounts']` to the array:

```javascript
{[
  ['invoices','Invoices'],
  ['utilities','Utility Meters'],
  ['pos','Fuel Dock POS'],
  ['debtors','Aged Debtors'],
  ['accounts','Accounts'],
  ['boater-accounts','Boater Accounts'],   // ← add this
].map(([v,l]) => (
  <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
))}
```

- [ ] **Step 2: Add the list view JSX**

After the closing `}` of the `tab === 'accounts'` block (around line 474), add:

```javascript
{tab === 'boater-accounts' && !selectedId && (
  <div>
    <div className="sec-hdr">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          placeholder="Search member name…"
          value={acctSearch}
          onChange={e => setAcctSearch(e.target.value)}
          style={{ border: 'var(--border)', borderRadius: 5, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--font)', width: 220 }}
        />
        <label style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={acctShowAll} onChange={e => setAcctShowAll(e.target.checked)} />
          Show settled
        </label>
      </div>
    </div>
    <div className="card" style={{ overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Berth</th>
            <th>Outstanding</th><th>Credit</th>
            <th>Open Inv.</th><th>Oldest Due</th><th>Portal</th><th></th>
          </tr>
        </thead>
        <tbody>
          {acctLoading ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
          ) : accounts.length === 0 ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No outstanding balances.</td></tr>
          ) : accounts.map(a => {
            const isOverdue = a.oldest_due_date && new Date(a.oldest_due_date) < new Date();
            return (
              <tr key={a.member_id}>
                <td className="tbl-name">{a.name}</td>
                <td><span className="badge badge-navy">{a.member_type}</span></td>
                <td style={{ fontSize: 12 }}>{a.berth_code ?? '—'}</td>
                <td style={{ fontWeight: 700, color: isOverdue ? 'var(--red)' : 'inherit' }}>
                  €{Number(a.total_outstanding).toFixed(2)}
                </td>
                <td style={{ fontSize: 12, color: Number(a.credit_on_account) > 0 ? 'var(--green)' : 'rgba(0,0,0,0.35)' }}>
                  {Number(a.credit_on_account) > 0 ? `€${Number(a.credit_on_account).toFixed(2)}` : '—'}
                </td>
                <td style={{ fontSize: 12 }}>{a.open_invoice_count}</td>
                <td style={{ fontSize: 12, color: isOverdue ? 'var(--red)' : 'rgba(0,0,0,0.45)' }}>
                  {a.oldest_due_date ?? '—'}
                </td>
                <td>
                  {a.portal_active
                    ? <span className="badge badge-green">Active</span>
                    : <span className="badge badge-gray">No portal</span>}
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => openDrawer(a.member_id)}>
                    View Account →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify the tab renders without errors**

Start the dev server and navigate to the Billing screen. Click "Boater Accounts". The table should render (empty if no outstanding balances). No console errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Billing.jsx frontend/src/hooks/useBoaterAccounts.js
git commit -m "feat(frontend): add Boater Accounts list tab"
```

---

## Task 10: Frontend — detail drawer

**Files:**
- Modify: `frontend/src/screens/Billing.jsx`

- [ ] **Step 1: Add drawer state variables for payment form**

Inside `Billing()`, after the `acctShowAll` state, add:

```javascript
const [payAmount, setPayAmount]   = useState('');
const [payMethod, setPayMethod]   = useState('bank_transfer');
const [payNotes, setPayNotes]     = useState('');
const [payLoading, setPayLoading] = useState(false);
```

- [ ] **Step 2: Add the `recordPayment` handler function**

Inside `Billing()`, before the `return` statement, add:

```javascript
async function recordPayment() {
  if (!selectedId || !payAmount) return;
  setPayLoading(true);
  try {
    await api.post(`/billing/accounts/${selectedId}/payments/`, {
      amount: payAmount, method: payMethod, notes: payNotes,
    });
    setPayAmount(''); setPayNotes('');
    await refreshDrawer(selectedId);
  } catch (e) {
    alert(e?.response?.data?.detail ?? 'Payment failed.');
  } finally {
    setPayLoading(false);
  }
}

async function sendInvite(memberId, email) {
  try {
    await api.post(`/billing/accounts/${memberId}/generate-invite/`);
    alert(`Invite sent to ${email}`);
    await refreshDrawer(memberId);
  } catch (e) {
    alert(e?.response?.data?.detail ?? 'Failed to send invite.');
  }
}
```

- [ ] **Step 3: Add the drawer JSX**

After the list view block (`!selectedId`), add the drawer view (shown when `selectedId` is set):

```javascript
{tab === 'boater-accounts' && selectedId && (
  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
    {/* List stays visible behind drawer */}
    <div style={{ flex: 1, opacity: 0.4, pointerEvents: 'none', overflow: 'hidden', maxHeight: 400 }}>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Outstanding</th><th>Portal</th></tr></thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.member_id}>
                <td className="tbl-name">{a.name}</td>
                <td>€{Number(a.total_outstanding).toFixed(2)}</td>
                <td>{a.portal_active ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* Drawer */}
    <div className="card" style={{ width: 480, flexShrink: 0, padding: 24 }}>
      {drawerLoading && !drawerData ? (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '20px 0', textAlign: 'center' }}>Loading…</div>
      ) : drawerData ? (
        <>
          {/* Header */}
          <div style={{ marginBottom: 18 }}>
            <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={closeDrawer}>
              ← Back
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{drawerData.member.name}</div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                  <span className="badge badge-navy" style={{ marginRight: 6 }}>{drawerData.member.member_type}</span>
                  {drawerData.member.berth_code ?? 'No berth'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>
                  €{Number(drawerData.summary.total_outstanding).toFixed(2)}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>outstanding</div>
                {Number(drawerData.summary.credit_on_account) > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, marginTop: 4 }}>
                    Credit: €{Number(drawerData.summary.credit_on_account).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
              onClick={() => sendInvite(drawerData.member.id, drawerData.member.email)}
            >
              {drawerData.member.portal_active ? 'Re-send Portal Invite' : 'Generate Portal Invite'}
            </button>
          </div>

          {/* Record Payment form */}
          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Record Payment</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input
                type="number" step="0.01" min="0.01"
                placeholder="Amount"
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                style={{ flex: 1, border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}
              />
              <select
                value={payMethod}
                onChange={e => setPayMethod(e.target.value)}
                style={{ border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12 }}
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="external_card">Card</option>
              </select>
            </div>
            <input
              placeholder="Notes (optional)"
              value={payNotes}
              onChange={e => setPayNotes(e.target.value)}
              style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '6px 8px', fontSize: 12, marginBottom: 8 }}
            />
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={!payAmount || payLoading}
              onClick={recordPayment}
            >
              {payLoading ? 'Recording…' : 'Record Payment'}
            </button>
          </div>

          {/* Invoice groups */}
          {(['berth', 'fuel', 'restaurant', 'other']).map(cat => {
            const catLabels = { berth: 'Berth Fees', fuel: 'Fuel Dock', restaurant: 'Restaurant', other: 'Other' };
            const catSources = { berth: ['berth','booking'], fuel: ['fuel_dock'], restaurant: ['restaurant_order'], other: [] };
            const invoices = drawerData.open_invoices.filter(inv =>
              cat === 'other'
                ? !['berth','booking','fuel_dock','restaurant_order'].includes(inv.source_type)
                : catSources[cat].includes(inv.source_type)
            );
            if (invoices.length === 0) return null;
            const catTotal = invoices.reduce((s, inv) => s + Number(inv.total) - Number(inv.amount_paid_so_far), 0);
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                  <span>{catLabels[cat]}</span>
                  <span>€{catTotal.toFixed(2)}</span>
                </div>
                {invoices.map(inv => {
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date();
                  const partiallyPaid = Number(inv.amount_paid_so_far) > 0;
                  return (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{inv.invoice_number}</div>
                        <div style={{ fontSize: 11, color: isOverdue ? 'var(--red)' : 'rgba(0,0,0,0.4)' }}>
                          {inv.due_date ? `Due ${inv.due_date}` : 'No due date'}
                          {isOverdue && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: 9 }}>OVERDUE</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700 }}>
                          €{(Number(inv.total) - Number(inv.amount_paid_so_far)).toFixed(2)}
                        </div>
                        {partiallyPaid && (
                          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>
                            €{Number(inv.amount_paid_so_far).toFixed(2)} of €{Number(inv.total).toFixed(2)} paid
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {drawerData.open_invoices.length === 0 && (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '20px 0' }}>
              No outstanding charges.
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Could not load account data.</div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify the drawer in the browser**

Start the dev server. Navigate to Billing → Boater Accounts. Click "View Account →" on any member row. The drawer should slide in, show the summary, display the payment form, and list grouped invoices. Click "Record Payment" with a valid amount — the drawer should re-render with updated totals.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/Billing.jsx
git commit -m "feat(frontend): add Boater Accounts detail drawer with payment form"
```

---

## Task 11: Final integration check and clean-up commit

- [ ] **Step 1: Run the full test suite**

```bash
cd backend
python manage.py test --verbosity=1
```

Expected: All tests pass with 0 failures, 0 errors.

- [ ] **Step 2: Check for any migration drift**

```bash
python manage.py migrate --check
```

Expected: `No migrations to apply.`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: boater unified ledger complete — allocation engine, portal invite, mobile API, manager UI"
```

---

## Self-review checklist

- `GET /billing/accounts/` → `AccountListView` in Task 3 ✓
- `GET /billing/accounts/{member_id}/` → `AccountDetailView` in Task 3 ✓
- `POST /billing/accounts/{member_id}/payments/` → `RecordPaymentView` in Task 3 ✓
- `POST /billing/accounts/{member_id}/generate-invite/` → `GenerateInviteView` in Task 3 ✓
- `GET /api/mobile/my-account/` → `MyAccountView` in Task 6 ✓
- `POST /api/mobile/activate/` → `ActivatePortalView` in Task 6 ✓
- `AccountPayment` + `PaymentAllocation` models → Task 1 ✓
- Allocation engine oldest-first → Task 2 ✓
- Overpayment stored as credit → Task 2 ✓
- Portal invite via Django token + Resend email → Task 3 ✓
- JWT returned on activation (simplejwt) → Task 6 ✓
- `PORTAL_BASE_URL` setting → Task 7 ✓
- Manager list tab with search + show-all → Task 9 ✓
- Manager drawer with payment form + invoice groups → Task 10 ✓
- `portal_active` flag in list and detail → Task 3 ✓
- `amount_paid_so_far` on partial invoices → Task 3 ✓
- Spec note: activation returns `access`/`refresh` (JWT), not `token` (DRF plain token) — project uses `rest_framework_simplejwt`, not `rest_framework.authtoken` ✓
