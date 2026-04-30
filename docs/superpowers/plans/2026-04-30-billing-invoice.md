# Billing & Invoice Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the billing stub with a centralized hub — proper Invoice + InvoiceLineItem models, a service layer, centralized Stripe Connect, Django signal architecture, restaurant POS manual payment flow, and WeasyPrint PDF receipts.

**Architecture:** Spokes (reservations, restaurant) call `billing/service.py` directly. Billing fires an `invoice_paid` Django signal back to spokes. All Stripe logic is isolated in `billing/stripe_service.py`. The existing `StripeWebhookView` and `stripe_session_id` in `reservations/` are fully removed.

**Tech Stack:** Django 6, DRF, SimpleJWT, stripe (already installed), WeasyPrint (add to requirements), django-storages/Supabase S3 (already configured), Python `threading` (no Celery)

---

## File Map

| File | Action |
|---|---|
| `backend/apps/accounts/models.py` | Add `vat_rate`, `stripe_account_id` to Marina |
| `backend/apps/accounts/migrations/0004_marina_billing_fields.py` | Auto-generated |
| `backend/apps/billing/models.py` | Replace — new Invoice, InvoiceLineItem, Payment |
| `backend/apps/billing/migrations/0002_rebuild_billing.py` | Manual migration (delete old, create new) |
| `backend/apps/billing/service.py` | Create — all service functions |
| `backend/apps/billing/signals.py` | Create — `invoice_paid` signal |
| `backend/apps/billing/stripe_service.py` | Create — Stripe Checkout session creation |
| `backend/apps/billing/pdf_service.py` | Create — WeasyPrint PDF + Supabase upload + email |
| `backend/apps/billing/templates/billing/invoice_pdf.html` | Create — dual-mode invoice/receipt template |
| `backend/apps/billing/serializers.py` | Replace — Invoice, InvoiceLineItem, Payment serializers |
| `backend/apps/billing/views.py` | Replace — all views including StripeWebhookView |
| `backend/apps/billing/urls.py` | Replace — all URL patterns |
| `backend/apps/billing/tests.py` | Create — full test suite |
| `backend/config/urls.py` | Modify — add `billing/` prefix to billing include |
| `backend/apps/reservations/receivers.py` | Create — `on_invoice_paid` signal receiver |
| `backend/apps/reservations/apps.py` | Modify — connect receiver in `ready()` |
| `backend/apps/reservations/views.py` | Replace — remove all Stripe code, call billing service |
| `backend/apps/reservations/urls.py` | Modify — remove StripeWebhookView import and URL |
| `backend/apps/reservations/models.py` | Modify — remove `stripe_session_id` |
| `backend/apps/reservations/migrations/0005_remove_stripe_session_id.py` | Auto-generated |
| `backend/requirements.txt` | Add `weasyprint` |

---

### Task 1: Marina billing fields

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: `backend/apps/accounts/migrations/0004_marina_billing_fields.py` (auto-generated)
- Create: `backend/apps/billing/tests.py`

- [ ] **Step 1: Write failing tests**

Create `backend/apps/billing/tests.py`:

```python
import datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.members.models import Member


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_marina(vat_rate='8.10', stripe_account_id='acct_test123'):
    return Marina.objects.create(
        name='Test Marina',
        vat_rate=Decimal(vat_rate),
        stripe_account_id=stripe_account_id,
    )


def make_user(marina):
    return User.objects.create_user(
        email='staff@test.com', password='pass', marina=marina, role='manager'
    )


def make_member(marina, email='hans@boat.ch'):
    return Member.objects.create(marina=marina, name='Hans Müller', email=email)


# ── Tests ──────────────────────────────────────────────────────────────────────

class MarinaFieldsTest(TestCase):
    def test_vat_rate_and_stripe_account_id_exist(self):
        marina = Marina.objects.create(
            name='Marina A', vat_rate=Decimal('7.70'), stripe_account_id='acct_abc'
        )
        marina.refresh_from_db()
        self.assertEqual(marina.vat_rate, Decimal('7.70'))
        self.assertEqual(marina.stripe_account_id, 'acct_abc')

    def test_vat_rate_defaults_to_zero(self):
        marina = Marina.objects.create(name='Marina B')
        self.assertEqual(marina.vat_rate, Decimal('0.00'))

    def test_stripe_account_id_defaults_blank(self):
        marina = Marina.objects.create(name='Marina C')
        self.assertEqual(marina.stripe_account_id, '')
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd backend
python manage.py test apps.billing.tests.MarinaFieldsTest --settings=config.settings.dev -v 2
```

Expected: `FAIL` — `Marina` has no `vat_rate` field yet.

- [ ] **Step 3: Add fields to Marina**

Open `backend/apps/accounts/models.py`. Add `from decimal import Decimal` at the top if not present. After the `booking_mode` field, add:

```python
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    stripe_account_id = models.CharField(max_length=255, blank=True)
```

- [ ] **Step 4: Generate and apply migration**

```bash
python manage.py makemigrations accounts --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
```

Expected: `0004_marina_billing_fields.py` created and applied with no errors.

- [ ] **Step 5: Run tests, verify they pass**

```bash
python manage.py test apps.billing.tests.MarinaFieldsTest --settings=config.settings.dev -v 2
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/0004_marina_billing_fields.py backend/apps/billing/tests.py
git commit -m "feat(billing): add vat_rate and stripe_account_id to Marina"
```

---

### Task 2: Rebuild billing models

**Files:**
- Replace: `backend/apps/billing/models.py`
- Create: `backend/apps/billing/migrations/0002_rebuild_billing.py`
- Modify: `backend/apps/billing/tests.py`

The existing `Invoice` (with `invoice_type`, `booking` FK, flat `amount`) and `Payment` models are deleted and replaced. Write the migration by hand — auto-generation will produce unsafe ALTER operations on the old tables.

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/billing/tests.py`:

```python
from apps.billing.models import Invoice, InvoiceLineItem, Payment


class BillingModelTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_invoice_required_fields(self):
        invoice = Invoice.objects.create(
            marina=self.marina,
            invoice_number='INV-2026-0001',
            status='draft',
            source_type='berth_booking',
            source_id='42',
            vat_rate=Decimal('8.10'),
        )
        invoice.refresh_from_db()
        self.assertEqual(invoice.invoice_number, 'INV-2026-0001')
        self.assertEqual(invoice.status, 'draft')
        self.assertEqual(invoice.source_id, '42')
        self.assertIsNone(invoice.member)
        self.assertEqual(invoice.subtotal, Decimal('0.00'))
        self.assertEqual(invoice.tax_total, Decimal('0.00'))
        self.assertEqual(invoice.total, Decimal('0.00'))
        self.assertIsNone(invoice.paid_at)
        self.assertEqual(invoice.stripe_checkout_session_id, '')
        self.assertEqual(invoice.stripe_payment_intent_id, '')

    def test_invoice_line_item_fields(self):
        invoice = Invoice.objects.create(
            marina=self.marina, invoice_number='INV-2026-0002',
            status='draft', vat_rate=Decimal('8.10'),
        )
        item = InvoiceLineItem.objects.create(
            invoice=invoice,
            description='Berth A1 — 3 nights @ 50/night',
            quantity=Decimal('1.00'),
            unit_price=Decimal('150.00'),
            total_price=Decimal('150.00'),
        )
        self.assertEqual(item.invoice, invoice)
        self.assertEqual(item.total_price, Decimal('150.00'))

    def test_payment_fields(self):
        invoice = Invoice.objects.create(
            marina=self.marina, invoice_number='INV-2026-0003',
            status='open', vat_rate=Decimal('0.00'),
        )
        payment = Payment.objects.create(
            invoice=invoice, method='cash', amount=Decimal('50.00'),
        )
        self.assertEqual(payment.method, 'cash')
        self.assertIsNotNone(payment.paid_at)
        self.assertIsNone(payment.recorded_by)
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
python manage.py test apps.billing.tests.BillingModelTest --settings=config.settings.dev -v 2
```

Expected: `FAIL` — old `Invoice` model has no `source_type`, `vat_rate`, etc.

- [ ] **Step 3: Replace billing/models.py**

Replace the entire contents of `backend/apps/billing/models.py`:

```python
from decimal import Decimal
from django.db import models


class Invoice(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('open', 'Open'),
        ('paid', 'Paid'),
        ('void', 'Void'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='invoices')
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    invoice_number = models.CharField(max_length=20, unique=True, db_index=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    source_type = models.CharField(max_length=50, blank=True)
    source_id = models.CharField(max_length=255, blank=True, db_index=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    tax_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    stripe_checkout_session_id = models.CharField(max_length=200, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True)
    due_date = models.DateField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    pdf_document = models.FileField(upload_to='invoices/', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.invoice_number} ({self.status})'


class InvoiceLineItem(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('1.00'))
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f'{self.description} × {self.quantity}'


class Payment(models.Model):
    METHOD_CHOICES = [
        ('cash', 'Cash'),
        ('external_card', 'External Card'),
    ]

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    method = models.CharField(max_length=20, choices=METHOD_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    recorded_by = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True
    )
    paid_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Payment {self.pk} — {self.invoice}'
```

- [ ] **Step 4: Write the migration manually**

Create `backend/apps/billing/migrations/0002_rebuild_billing.py`:

```python
from decimal import Decimal
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0001_initial'),
        ('accounts', '0004_marina_billing_fields'),
        ('members', '0001_initial'),
        ('staff', '0001_initial'),
    ]

    operations = [
        # Delete old models (Payment first — it has FK to Invoice)
        migrations.DeleteModel(name='Payment'),
        migrations.DeleteModel(name='Invoice'),

        # Create new Invoice
        migrations.CreateModel(
            name='Invoice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('invoice_number', models.CharField(db_index=True, max_length=20, unique=True)),
                ('status', models.CharField(
                    choices=[('draft','Draft'),('open','Open'),('paid','Paid'),('void','Void')],
                    default='draft', max_length=10,
                )),
                ('source_type', models.CharField(blank=True, max_length=50)),
                ('source_id', models.CharField(blank=True, db_index=True, max_length=255)),
                ('subtotal', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('vat_rate', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=5)),
                ('tax_total', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('total', models.DecimalField(decimal_places=2, default=Decimal('0.00'), max_digits=10)),
                ('stripe_checkout_session_id', models.CharField(blank=True, max_length=200)),
                ('stripe_payment_intent_id', models.CharField(blank=True, max_length=200)),
                ('due_date', models.DateField(blank=True, null=True)),
                ('paid_at', models.DateTimeField(blank=True, null=True)),
                ('pdf_document', models.FileField(blank=True, null=True, upload_to='invoices/')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='invoices', to='accounts.marina',
                )),
                ('member', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='invoices', to='members.member',
                )),
            ],
            options={'ordering': ['-created_at']},
        ),

        # Create InvoiceLineItem
        migrations.CreateModel(
            name='InvoiceLineItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('description', models.CharField(max_length=255)),
                ('quantity', models.DecimalField(decimal_places=2, default=Decimal('1.00'), max_digits=8)),
                ('unit_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('total_price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('invoice', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='items', to='billing.invoice',
                )),
            ],
        ),

        # Create new Payment
        migrations.CreateModel(
            name='Payment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('method', models.CharField(
                    choices=[('cash','Cash'),('external_card','External Card')],
                    max_length=20,
                )),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('paid_at', models.DateTimeField(auto_now_add=True)),
                ('invoice', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='payments', to='billing.invoice',
                )),
                ('recorded_by', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='staff.staffmember',
                )),
            ],
        ),
    ]
```

- [ ] **Step 5: Apply migration**

```bash
python manage.py migrate --settings=config.settings.dev
```

Expected: applied with no errors. If you see `django.db.utils.IntegrityError`, there is leftover test data — run `python manage.py flush --settings=config.settings.dev` (dev only) then retry.

- [ ] **Step 6: Run tests, verify they pass**

```bash
python manage.py test apps.billing.tests.BillingModelTest --settings=config.settings.dev -v 2
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/billing/models.py backend/apps/billing/migrations/0002_rebuild_billing.py backend/apps/billing/tests.py
git commit -m "feat(billing): rebuild Invoice, InvoiceLineItem, Payment models"
```

---

### Task 3: Service layer

**Files:**
- Create: `backend/apps/billing/service.py`
- Create: `backend/apps/billing/signals.py`
- Modify: `backend/apps/billing/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/billing/tests.py`:

```python
from apps.billing import service as billing_service


class InvoiceNumberTest(TestCase):
    def test_first_invoice_gets_formatted_number(self):
        marina = make_marina()
        inv = billing_service.create_invoice(marina, source_type='berth_booking', source_id='1')
        import re
        self.assertRegex(inv.invoice_number, r'^INV-\d{4}-\d{4}$')

    def test_second_invoice_increments(self):
        marina = make_marina()
        inv1 = billing_service.create_invoice(marina, source_type='berth_booking', source_id='1')
        inv2 = billing_service.create_invoice(marina, source_type='berth_booking', source_id='2')
        seq1 = int(inv1.invoice_number.split('-')[2])
        seq2 = int(inv2.invoice_number.split('-')[2])
        self.assertEqual(seq2, seq1 + 1)


class ServiceLayerTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    def test_create_invoice_snapshots_vat_rate_and_member(self):
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='10',
        )
        self.assertEqual(inv.vat_rate, self.marina.vat_rate)
        self.assertEqual(inv.status, 'draft')
        self.assertEqual(inv.member, self.member)
        self.assertEqual(inv.source_id, '10')

    def test_add_line_item_calculates_total_price(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='11')
        item = billing_service.add_line_item(inv, 'Berth A1 — 3 nights', Decimal('1.00'), Decimal('150.00'))
        self.assertEqual(item.total_price, Decimal('150.00'))
        self.assertEqual(item.description, 'Berth A1 — 3 nights')

    def test_add_line_item_rejects_non_draft_invoice(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='12')
        billing_service.add_line_item(inv, 'Item', Decimal('1'), Decimal('50'))
        billing_service.finalize_invoice(inv)
        with self.assertRaises(ValueError):
            billing_service.add_line_item(inv, 'Extra', Decimal('1'), Decimal('10'))

    def test_finalize_calculates_subtotal_tax_total(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='13')
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('100.00'))
        billing_service.add_line_item(inv, 'Electricity', Decimal('1'), Decimal('20.00'))
        billing_service.finalize_invoice(inv)
        inv.refresh_from_db()
        self.assertEqual(inv.subtotal, Decimal('120.00'))
        # vat_rate is 8.10 (from make_marina)
        expected_tax = (Decimal('120.00') * Decimal('8.10') / 100).quantize(Decimal('0.01'))
        self.assertEqual(inv.tax_total, expected_tax)
        self.assertEqual(inv.total, inv.subtotal + inv.tax_total)
        self.assertEqual(inv.status, 'open')

    def test_finalize_rejects_non_draft(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='14')
        billing_service.add_line_item(inv, 'Item', Decimal('1'), Decimal('50'))
        billing_service.finalize_invoice(inv)
        with self.assertRaises(ValueError):
            billing_service.finalize_invoice(inv)

    def test_mark_paid_manual_creates_payment_and_flips_status(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='99')
        billing_service.add_line_item(inv, 'Coffee', Decimal('2'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'paid')
        self.assertIsNotNone(inv.paid_at)
        self.assertEqual(inv.payments.count(), 1)
        self.assertEqual(inv.payments.first().method, 'cash')

    def test_mark_paid_manual_rejects_invalid_method(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='100')
        billing_service.add_line_item(inv, 'Beer', Decimal('1'), Decimal('5.00'))
        billing_service.finalize_invoice(inv)
        with self.assertRaises(ValueError):
            billing_service.mark_paid_manual(inv, 'bitcoin')

    def test_void_open_invoice(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='15')
        billing_service.add_line_item(inv, 'Item', Decimal('1'), Decimal('50'))
        billing_service.finalize_invoice(inv)
        billing_service.void_invoice(inv)
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'void')

    def test_void_paid_invoice_raises(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='101')
        billing_service.add_line_item(inv, 'Pasta', Decimal('1'), Decimal('18.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        with self.assertRaises(ValueError):
            billing_service.void_invoice(inv)

    def test_zero_vat_rate_graceful(self):
        marina = Marina.objects.create(name='Zero VAT Marina', vat_rate=Decimal('0.00'))
        inv = billing_service.create_invoice(marina, source_type='berth_booking', source_id='16')
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('100.00'))
        billing_service.finalize_invoice(inv)
        inv.refresh_from_db()
        self.assertEqual(inv.tax_total, Decimal('0.00'))
        self.assertEqual(inv.total, Decimal('100.00'))
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
python manage.py test apps.billing.tests.InvoiceNumberTest apps.billing.tests.ServiceLayerTest --settings=config.settings.dev -v 2
```

Expected: `ImportError` — `billing.service` does not exist yet.

- [ ] **Step 3: Create billing/signals.py**

Create `backend/apps/billing/signals.py`:

```python
import django.dispatch

invoice_paid = django.dispatch.Signal()
# Sends kwargs: invoice (Invoice instance)
```

- [ ] **Step 4: Create billing/service.py**

Create `backend/apps/billing/service.py`:

```python
import datetime
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from .models import Invoice, InvoiceLineItem, Payment
from .signals import invoice_paid


def _next_invoice_number():
    year = datetime.date.today().year
    with transaction.atomic():
        last = (
            Invoice.objects.select_for_update()
            .filter(invoice_number__startswith=f'INV-{year}-')
            .order_by('-invoice_number')
            .first()
        )
        seq = (int(last.invoice_number.split('-')[2]) + 1) if last else 1
        return f'INV-{year}-{seq:04d}'


def create_invoice(marina, member=None, source_type='', source_id='', due_date=None):
    return Invoice.objects.create(
        marina=marina,
        member=member,
        invoice_number=_next_invoice_number(),
        status='draft',
        source_type=source_type,
        source_id=str(source_id) if source_id else '',
        vat_rate=marina.vat_rate,
        due_date=due_date,
    )


def add_line_item(invoice, description, quantity, unit_price):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot add line items to a {invoice.status} invoice.')
    q = Decimal(str(quantity))
    p = Decimal(str(unit_price))
    total_price = (q * p).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return InvoiceLineItem.objects.create(
        invoice=invoice,
        description=description,
        quantity=q,
        unit_price=p,
        total_price=total_price,
    )


def finalize_invoice(invoice):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot finalize a {invoice.status} invoice.')
    subtotal = sum(item.total_price for item in invoice.items.all())
    tax_total = (subtotal * invoice.vat_rate / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.subtotal = subtotal
    invoice.tax_total = tax_total
    invoice.total = subtotal + tax_total
    invoice.status = 'open'
    invoice.save(update_fields=['subtotal', 'tax_total', 'total', 'status'])
    return invoice


def mark_paid_manual(invoice, method, recorded_by=None):
    if invoice.status != 'open':
        raise ValueError(f'Cannot mark a {invoice.status} invoice as paid.')
    if method not in ('cash', 'external_card'):
        raise ValueError(f"Invalid payment method '{method}'. Use 'cash' or 'external_card'.")
    Payment.objects.create(invoice=invoice, method=method, amount=invoice.total, recorded_by=recorded_by)
    invoice.status = 'paid'
    invoice.paid_at = timezone.now()
    invoice.save(update_fields=['status', 'paid_at'])
    invoice_paid.send(sender=Invoice, invoice=invoice)
    return invoice


def void_invoice(invoice):
    if invoice.status not in ('draft', 'open'):
        raise ValueError(f'Cannot void a {invoice.status} invoice.')
    invoice.status = 'void'
    invoice.save(update_fields=['status'])
    return invoice


def create_stripe_checkout_session(invoice):
    if invoice.status != 'open':
        raise ValueError(f'Cannot create Stripe session for a {invoice.status} invoice.')
    from .stripe_service import _create_checkout_session
    return _create_checkout_session(invoice)
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
python manage.py test apps.billing.tests.InvoiceNumberTest apps.billing.tests.ServiceLayerTest --settings=config.settings.dev -v 2
```

Expected: all 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/billing/service.py backend/apps/billing/signals.py backend/apps/billing/tests.py
git commit -m "feat(billing): add service layer with sequential invoice numbering and invoice_paid signal"
```

---

### Task 4: Signal receiver in reservations

**Files:**
- Create: `backend/apps/reservations/receivers.py`
- Modify: `backend/apps/reservations/apps.py`
- Modify: `backend/apps/billing/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/billing/tests.py`:

```python
from apps.berths.models import Pier, Berth
from apps.reservations.models import Booking


def make_berth(marina, price=Decimal('50.00')):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    return Berth.objects.create(
        marina=marina, pier=pier, code='A1',
        price_per_night=price, status='available',
    )


class SignalReceiverTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.berth = make_berth(self.marina)

    def test_berth_booking_invoice_paid_confirms_booking(self):
        booking = Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            check_in=datetime.date(2026, 6, 1),
            check_out=datetime.date(2026, 6, 4),
            status='awaiting_payment',
        )
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id=str(booking.id),
        )
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('150.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'confirmed')

    def test_restaurant_invoice_paid_does_not_touch_bookings(self):
        booking = Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            check_in=datetime.date(2026, 6, 1),
            check_out=datetime.date(2026, 6, 4),
            status='awaiting_payment',
        )
        inv = billing_service.create_invoice(
            self.marina, source_type='restaurant_order', source_id='999',
        )
        billing_service.add_line_item(inv, 'Coffee', Decimal('1'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'awaiting_payment')
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
python manage.py test apps.billing.tests.SignalReceiverTest --settings=config.settings.dev -v 2
```

Expected: `FAIL` — signal fires but no receiver wired up yet; booking status stays unchanged.

- [ ] **Step 3: Create reservations/receivers.py**

Create `backend/apps/reservations/receivers.py`:

```python
from .models import Booking


def on_invoice_paid(sender, invoice, **kwargs):
    if invoice.source_type == 'berth_booking' and invoice.source_id:
        Booking.objects.filter(pk=invoice.source_id).update(status='confirmed')
```

- [ ] **Step 4: Wire receiver in reservations/apps.py**

Replace `backend/apps/reservations/apps.py`:

```python
from django.apps import AppConfig


class ReservationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.reservations'

    def ready(self):
        from apps.billing.signals import invoice_paid
        from .receivers import on_invoice_paid
        invoice_paid.connect(on_invoice_paid)
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
python manage.py test apps.billing.tests.SignalReceiverTest --settings=config.settings.dev -v 2
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/receivers.py backend/apps/reservations/apps.py backend/apps/billing/tests.py
git commit -m "feat(billing): wire invoice_paid signal receiver in reservations"
```

---

### Task 5: Stripe service, webhook, and full billing API

**Files:**
- Create: `backend/apps/billing/stripe_service.py`
- Create: `backend/apps/billing/pdf_service.py` (placeholder — real impl in Task 6)
- Replace: `backend/apps/billing/serializers.py`
- Replace: `backend/apps/billing/views.py`
- Replace: `backend/apps/billing/urls.py`
- Modify: `backend/config/urls.py`
- Modify: `backend/apps/billing/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/billing/tests.py`:

```python
import json


class StripeCheckoutSessionTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    @patch('apps.billing.stripe_service.stripe')
    def test_create_checkout_session_stores_session_id_and_returns_url(self, mock_stripe):
        mock_session = MagicMock()
        mock_session.id = 'cs_test_abc123'
        mock_session.url = 'https://checkout.stripe.com/pay/cs_test_abc123'
        mock_stripe.checkout.Session.create.return_value = mock_session

        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='20',
            due_date=datetime.date(2026, 7, 1),
        )
        billing_service.add_line_item(inv, 'Berth A1 — 3 nights', Decimal('1'), Decimal('150.00'))
        billing_service.finalize_invoice(inv)
        url = billing_service.create_stripe_checkout_session(inv)

        inv.refresh_from_db()
        self.assertEqual(inv.stripe_checkout_session_id, 'cs_test_abc123')
        self.assertEqual(url, 'https://checkout.stripe.com/pay/cs_test_abc123')

    def test_create_checkout_session_rejects_draft_invoice(self):
        inv = billing_service.create_invoice(
            self.marina, source_type='berth_booking', source_id='21',
        )
        with self.assertRaises(ValueError):
            billing_service.create_stripe_checkout_session(inv)


class StripeWebhookViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.client = APIClient()
        self.berth = make_berth(self.marina)

    def _open_invoice(self, source_type='berth_booking', source_id='30', session_id='cs_test_xyz'):
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type=source_type, source_id=source_id,
        )
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('200.00'))
        billing_service.finalize_invoice(inv)
        inv.stripe_checkout_session_id = session_id
        inv.save(update_fields=['stripe_checkout_session_id'])
        return inv

    @patch('apps.billing.stripe_service.stripe')
    @patch('apps.billing.views.threading')
    def test_completed_marks_invoice_paid_and_starts_pdf_thread(self, mock_threading, mock_stripe):
        mock_threading.Thread.return_value = MagicMock()
        inv = self._open_invoice()
        mock_stripe.Webhook.construct_event.return_value = {
            'type': 'checkout.session.completed',
            'data': {'object': {
                'id': 'cs_test_xyz',
                'payment_intent': 'pi_test_123',
                'metadata': {'invoice_id': str(inv.id)},
            }}
        }
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'{}', content_type='application/json',
            HTTP_STRIPE_SIGNATURE='t=1,v1=fakesig',
        )
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'paid')
        self.assertEqual(inv.stripe_payment_intent_id, 'pi_test_123')
        self.assertIsNotNone(inv.paid_at)
        mock_threading.Thread.assert_called_once()

    @patch('apps.billing.stripe_service.stripe')
    def test_expired_clears_checkout_session_id(self, mock_stripe):
        inv = self._open_invoice()
        mock_stripe.Webhook.construct_event.return_value = {
            'type': 'checkout.session.expired',
            'data': {'object': {
                'id': 'cs_test_xyz',
                'metadata': {'invoice_id': str(inv.id)},
            }}
        }
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'{}', content_type='application/json',
            HTTP_STRIPE_SIGNATURE='t=1,v1=fakesig',
        )
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.stripe_checkout_session_id, '')
        self.assertEqual(inv.status, 'open')

    @patch('apps.billing.stripe_service.stripe')
    def test_invalid_signature_returns_400(self, mock_stripe):
        mock_stripe.Webhook.construct_event.side_effect = Exception('Invalid signature')
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'{}', content_type='application/json',
            HTTP_STRIPE_SIGNATURE='bad',
        )
        self.assertEqual(resp.status_code, 400)


class BillingAPITest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_invoice_list_returns_marina_invoices_only(self):
        billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='40')
        other_marina = Marina.objects.create(name='Other Marina')
        billing_service.create_invoice(other_marina, source_type='berth_booking', source_id='41')
        resp = self.client.get('/api/v1/billing/invoices/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_mark_paid_cash_sets_paid_status(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='50')
        billing_service.add_line_item(inv, 'Burger', Decimal('1'), Decimal('16.00'))
        billing_service.finalize_invoice(inv)
        resp = self.client.patch(
            f'/api/v1/billing/invoices/{inv.id}/mark-paid/',
            {'method': 'cash'}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'paid')

    def test_mark_paid_invalid_method_returns_400(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='51')
        billing_service.add_line_item(inv, 'Coffee', Decimal('1'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        resp = self.client.patch(
            f'/api/v1/billing/invoices/{inv.id}/mark-paid/',
            {'method': 'bitcoin'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_from_order_creates_invoice_with_line_items(self):
        from apps.restaurant.models import RestTable, MenuItem, Order, OrderItem
        table = RestTable.objects.create(marina=self.marina, number=1, capacity=4)
        menu_item = MenuItem.objects.create(
            marina=self.marina, section='mains', name='Cheeseburger',
            price=Decimal('16.00'), prep_time=15,
        )
        order = Order.objects.create(marina=self.marina, table=table, covers=2)
        OrderItem.objects.create(order=order, menu_item=menu_item, quantity=2)

        resp = self.client.post(
            '/api/v1/billing/invoices/from-order/',
            {'order_id': order.id}, format='json',
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['source_type'], 'restaurant_order')
        self.assertEqual(data['status'], 'open')
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(Decimal(data['subtotal']), Decimal('32.00'))
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
python manage.py test apps.billing.tests.StripeCheckoutSessionTest apps.billing.tests.StripeWebhookViewTest apps.billing.tests.BillingAPITest --settings=config.settings.dev -v 2
```

Expected: `ImportError` or `404` — stripe_service, views, and urls don't exist yet.

- [ ] **Step 3: Create billing/stripe_service.py**

Create `backend/apps/billing/stripe_service.py`:

```python
import stripe
from django.conf import settings

stripe.api_key = settings.STRIPE_SECRET_KEY


def _create_checkout_session(invoice):
    line_items = [
        {
            'price_data': {
                'currency': invoice.marina.currency.lower(),
                'product_data': {'name': item.description},
                'unit_amount': int(round(float(item.unit_price) * 100)),
            },
            'quantity': int(item.quantity),
        }
        for item in invoice.items.all()
    ]
    session = stripe.checkout.Session.create(
        payment_method_types=['card'],
        line_items=line_items,
        mode='payment',
        success_url=f'{settings.FRONTEND_URL}/bookings/{invoice.source_id}/confirmed',
        cancel_url=f'{settings.FRONTEND_URL}/bookings/{invoice.source_id}',
        metadata={'invoice_id': str(invoice.id)},
        stripe_account=invoice.marina.stripe_account_id or None,
    )
    invoice.stripe_checkout_session_id = session.id
    invoice.save(update_fields=['stripe_checkout_session_id'])
    return session.url
```

- [ ] **Step 4: Create billing/pdf_service.py placeholder**

Create `backend/apps/billing/pdf_service.py`:

```python
def _generate_store_and_email_pdf(invoice_id):
    pass  # Implemented in Task 6
```

- [ ] **Step 5: Replace billing/serializers.py**

Replace the entire contents of `backend/apps/billing/serializers.py`:

```python
from rest_framework import serializers
from .models import Invoice, InvoiceLineItem, Payment


class InvoiceLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLineItem
        fields = ['id', 'description', 'quantity', 'unit_price', 'total_price']


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'method', 'amount', 'paid_at']
        read_only_fields = ['id', 'paid_at']


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceLineItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'status', 'source_type', 'source_id',
            'member', 'member_name', 'subtotal', 'vat_rate', 'tax_total', 'total',
            'due_date', 'paid_at', 'stripe_checkout_session_id', 'created_at',
            'items', 'payments',
        ]
        read_only_fields = [
            'id', 'invoice_number', 'subtotal', 'tax_total', 'total',
            'paid_at', 'created_at',
        ]
```

- [ ] **Step 6: Replace billing/views.py**

Replace the entire contents of `backend/apps/billing/views.py`:

```python
import threading

import stripe
from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, status as http_status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service as billing_service
from .models import Invoice
from .pdf_service import _generate_store_and_email_pdf
from .serializers import InvoiceSerializer
from .signals import invoice_paid


@method_decorator(csrf_exempt, name='dispatch')
class StripeWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        payload = request.body
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')
        try:
            event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        except Exception:
            return HttpResponse(status=400)

        event_type = event['type']
        obj = event['data']['object']
        invoice_id = obj.get('metadata', {}).get('invoice_id')
        if not invoice_id:
            return HttpResponse(status=200)

        try:
            invoice = Invoice.objects.get(pk=invoice_id)
        except Invoice.DoesNotExist:
            return HttpResponse(status=200)

        if event_type == 'checkout.session.completed':
            invoice.stripe_payment_intent_id = obj.get('payment_intent', '')
            invoice.status = 'paid'
            invoice.paid_at = timezone.now()
            invoice.save(update_fields=['stripe_payment_intent_id', 'status', 'paid_at'])
            invoice_paid.send(sender=Invoice, invoice=invoice)
            threading.Thread(
                target=_generate_store_and_email_pdf,
                args=(invoice.id,),
                daemon=True,
            ).start()

        elif event_type == 'checkout.session.expired':
            invoice.stripe_checkout_session_id = ''
            invoice.save(update_fields=['stripe_checkout_session_id'])

        return HttpResponse(status=200)


class InvoiceListView(generics.ListAPIView):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Invoice.objects.filter(
            marina=self.request.user.marina
        ).select_related('member').prefetch_related('items', 'payments')


class InvoiceDetailView(generics.RetrieveAPIView):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Invoice.objects.filter(marina=self.request.user.marina)


class MarkPaidView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            billing_service.mark_paid_manual(invoice, request.data.get('method'))
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(InvoiceSerializer(invoice).data)


class FromOrderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        order_id = request.data.get('order_id')
        if not order_id:
            return Response({'detail': 'order_id required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            from apps.restaurant.models import Order
            order = Order.objects.prefetch_related('items__menu_item').get(
                pk=order_id, marina=request.user.marina
            )
        except Order.DoesNotExist:
            return Response({'detail': 'Order not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        invoice = billing_service.create_invoice(
            request.user.marina,
            source_type='restaurant_order',
            source_id=str(order.id),
        )
        for item in order.items.all():
            billing_service.add_line_item(
                invoice,
                description=item.menu_item.name,
                quantity=item.quantity,
                unit_price=item.menu_item.price,
            )
        billing_service.finalize_invoice(invoice)
        invoice.refresh_from_db()
        return Response(InvoiceSerializer(invoice).data, status=http_status.HTTP_201_CREATED)


class PDFDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if not invoice.pdf_document:
            return Response({'detail': 'PDF not yet generated.'}, status=http_status.HTTP_404_NOT_FOUND)
        return Response({'pdf_url': invoice.pdf_document.url})


class HTMLReceiptView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from django.shortcuts import render
        try:
            invoice = Invoice.objects.prefetch_related('items').select_related('marina', 'member').get(
                pk=pk, marina=request.user.marina
            )
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        return render(request, 'billing/invoice_pdf.html', {'invoice': invoice})
```

- [ ] **Step 7: Replace billing/urls.py**

Replace the entire contents of `backend/apps/billing/urls.py`:

```python
from django.urls import path
from .views import (
    StripeWebhookView,
    InvoiceListView,
    InvoiceDetailView,
    MarkPaidView,
    FromOrderView,
    PDFDownloadView,
    HTMLReceiptView,
)

urlpatterns = [
    path('stripe/webhook/', StripeWebhookView.as_view(), name='stripe_webhook'),
    path('invoices/', InvoiceListView.as_view(), name='invoice_list'),
    path('invoices/from-order/', FromOrderView.as_view(), name='invoice_from_order'),
    path('invoices/<int:pk>/', InvoiceDetailView.as_view(), name='invoice_detail'),
    path('invoices/<int:pk>/mark-paid/', MarkPaidView.as_view(), name='invoice_mark_paid'),
    path('invoices/<int:pk>/pdf/', PDFDownloadView.as_view(), name='invoice_pdf'),
    path('invoices/<int:pk>/receipt/', HTMLReceiptView.as_view(), name='invoice_receipt'),
]
```

- [ ] **Step 8: Update config/urls.py with billing/ prefix**

Open `backend/config/urls.py`. Change:

```python
        path('', include('apps.billing.urls')),
```

to:

```python
        path('billing/', include('apps.billing.urls')),
```

- [ ] **Step 9: Run tests, verify they pass**

```bash
python manage.py test apps.billing.tests.StripeCheckoutSessionTest apps.billing.tests.StripeWebhookViewTest apps.billing.tests.BillingAPITest --settings=config.settings.dev -v 2
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add backend/apps/billing/stripe_service.py backend/apps/billing/pdf_service.py backend/apps/billing/serializers.py backend/apps/billing/views.py backend/apps/billing/urls.py backend/config/urls.py backend/apps/billing/tests.py
git commit -m "feat(billing): add Stripe service, webhook, and full billing API"
```

---

### Task 6: PDF service and HTML template

**Files:**
- Replace: `backend/apps/billing/pdf_service.py`
- Create: `backend/apps/billing/templates/billing/invoice_pdf.html`
- Modify: `backend/requirements.txt`
- Modify: `backend/apps/billing/tests.py`

- [ ] **Step 1: Add WeasyPrint to requirements and install**

Open `backend/requirements.txt`. Add on its own line:

```
weasyprint
```

Install:

```bash
pip install weasyprint
```

- [ ] **Step 2: Write failing tests**

Append to `backend/apps/billing/tests.py`:

```python
class PDFServiceTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    @patch('apps.billing.pdf_service.HTML')
    @patch('apps.billing.pdf_service.default_storage')
    @patch('apps.billing.pdf_service.EmailMessage')
    def test_generate_stores_pdf_and_emails_member(self, mock_email_cls, mock_storage, mock_html):
        mock_html.return_value.write_pdf.return_value = b'%PDF-1.4 fake'
        mock_storage.save.return_value = 'invoices/1/INV-2026-0001.pdf'

        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='70',
        )
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('200.00'))
        billing_service.finalize_invoice(inv)
        inv.status = 'paid'
        inv.save(update_fields=['status'])

        from apps.billing.pdf_service import _generate_store_and_email_pdf
        _generate_store_and_email_pdf(inv.id)

        inv.refresh_from_db()
        self.assertTrue(bool(inv.pdf_document))
        mock_email_cls.assert_called_once()
        mock_email_cls.return_value.send.assert_called_once()

    @patch('apps.billing.pdf_service.HTML')
    @patch('apps.billing.pdf_service.default_storage')
    @patch('apps.billing.pdf_service.EmailMessage')
    def test_no_email_when_no_member(self, mock_email_cls, mock_storage, mock_html):
        mock_html.return_value.write_pdf.return_value = b'%PDF-1.4 fake'
        mock_storage.save.return_value = 'invoices/1/INV-2026-0002.pdf'

        inv = billing_service.create_invoice(
            self.marina, member=None,
            source_type='restaurant_order', source_id='71',
        )
        billing_service.add_line_item(inv, 'Coffee', Decimal('1'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        inv.status = 'paid'
        inv.save(update_fields=['status'])

        from apps.billing.pdf_service import _generate_store_and_email_pdf
        _generate_store_and_email_pdf(inv.id)

        mock_email_cls.assert_not_called()
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
python manage.py test apps.billing.tests.PDFServiceTest --settings=config.settings.dev -v 2
```

Expected: `FAIL` — `_generate_store_and_email_pdf` is a no-op placeholder.

- [ ] **Step 4: Create the HTML template**

Create directory `backend/apps/billing/templates/billing/`. Create `invoice_pdf.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; margin: 0; padding: 40px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 32px; }
  .doc-type { font-size: 32px; font-weight: bold; text-transform: uppercase; }
  .paid-stamp { color: #16a34a; font-size: 26px; font-weight: bold; border: 4px solid #16a34a; display: inline-block; padding: 4px 16px; transform: rotate(-8deg); margin-top: 8px; }
  .marina-info { text-align: right; font-size: 12px; color: #555; line-height: 1.6; }
  .invoice-meta { margin-bottom: 24px; font-size: 13px; }
  .invoice-meta span { margin-right: 32px; }
  .parties { margin-bottom: 28px; }
  .party h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.items th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 12px; }
  table.items td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
  table.totals { margin-left: auto; width: 280px; border-collapse: collapse; }
  table.totals td { padding: 5px 10px; }
  table.totals td:last-child { text-align: right; }
  .grand-total td { font-weight: bold; font-size: 15px; border-top: 2px solid #222; padding-top: 8px; }
  .footer { margin-top: 40px; font-size: 11px; color: #888; border-top: 1px solid #e5e7eb; padding-top: 12px; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="doc-type">{% if invoice.status == 'paid' %}Receipt{% else %}Invoice{% endif %}</div>
    {% if invoice.status == 'paid' %}<div class="paid-stamp">PAID</div>{% endif %}
  </div>
  <div class="marina-info">
    <strong>{{ invoice.marina.name }}</strong><br>
    {{ invoice.marina.address|linebreaksbr }}<br>
    {% if invoice.marina.vat_number %}VAT No: {{ invoice.marina.vat_number }}<br>{% endif %}
    {{ invoice.marina.contact_email }}
  </div>
</div>

<div class="invoice-meta">
  <span><strong>{{ invoice.invoice_number }}</strong></span>
  {% if invoice.status == 'paid' %}
    <span>Paid: {{ invoice.paid_at|date:"d M Y" }}</span>
  {% else %}
    <span>Issued: {{ invoice.created_at|date:"d M Y" }}</span>
    {% if invoice.due_date %}<span>Due: {{ invoice.due_date|date:"d M Y" }}</span>{% endif %}
  {% endif %}
</div>

<div class="parties">
  <div class="party">
    <h4>Billed To</h4>
    {% if invoice.member %}
      {{ invoice.member.name }}<br>
      {% if invoice.member.email %}{{ invoice.member.email }}{% endif %}
    {% else %}
      Walk-in Customer
    {% endif %}
  </div>
</div>

<table class="items">
  <thead>
    <tr>
      <th>Description</th>
      <th>Qty</th>
      <th>Unit Price</th>
      <th>Total</th>
    </tr>
  </thead>
  <tbody>
    {% for item in invoice.items.all %}
    <tr>
      <td>{{ item.description }}</td>
      <td>{{ item.quantity }}</td>
      <td>{{ invoice.marina.currency }} {{ item.unit_price }}</td>
      <td>{{ invoice.marina.currency }} {{ item.total_price }}</td>
    </tr>
    {% endfor %}
  </tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td><td>{{ invoice.marina.currency }} {{ invoice.subtotal }}</td></tr>
  <tr><td>VAT ({{ invoice.vat_rate }}%)</td><td>{{ invoice.marina.currency }} {{ invoice.tax_total }}</td></tr>
  <tr class="grand-total"><td>Total</td><td>{{ invoice.marina.currency }} {{ invoice.total }}</td></tr>
</table>

{% if invoice.status != 'paid' and invoice.due_date %}
<div class="footer">
  Payment due by {{ invoice.due_date|date:"d M Y" }}. Please use the payment link provided in your email.
</div>
{% endif %}

</body>
</html>
```

- [ ] **Step 5: Implement billing/pdf_service.py**

Replace the entire contents of `backend/apps/billing/pdf_service.py`:

```python
import logging

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.mail import EmailMessage
from django.template.loader import render_to_string
from weasyprint import HTML

from .models import Invoice

logger = logging.getLogger(__name__)


def _generate_store_and_email_pdf(invoice_id):
    try:
        invoice = Invoice.objects.select_related('marina', 'member').prefetch_related('items').get(pk=invoice_id)
        html_string = render_to_string('billing/invoice_pdf.html', {'invoice': invoice})
        pdf_bytes = HTML(string=html_string).write_pdf()

        path = f'invoices/{invoice.marina_id}/{invoice.invoice_number}.pdf'
        saved_path = default_storage.save(path, ContentFile(pdf_bytes))
        invoice.pdf_document = saved_path
        invoice.save(update_fields=['pdf_document'])

        if invoice.member and invoice.member.email:
            doc_type = 'Receipt' if invoice.status == 'paid' else 'Invoice'
            msg = EmailMessage(
                subject=f'DocksBase {doc_type} {invoice.invoice_number}',
                body=(
                    f'Dear {invoice.member.name},\n\n'
                    f'Please find your {doc_type.lower()} attached.\n\n'
                    f'DocksBase'
                ),
                to=[invoice.member.email],
            )
            msg.attach(f'{invoice.invoice_number}.pdf', pdf_bytes, 'application/pdf')
            msg.send(fail_silently=True)
    except Exception:
        logger.exception('PDF generation failed for invoice %s', invoice_id)
```

- [ ] **Step 6: Run tests, verify they pass**

```bash
python manage.py test apps.billing.tests.PDFServiceTest --settings=config.settings.dev -v 2
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/billing/pdf_service.py backend/apps/billing/templates/ backend/requirements.txt backend/apps/billing/tests.py
git commit -m "feat(billing): add WeasyPrint PDF generation, Supabase upload, and email delivery"
```

---

### Task 7: Strip Stripe from reservations, wire billing service

**Files:**
- Modify: `backend/apps/reservations/models.py`
- Create: `backend/apps/reservations/migrations/0005_remove_stripe_session_id.py` (auto-generated)
- Replace: `backend/apps/reservations/views.py`
- Modify: `backend/apps/reservations/urls.py`

This task removes all Stripe code from reservations and updates `AssignBerthView` and `BookingEngineRequestView` to call the billing service instead.

- [ ] **Step 1: Remove stripe_session_id from Booking model**

Open `backend/apps/reservations/models.py`. Remove this line:

```python
    stripe_session_id = models.CharField(max_length=200, blank=True)
```

- [ ] **Step 2: Generate and apply migration**

```bash
python manage.py makemigrations reservations --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
```

Expected: `0005_remove_stripe_session_id.py` created and applied.

- [ ] **Step 3: Remove stripe_session_id from BookingSerializer if present**

Open `backend/apps/reservations/serializers.py`. If `stripe_session_id` appears in any `fields` list, remove it.

- [ ] **Step 4: Replace reservations/views.py**

Replace the entire contents of `backend/apps/reservations/views.py`:

```python
import datetime

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from rest_framework import generics, status as http_status
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend

from apps.berths.models import Berth
from apps.billing import service as billing_service
from .booking_engine import (
    NoAvailableBerthError,
    compatible_available_berths,
    create_manual_approval,
    run_tetris,
)
from .models import Booking, BookingRequest
from .serializers import (
    AssignBerthSerializer,
    BookingEngineRequestSerializer,
    BookingRequestSerializer,
    BookingSerializer,
)


class BookingListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['status', 'booking_type', 'paid']
    search_fields = ['vessel__name', 'berth__code', 'guest_name']

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'vessel__owner', 'berth'
        )

    def perform_create(self, serializer):
        check_in  = serializer.validated_data['check_in']
        check_out = serializer.validated_data['check_out']
        berth     = serializer.validated_data.get('berth')
        nights    = (check_out - check_in).days or 1
        price     = berth.price_per_night if berth else None
        amount    = (price * nights) if price is not None else None
        serializer.save(marina=self.request.user.marina, nights=nights, amount=amount)


class BookingDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina)


class BookingRequestListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingRequestSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'booking_type']

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina).select_related(
            'member', 'vessel', 'berth', 'booking'
        )

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BookingRequestDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingRequestSerializer

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina)


class ConvertBookingRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from apps.members.models import Member
        from apps.vessels.models import Vessel
        try:
            br = BookingRequest.objects.get(pk=pk, marina=request.user.marina)
        except BookingRequest.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if br.status != 'pending':
            return Response({'detail': 'Only pending requests can be converted.'}, status=http_status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            member = br.member or Member.objects.create(
                marina=br.marina, name=br.guest_name,
                email=br.guest_email, phone=br.guest_phone,
            )
            vessel = br.vessel or Vessel.objects.create(
                marina=br.marina,
                name=br.guest_vessel or f"{br.guest_name}'s boat",
                owner=member, loa=br.guest_loa,
            )
            nights = (br.end_date - br.start_date).days or 1
            amount = (br.berth.price_per_night * nights) if br.berth.price_per_night else None
            booking = Booking.objects.create(
                marina=br.marina, berth=br.berth, vessel=vessel,
                booking_type=br.booking_type,
                check_in=br.start_date, check_out=br.end_date,
                nights=nights, amount=amount,
            )
            br.booking = booking
            br.status = 'approved'
            br.save(update_fields=['booking', 'status'])
        return Response(BookingSerializer(booking).data, status=http_status.HTTP_201_CREATED)


class AvailableBerthsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = BookingEngineRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)
        d = ser.validated_data
        berths = compatible_available_berths(
            marina=request.user.marina,
            check_in=d['check_in'],
            check_out=d['check_out'],
            loa=d.get('boat_loa'),
            beam=d.get('boat_beam'),
        )
        from apps.berths.serializers import BerthSerializer
        return Response(BerthSerializer(berths, many=True).data)


class BookingEngineRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = BookingEngineRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)
        d = ser.validated_data
        marina = request.user.marina
        try:
            if marina.booking_mode == 'manual_approval':
                booking = create_manual_approval(marina=marina, **d)
                return Response(BookingSerializer(booking).data, status=http_status.HTTP_201_CREATED)
            else:
                booking = run_tetris(marina=marina, **d)
                nights_label = f'{booking.nights} night{"s" if booking.nights != 1 else ""}'
                due_date = datetime.date.today() + datetime.timedelta(days=marina.payment_terms)
                inv = billing_service.create_invoice(
                    marina,
                    member=booking.vessel.owner if booking.vessel else None,
                    source_type='berth_booking',
                    source_id=str(booking.id),
                    due_date=due_date,
                )
                billing_service.add_line_item(
                    inv,
                    description=f'Berth {booking.berth.code} — {nights_label} @ {booking.berth.price_per_night}/night',
                    quantity=1,
                    unit_price=booking.amount,
                )
                billing_service.finalize_invoice(inv)
                checkout_url = billing_service.create_stripe_checkout_session(inv)
                return Response(
                    {'booking': BookingSerializer(booking).data, 'checkout_url': checkout_url},
                    status=http_status.HTTP_201_CREATED,
                )
        except NoAvailableBerthError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_409_CONFLICT)


class AssignBerthView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if booking.status != 'pending_approval':
            return Response(
                {'detail': 'Only pending_approval bookings can be assigned a berth.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        ser = AssignBerthSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            berth = Berth.objects.get(pk=ser.validated_data['berth_id'], marina=request.user.marina)
        except Berth.DoesNotExist:
            return Response({'detail': 'Berth not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if booking.boat_loa and berth.length_m and berth.length_m < booking.boat_loa:
            return Response({'detail': 'Berth is too short for this boat.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if booking.boat_beam and berth.max_beam_m and berth.max_beam_m < booking.boat_beam:
            return Response({'detail': 'Berth beam limit too narrow for this boat.'}, status=http_status.HTTP_400_BAD_REQUEST)

        nights = booking.nights or 1
        amount = (berth.price_per_night * nights) if berth.price_per_night else 0
        due_date = datetime.date.today() + datetime.timedelta(days=request.user.marina.payment_terms)
        nights_label = f'{nights} night{"s" if nights != 1 else ""}'

        try:
            with transaction.atomic():
                booking.berth = berth
                booking.amount = amount
                booking.status = 'awaiting_payment'
                booking.save(update_fields=['berth', 'amount', 'status'])

                inv = billing_service.create_invoice(
                    request.user.marina,
                    member=booking.vessel.owner if booking.vessel else None,
                    source_type='berth_booking',
                    source_id=str(booking.id),
                    due_date=due_date,
                )
                billing_service.add_line_item(
                    inv,
                    description=f'Berth {berth.code} — {nights_label} @ {berth.price_per_night}/night',
                    quantity=1,
                    unit_price=amount,
                )
                billing_service.finalize_invoice(inv)
                checkout_url = billing_service.create_stripe_checkout_session(inv)
        except Exception:
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        email_address = booking.guest_email or (
            booking.vessel.owner.email if booking.vessel and booking.vessel.owner else None
        )
        if email_address:
            send_mail(
                subject='Your DocksBase Booking — Pay Now',
                message=(
                    f"Hello {booking.guest_name or 'there'},\n\n"
                    f"Your berth ({berth.code}) has been assigned for "
                    f"{booking.check_in} – {booking.check_out}.\n\n"
                    f"Please complete payment here:\n{checkout_url}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email_address],
                fail_silently=True,
            )

        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)
```

- [ ] **Step 5: Update reservations/urls.py**

Replace `backend/apps/reservations/urls.py` — remove `StripeWebhookView` import and URL:

```python
from django.urls import path
from .views import (
    BookingListCreateView, BookingDetailView,
    BookingRequestListCreateView, BookingRequestDetailView,
    ConvertBookingRequestView,
    AvailableBerthsView,
    BookingEngineRequestView,
    AssignBerthView,
)

urlpatterns = [
    path('bookings/available-berths/',         AvailableBerthsView.as_view(),      name='available_berths'),
    path('bookings/engine-request/',           BookingEngineRequestView.as_view(), name='booking_engine_request'),
    path('bookings/',                          BookingListCreateView.as_view(),    name='booking_list'),
    path('bookings/<int:pk>/',                 BookingDetailView.as_view(),        name='booking_detail'),
    path('bookings/<int:pk>/assign-berth/',    AssignBerthView.as_view(),          name='assign_berth'),
    path('booking-requests/',                  BookingRequestListCreateView.as_view(), name='booking_request_list'),
    path('booking-requests/<int:pk>/',         BookingRequestDetailView.as_view(), name='booking_request_detail'),
    path('booking-requests/<int:pk>/convert/', ConvertBookingRequestView.as_view(), name='booking_request_convert'),
]
```

- [ ] **Step 6: Run full test suite**

```bash
python manage.py test apps.billing apps.reservations --settings=config.settings.dev -v 2
```

Expected: all tests pass. If any test fails due to `stripe_session_id` referenced somewhere unexpected, grep for it and remove:

```bash
grep -r "stripe_session_id" backend/apps/
```

- [ ] **Step 7: System check**

```bash
python manage.py check --settings=config.settings.dev
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 8: Commit**

```bash
git add backend/apps/reservations/
git commit -m "feat(billing): strip Stripe from reservations, wire AssignBerthView and BookingEngineRequestView to billing service"
```
