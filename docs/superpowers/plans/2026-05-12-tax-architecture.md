# Tax Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Invoice.vat_rate` and `ChargeableItem.tax_rate` with a per-marina `TaxRate` model, introduce item-level tax resolution, and expose a Tax Rates settings UI.

**Architecture:** Three sequential migrations bridge the existing decimal fields to a normalised FK without touching historical invoice data. The `InvoiceLineItem.tax_rate` decimal snapshot is the immutable audit trail — it is never removed. All tax arithmetic uses `Decimal(str(...))` + `quantize(ROUND_HALF_UP)` to prevent float contamination.

**Tech Stack:** Django 6, Django REST Framework, pytest/Django TestCase, React (JSX), existing `api.js` fetch client.

---

## File Map

**Create:**
- `backend/apps/billing/migrations/0005_taxrate_model.py`
- `backend/apps/billing/migrations/0006_taxrate_data_migration.py`
- `backend/apps/billing/migrations/0007_taxrate_cleanup.py`
- `backend/apps/billing/tests/test_tax_rates.py`
- `frontend/src/screens/TaxRatesSettings.jsx`

**Modify:**
- `backend/apps/billing/models.py` — add `TaxRate`, add `ChargeableItem.tax_category`, drop `ChargeableItem.tax_rate`
- `backend/apps/billing/service.py` — add TaxRate service functions, update snapshot calls
- `backend/apps/billing/serializers.py` — add `TaxRateSerializer`, update `ChargeableItemSerializer`, remove `vat_rate` from `InvoiceSerializer`
- `backend/apps/billing/views.py` — add four TaxRate views
- `backend/apps/billing/urls.py` — add `tax-rates/` URL patterns
- `backend/apps/billing/admin.py` — register `TaxRate`
- `backend/apps/billing/tests/test_billing.py` — update `make_marina` helper, remove stale `vat_rate` references
- `backend/apps/accounts/views.py` — call `seed_default_tax_rates` at marina creation
- `frontend/src/screens/CatalogFormDrawer.jsx` — replace `tax_rate` input with `tax_category_id` dropdown
- `frontend/src/screens/Settings.jsx` — add Tax Rates tab

---

## Task 1: Add `TaxRate` model to `models.py`

**Files:**
- Modify: `backend/apps/billing/models.py`

- [ ] **Step 1: Write the failing test**

In `backend/apps/billing/tests/test_tax_rates.py` (create the file):

```python
from decimal import Decimal
from django.test import TestCase
from apps.accounts.models import Marina
from apps.billing.models import TaxRate


class TaxRateModelTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')

    def test_create_tax_rate(self):
        tr = TaxRate.objects.create(
            marina=self.marina, name='Standard VAT', rate=Decimal('20.00'), is_default=True,
        )
        self.assertEqual(tr.name, 'Standard VAT')
        self.assertEqual(tr.rate, Decimal('20.00'))
        self.assertTrue(tr.is_default)
        self.assertFalse(tr.is_archived)

    def test_unique_name_per_marina(self):
        TaxRate.objects.create(marina=self.marina, name='Standard VAT', rate=Decimal('20.00'))
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            TaxRate.objects.create(marina=self.marina, name='Standard VAT', rate=Decimal('21.00'))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
python manage.py test apps.billing.tests.test_tax_rates.TaxRateModelTest -v 2
```
Expected: FAIL — `TaxRate` does not exist yet.

- [ ] **Step 3: Add `TaxRate` to `models.py`**

In `backend/apps/billing/models.py`, add after the imports and before `class Invoice`:

```python
class TaxRate(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tax_rates')
    name        = models.CharField(max_length=100)
    rate        = models.DecimalField(max_digits=5, decimal_places=2)
    is_default  = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'name')]
        ordering = ['-rate']

    def __str__(self):
        return f'{self.name} ({self.rate}%)'
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python manage.py test apps.billing.tests.test_tax_rates.TaxRateModelTest -v 2
```
Expected: PASS (Django will use the model without running migrations in tests).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/billing/models.py backend/apps/billing/tests/test_tax_rates.py
git commit -m "feat(billing): add TaxRate model"
```

---

## Task 2: Migration 1 — schema (TaxRate table + nullable FK)

**Files:**
- Create: `backend/apps/billing/migrations/0005_taxrate_model.py`

- [ ] **Step 1: Generate the migration**

```bash
cd backend
python manage.py makemigrations billing --name taxrate_model
```
Expected: Creates `billing/migrations/0005_taxrate_model.py`.

- [ ] **Step 2: Add the nullable `tax_category` FK to the generated migration**

Open `backend/apps/billing/migrations/0005_taxrate_model.py`. After the `CreateModel` operation, add:

```python
migrations.AddField(
    model_name='chargeableitem',
    name='tax_category',
    field=models.ForeignKey(
        'billing.TaxRate',
        on_delete=django.db.models.deletion.PROTECT,
        related_name='chargeable_items',
        null=True,
        blank=True,
    ),
),
```

Also add to the migration imports at the top:

```python
import django.db.models.deletion
```

- [ ] **Step 3: Apply migration**

```bash
python manage.py migrate billing 0005
```
Expected: OK — TaxRate table created, `chargeableitem.tax_category_id` column added (nullable).

- [ ] **Step 4: Commit**

```bash
git add backend/apps/billing/migrations/0005_taxrate_model.py
git commit -m "feat(billing): migration 1 — TaxRate table + nullable FK on ChargeableItem"
```

---

## Task 3: Migration 2 — RunPython data migration

**Files:**
- Create: `backend/apps/billing/migrations/0006_taxrate_data_migration.py`

- [ ] **Step 1: Create the migration file manually**

Create `backend/apps/billing/migrations/0006_taxrate_data_migration.py`:

```python
from decimal import Decimal
from django.db import migrations


def seed_tax_rates(apps, schema_editor):
    Marina = apps.get_model('accounts', 'Marina')
    TaxRate = apps.get_model('billing', 'TaxRate')
    ChargeableItem = apps.get_model('billing', 'ChargeableItem')

    for marina in Marina.objects.all():
        items = ChargeableItem.objects.filter(marina=marina)
        if not items.exists():
            continue

        standard, _ = TaxRate.objects.get_or_create(
            marina=marina, name='Standard — 20.00%',
            defaults={'rate': Decimal('20.00'), 'is_default': True},
        )
        zero_rated, _ = TaxRate.objects.get_or_create(
            marina=marina, name='Zero Rated — 0.00%',
            defaults={'rate': Decimal('0.00')},
        )
        TaxRate.objects.get_or_create(
            marina=marina, name='Exempt — 0.00%',
            defaults={'rate': Decimal('0.00')},
        )

        for item in items:
            if item.tax_rate == Decimal('0.00'):
                item.tax_category = zero_rated
            elif item.tax_rate == Decimal('20.00'):
                item.tax_category = standard
            else:
                # Non-standard rate: create a dedicated TaxRate record for it
                custom_name = f'Custom — {item.tax_rate}%'
                custom_rate, _ = TaxRate.objects.get_or_create(
                    marina=marina, name=custom_name,
                    defaults={'rate': item.tax_rate},
                )
                item.tax_category = custom_rate
            item.save(update_fields=['tax_category'])


def reverse_seed(apps, schema_editor):
    ChargeableItem = apps.get_model('billing', 'ChargeableItem')
    ChargeableItem.objects.all().update(tax_category=None)


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0005_taxrate_model'),
    ]

    operations = [
        migrations.RunPython(seed_tax_rates, reverse_seed),
    ]
```

- [ ] **Step 2: Apply migration**

```bash
python manage.py migrate billing 0006
```
Expected: OK — all existing ChargeableItems now have a `tax_category` FK set.

- [ ] **Step 3: Verify in Django shell**

```bash
python manage.py shell -c "
from apps.billing.models import ChargeableItem
nulls = ChargeableItem.objects.filter(tax_category__isnull=True).count()
print('Items without tax_category:', nulls)
"
```
Expected output: `Items without tax_category: 0`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/billing/migrations/0006_taxrate_data_migration.py
git commit -m "feat(billing): migration 2 — seed TaxRate records and assign to ChargeableItems"
```

---

## Task 4: Migration 3 — cleanup (NOT NULL, drop old columns)

**Files:**
- Create: `backend/apps/billing/migrations/0007_taxrate_cleanup.py`
- Modify: `backend/apps/billing/models.py`

- [ ] **Step 1: Update `ChargeableItem` in `models.py`**

In `backend/apps/billing/models.py`, on the `ChargeableItem` class:

Remove this line:
```python
tax_rate      = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
```

Change the `tax_category` field from nullable to non-null:
```python
tax_category  = models.ForeignKey(
    'billing.TaxRate',
    on_delete=models.PROTECT,
    related_name='chargeable_items',
)
```

On the `Invoice` class, remove this line:
```python
vat_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, default=Decimal('0.00'))
```

- [ ] **Step 2: Generate the cleanup migration**

```bash
python manage.py makemigrations billing --name taxrate_cleanup
```
Expected: Creates `0007_taxrate_cleanup.py` with operations to make `tax_category` non-null and remove both old decimal fields.

- [ ] **Step 3: Apply migration**

```bash
python manage.py migrate billing 0007
```
Expected: OK.

- [ ] **Step 4: Run existing billing tests to catch regressions**

```bash
python manage.py test apps.billing -v 2
```
Expected: Most tests fail because `make_marina` still passes `vat_rate=` and `ChargeableItem` creation still uses `tax_rate=`. Note which tests fail — they are fixed in Task 8.

- [ ] **Step 5: Commit models and migration**

```bash
git add backend/apps/billing/models.py backend/apps/billing/migrations/0007_taxrate_cleanup.py
git commit -m "feat(billing): migration 3 — enforce NOT NULL on tax_category, drop tax_rate and vat_rate columns"
```

---

## Task 5: TaxRate service functions

**Files:**
- Modify: `backend/apps/billing/service.py`
- Modify: `backend/apps/billing/tests/test_tax_rates.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/billing/tests/test_tax_rates.py`:

```python
from apps.billing.service import (
    create_tax_rate, set_default_tax_rate, delete_tax_rate, seed_default_tax_rates,
)


class TaxRateServiceTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Service Test Marina')

    def test_seed_creates_three_rates(self):
        rates = seed_default_tax_rates(self.marina)
        self.assertEqual(len(rates), 3)
        names = {r.name for r in rates}
        self.assertIn('Standard — 20.00%', names)
        self.assertIn('Zero Rated — 0.00%', names)
        self.assertIn('Exempt — 0.00%', names)

    def test_seed_is_idempotent(self):
        seed_default_tax_rates(self.marina)
        seed_default_tax_rates(self.marina)
        self.assertEqual(TaxRate.objects.filter(marina=self.marina).count(), 3)

    def test_seed_standard_is_default(self):
        seed_default_tax_rates(self.marina)
        default = TaxRate.objects.get(marina=self.marina, is_default=True)
        self.assertEqual(default.name, 'Standard — 20.00%')

    def test_create_tax_rate_clears_previous_default(self):
        seed_default_tax_rates(self.marina)
        new_rate = create_tax_rate(self.marina, name='Standard 2026 — 21.00%', rate=Decimal('21.00'), is_default=True)
        defaults = TaxRate.objects.filter(marina=self.marina, is_default=True)
        self.assertEqual(defaults.count(), 1)
        self.assertEqual(defaults.first().pk, new_rate.pk)

    def test_set_default_clears_others(self):
        seed_default_tax_rates(self.marina)
        zero = TaxRate.objects.get(marina=self.marina, name='Zero Rated — 0.00%')
        set_default_tax_rate(zero)
        self.assertTrue(TaxRate.objects.get(pk=zero.pk).is_default)
        others = TaxRate.objects.filter(marina=self.marina, is_default=True).exclude(pk=zero.pk)
        self.assertEqual(others.count(), 0)

    def test_delete_tax_rate_with_no_items(self):
        seed_default_tax_rates(self.marina)
        exempt = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        delete_tax_rate(exempt)
        self.assertFalse(TaxRate.objects.filter(pk=exempt.pk).exists())

    def test_delete_tax_rate_raises_if_items_assigned(self):
        from apps.billing.models import ChargeableItem
        seed_default_tax_rates(self.marina)
        standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        ChargeableItem.objects.create(
            marina=self.marina, name='Test Slip', category='berth',
            pricing_model='per_night', unit_price=Decimal('50.00'),
            tax_category=standard,
        )
        with self.assertRaises(ValueError, msg='should raise when items assigned'):
            delete_tax_rate(standard)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python manage.py test apps.billing.tests.test_tax_rates.TaxRateServiceTest -v 2
```
Expected: FAIL — functions not yet defined.

- [ ] **Step 3: Add service functions to `service.py`**

In `backend/apps/billing/service.py`, add after the existing imports and before `create_invoice`. Add `TaxRate` to the model import:

```python
from .models import Invoice, InvoiceLineItem, Payment, TaxRate
```

Then add the functions:

```python
def seed_default_tax_rates(marina):
    from decimal import Decimal as D
    seeds = [
        ('Standard — 20.00%', D('20.00'), True),
        ('Zero Rated — 0.00%', D('0.00'), False),
        ('Exempt — 0.00%',    D('0.00'), False),
    ]
    result = []
    for name, rate, is_default in seeds:
        obj, _ = TaxRate.objects.get_or_create(
            marina=marina, name=name,
            defaults={'rate': rate, 'is_default': is_default},
        )
        result.append(obj)
    return result


def create_tax_rate(marina, name, rate, is_default=False):
    from decimal import Decimal as D
    with transaction.atomic():
        if is_default:
            TaxRate.objects.filter(marina=marina, is_default=True).update(is_default=False)
        return TaxRate.objects.create(
            marina=marina, name=name, rate=D(str(rate)), is_default=is_default,
        )


def set_default_tax_rate(tax_rate):
    with transaction.atomic():
        TaxRate.objects.filter(marina=tax_rate.marina, is_default=True).update(is_default=False)
        tax_rate.is_default = True
        tax_rate.save(update_fields=['is_default'])
    return tax_rate


def delete_tax_rate(tax_rate):
    if tax_rate.chargeable_items.exists():
        raise ValueError(
            f"Cannot delete '{tax_rate.name}' — ChargeableItems are still assigned to it. "
            "Reassign or archive those items first."
        )
    tax_rate.delete()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python manage.py test apps.billing.tests.test_tax_rates.TaxRateServiceTest -v 2
```
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/billing/service.py backend/apps/billing/tests/test_tax_rates.py
git commit -m "feat(billing): TaxRate service functions + tests"
```

---

## Task 6: Update snapshot calls and `create_invoice`

**Files:**
- Modify: `backend/apps/billing/service.py`
- Modify: `backend/apps/billing/tests/test_tax_rates.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/billing/tests/test_tax_rates.py`:

```python
from apps.billing.service import add_line_item_from_catalog, create_invoice, finalize_invoice
from apps.billing.models import ChargeableItem, InvoiceLineItem


class SnapshotTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Snapshot Marina')
        seed_default_tax_rates(self.marina)
        self.standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        self.zero = TaxRate.objects.get(marina=self.marina, name='Zero Rated — 0.00%')

    def _make_item(self, name, rate_obj, unit_price='100.00'):
        return ChargeableItem.objects.create(
            marina=self.marina, name=name, category='berth',
            pricing_model='per_night', unit_price=Decimal(unit_price),
            tax_category=rate_obj,
        )

    def test_snapshot_captures_rate_from_tax_category(self):
        item = self._make_item('Test Slip', self.standard)
        invoice = create_invoice(marina=self.marina)
        add_line_item_from_catalog(invoice, item, quantity=1)
        line = invoice.items.first()
        self.assertEqual(line.tax_rate, Decimal('20.00'))

    def test_snapshot_zero_rate(self):
        item = self._make_item('Zero Slip', self.zero)
        invoice = create_invoice(marina=self.marina)
        add_line_item_from_catalog(invoice, item, quantity=1)
        line = invoice.items.first()
        self.assertEqual(line.tax_rate, Decimal('0.00'))

    def test_finalize_sums_per_line_tax(self):
        standard_item = self._make_item('Slip', self.standard, '100.00')
        zero_item = self._make_item('Book', self.zero, '20.00')
        invoice = create_invoice(marina=self.marina)
        add_line_item_from_catalog(invoice, standard_item, quantity=1)
        add_line_item_from_catalog(invoice, zero_item, quantity=1)
        finalize_invoice(invoice)
        invoice.refresh_from_db()
        self.assertEqual(invoice.subtotal, Decimal('120.00'))
        self.assertEqual(invoice.tax_total, Decimal('20.00'))   # 20% of 100, 0% of 20
        self.assertEqual(invoice.total, Decimal('140.00'))

    def test_create_invoice_has_no_vat_rate_field(self):
        invoice = create_invoice(marina=self.marina)
        self.assertFalse(hasattr(invoice, 'vat_rate'))
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python manage.py test apps.billing.tests.test_tax_rates.SnapshotTest -v 2
```
Expected: FAIL — `add_line_item_from_catalog` still reads `chargeable_item.tax_rate`.

- [ ] **Step 3: Update `add_line_item_from_catalog` in `service.py`**

Find and update:

```python
def add_line_item_from_catalog(invoice, chargeable_item, quantity):
    """Snapshot price and tax from ChargeableItem at the moment of invoicing."""
    rate = Decimal(str(chargeable_item.tax_category.rate))
    return add_line_item(
        invoice=invoice,
        description=chargeable_item.name,
        quantity=quantity,
        unit_price=chargeable_item.unit_price,
        tax_rate=rate,
        chargeable_item=chargeable_item,
    )
```

- [ ] **Step 4: Update `calculate_booking_invoice` in `service.py`**

Find the two lines that pass `tax_rate=item.tax_rate` to `add_line_item(...)` inside `calculate_booking_invoice` and change them both to:

```python
tax_rate=Decimal(str(item.tax_category.rate)),
```

- [ ] **Step 5: Remove `vat_rate=None` from `create_invoice`**

In `create_invoice`, remove `vat_rate=None,` from the `Invoice.objects.create(...)` call.

- [ ] **Step 6: Run tests**

```bash
python manage.py test apps.billing.tests.test_tax_rates.SnapshotTest -v 2
```
Expected: All 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/billing/service.py backend/apps/billing/tests/test_tax_rates.py
git commit -m "feat(billing): snapshot tax rate from tax_category FK, remove vat_rate from create_invoice"
```

---

## Task 7: Fix existing billing tests

**Files:**
- Modify: `backend/apps/billing/tests/test_billing.py`

- [ ] **Step 1: Run existing tests to see all failures**

```bash
python manage.py test apps.billing.tests.test_billing -v 2
```
Note all failures. They all stem from `make_marina` passing `vat_rate=` and ChargeableItem factories using `tax_rate=`.

- [ ] **Step 2: Update `make_marina` helper**

In `backend/apps/billing/tests/test_billing.py`, find:

```python
def make_marina(vat_rate='8.10', stripe_account_id='acct_test123'):
    return Marina.objects.create(
        name='Test Marina',
        vat_rate=Decimal(vat_rate),
        stripe_account_id=stripe_account_id,
    )
```

Replace with:

```python
def make_marina(stripe_account_id='acct_test123'):
    from apps.billing.service import seed_default_tax_rates
    marina = Marina.objects.create(
        name='Test Marina',
        stripe_account_id=stripe_account_id,
    )
    seed_default_tax_rates(marina)
    return marina
```

- [ ] **Step 3: Fix all `ChargeableItem.objects.create(tax_rate=...)` calls in test_billing.py**

Search for every `ChargeableItem.objects.create(` in the file:

```bash
grep -n "ChargeableItem.objects.create\|tax_rate" backend/apps/billing/tests/test_billing.py
```

For each call that passes `tax_rate=`, replace it with `tax_category=` pointing to a rate from the marina. Pattern to follow — add a helper:

```python
def make_item(marina, name='Test Berth', category='berth', pricing_model='per_night',
              unit_price='50.00', rate_name='Standard — 20.00%'):
    from apps.billing.models import TaxRate
    tax_cat = TaxRate.objects.get(marina=marina, name=rate_name)
    return ChargeableItem.objects.create(
        marina=marina, name=name, category=category,
        pricing_model=pricing_model, unit_price=Decimal(unit_price),
        tax_category=tax_cat,
    )
```

Replace all inline `ChargeableItem.objects.create(...)` calls in test_billing.py with `make_item(marina, ...)`.

- [ ] **Step 4: Remove any references to `invoice.vat_rate` or `vat_rate` in test assertions**

```bash
grep -n "vat_rate" backend/apps/billing/tests/test_billing.py
```

Remove or replace each reference. The `MarinaFieldsTest` tests for `vat_rate` and `stripe_account_id` can be deleted entirely (the column no longer exists).

- [ ] **Step 5: Run all billing tests**

```bash
python manage.py test apps.billing -v 2
```
Expected: All tests PASS (green).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/billing/tests/test_billing.py
git commit -m "fix(billing): update test helpers to use TaxRate FK, remove vat_rate references"
```

---

## Task 8: TaxRate serializer and API views

**Files:**
- Modify: `backend/apps/billing/serializers.py`
- Modify: `backend/apps/billing/views.py`
- Modify: `backend/apps/billing/urls.py`
- Modify: `backend/apps/billing/tests/test_tax_rates.py`

- [ ] **Step 1: Write failing API tests**

Append to `backend/apps/billing/tests/test_tax_rates.py`:

```python
from rest_framework.test import APIClient
from apps.accounts.models import User


class TaxRateAPITest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='API Test Marina')
        seed_default_tax_rates(self.marina)
        self.user = User.objects.create_user(
            email='mgr@marina.test', password='pass', marina=self.marina, role='manager',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_returns_non_archived(self):
        archived = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        archived.is_archived = True
        archived.save()
        resp = self.client.get('/api/v1/billing/tax-rates/')
        self.assertEqual(resp.status_code, 200)
        names = [r['name'] for r in resp.json()]
        self.assertNotIn('Exempt — 0.00%', names)
        self.assertIn('Standard — 20.00%', names)

    def test_create_new_rate(self):
        resp = self.client.post('/api/v1/billing/tax-rates/', {
            'name': 'Reduced Rate — 5.00%', 'rate': '5.00',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(TaxRate.objects.filter(marina=self.marina, name='Reduced Rate — 5.00%').exists())

    def test_archive(self):
        exempt = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        resp = self.client.post(f'/api/v1/billing/tax-rates/{exempt.pk}/archive/')
        self.assertEqual(resp.status_code, 200)
        exempt.refresh_from_db()
        self.assertTrue(exempt.is_archived)

    def test_delete_unused_rate(self):
        exempt = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        resp = self.client.delete(f'/api/v1/billing/tax-rates/{exempt.pk}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(TaxRate.objects.filter(pk=exempt.pk).exists())

    def test_delete_in_use_rate_returns_409(self):
        from apps.billing.models import ChargeableItem
        standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        ChargeableItem.objects.create(
            marina=self.marina, name='Test Slip', category='berth',
            pricing_model='per_night', unit_price=Decimal('50.00'),
            tax_category=standard,
        )
        resp = self.client.delete(f'/api/v1/billing/tax-rates/{standard.pk}/')
        self.assertEqual(resp.status_code, 409)

    def test_set_default(self):
        zero = TaxRate.objects.get(marina=self.marina, name='Zero Rated — 0.00%')
        resp = self.client.post(f'/api/v1/billing/tax-rates/{zero.pk}/set-default/')
        self.assertEqual(resp.status_code, 200)
        zero.refresh_from_db()
        self.assertTrue(zero.is_default)
        standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        self.assertFalse(standard.is_default)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python manage.py test apps.billing.tests.test_tax_rates.TaxRateAPITest -v 2
```
Expected: FAIL — endpoints don't exist yet.

- [ ] **Step 3: Add `TaxRateSerializer` to `serializers.py`**

In `backend/apps/billing/serializers.py`, add `TaxRate` to the import and the serializer class:

```python
from .models import Invoice, InvoiceLineItem, Payment, ChargeableItem, TaxRate


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        fields = ['id', 'name', 'rate', 'is_default', 'is_archived', 'created_at']
        read_only_fields = ['id', 'is_archived', 'created_at']
```

- [ ] **Step 4: Update `ChargeableItemSerializer` in `serializers.py`**

Replace:
```python
'unit_price', 'tax_rate', 'is_active',
```
With:
```python
'unit_price', 'tax_category', 'tax_category_id', 'is_active',
```

Add the nested read field inside the serializer class, before `Meta`:
```python
tax_category = TaxRateSerializer(read_only=True)
tax_category_id = serializers.PrimaryKeyRelatedField(
    queryset=TaxRate.objects.all(), source='tax_category', write_only=True,
)
```

And update `read_only_fields` to remove `'tax_rate'` (no longer exists).

- [ ] **Step 5: Update `InvoiceSerializer` in `serializers.py`**

Remove `'vat_rate'` from `fields` list in `InvoiceSerializer.Meta`.

- [ ] **Step 6: Add TaxRate views to `views.py`**

In `backend/apps/billing/views.py`, add these four view classes (add `TaxRate` and `TaxRateSerializer` to imports):

```python
from .models import Invoice, InvoiceLineItem, ChargeableItem, TaxRate
from .serializers import InvoiceSerializer, InvoiceLineItemSerializer, ChargeableItemSerializer, TaxRateSerializer
from . import service as billing_service


class TaxRateListCreateView(generics.ListCreateAPIView):
    serializer_class = TaxRateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return TaxRate.objects.filter(marina=self.request.user.marina, is_archived=False)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tr = billing_service.create_tax_rate(
            marina=request.user.marina,
            name=serializer.validated_data['name'],
            rate=serializer.validated_data['rate'],
            is_default=serializer.validated_data.get('is_default', False),
        )
        return Response(TaxRateSerializer(tr).data, status=http_status.HTTP_201_CREATED)


class TaxRateArchiveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tr = TaxRate.objects.get(pk=pk, marina=request.user.marina)
        except TaxRate.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        tr.is_archived = True
        tr.is_default = False
        tr.save(update_fields=['is_archived', 'is_default'])
        return Response(TaxRateSerializer(tr).data)


class TaxRateDeleteView(generics.DestroyAPIView):
    serializer_class = TaxRateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return TaxRate.objects.filter(marina=self.request.user.marina)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            billing_service.delete_tax_rate(instance)
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_409_CONFLICT)
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class TaxRateSetDefaultView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tr = TaxRate.objects.get(pk=pk, marina=request.user.marina)
        except TaxRate.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if tr.is_archived:
            return Response({'detail': 'Archived rates cannot be set as default.'}, status=http_status.HTTP_400_BAD_REQUEST)
        billing_service.set_default_tax_rate(tr)
        return Response(TaxRateSerializer(tr).data)
```

- [ ] **Step 7: Add URL patterns to `urls.py`**

In `backend/apps/billing/urls.py`, add to imports:

```python
from .views import (
    ...,
    TaxRateListCreateView, TaxRateArchiveView, TaxRateDeleteView, TaxRateSetDefaultView,
)
```

Add to `urlpatterns`:

```python
path('tax-rates/',                             TaxRateListCreateView.as_view(), name='tax_rate_list'),
path('tax-rates/<int:pk>/',                    TaxRateDeleteView.as_view(),     name='tax_rate_delete'),
path('tax-rates/<int:pk>/archive/',            TaxRateArchiveView.as_view(),    name='tax_rate_archive'),
path('tax-rates/<int:pk>/set-default/',        TaxRateSetDefaultView.as_view(), name='tax_rate_set_default'),
```

- [ ] **Step 8: Run API tests**

```bash
python manage.py test apps.billing.tests.test_tax_rates.TaxRateAPITest -v 2
```
Expected: All 6 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/billing/serializers.py backend/apps/billing/views.py backend/apps/billing/urls.py backend/apps/billing/tests/test_tax_rates.py
git commit -m "feat(billing): TaxRate serializer, API views, and URL patterns"
```

---

## Task 9: Register `TaxRate` in Django admin + onboarding hook

**Files:**
- Modify: `backend/apps/billing/admin.py`
- Modify: `backend/apps/accounts/views.py`

- [ ] **Step 1: Register TaxRate in admin**

In `backend/apps/billing/admin.py`:

```python
from .models import Invoice, InvoiceLineItem, Payment, ChargeableItem, TaxRate


@admin.register(TaxRate)
class TaxRateAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'rate', 'is_default', 'is_archived', 'created_at']
    list_filter   = ['marina', 'is_default', 'is_archived']
    search_fields = ['name']
    readonly_fields = ['rate', 'created_at']
```

Note: `rate` is `readonly_fields` in admin too — enforces immutability for superusers.

- [ ] **Step 2: Add `seed_default_tax_rates` call in marina creation**

In `backend/apps/accounts/views.py`, find the `with transaction.atomic():` block that creates the Marina (around line 505). After `Marina.objects.create(...)` returns the marina object, add:

```python
from apps.billing.service import seed_default_tax_rates
seed_default_tax_rates(marina)
```

The full block should look like:

```python
with transaction.atomic():
    marina = Marina.objects.create(
        name=d['marina_name'],
        ...
    )
    from apps.billing.service import seed_default_tax_rates
    seed_default_tax_rates(marina)

    User.objects.create_user(...)
```

- [ ] **Step 3: Run all billing and accounts tests**

```bash
python manage.py test apps.billing apps.accounts -v 2
```
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/billing/admin.py backend/apps/accounts/views.py
git commit -m "feat(billing): register TaxRate in admin; seed default rates on marina creation"
```

---

## Task 10: Frontend — `TaxRatesSettings` component

**Files:**
- Create: `frontend/src/screens/TaxRatesSettings.jsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/screens/TaxRatesSettings.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

const lbl = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)',
  display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px',
};

const inputSt = {
  width: '100%', border: 'var(--border)', borderRadius: 5,
  padding: '7px 10px', fontSize: 13, fontFamily: 'var(--font)',
  boxSizing: 'border-box', outline: 'none',
};

export default function TaxRatesSettings() {
  const [rates, setRates]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ name: '', rate: '' });
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/billing/tax-rates/');
      setRates(data);
    } catch {
      setError('Failed to load tax rates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required.'); return; }
    const rate = parseFloat(form.rate);
    if (isNaN(rate) || rate < 0 || rate > 100) { setFormError('Rate must be between 0 and 100.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/billing/tax-rates/', { name: form.name.trim(), rate: rate.toFixed(2) });
      setForm({ name: '', rate: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      const detail = err?.response?.data?.detail
        ?? Object.values(err?.response?.data ?? {}).flat().join(' ')
        ?? 'Save failed.';
      setFormError(String(detail));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id) {
    try {
      await api.post(`/billing/tax-rates/${id}/set-default/`);
      await load();
    } catch {
      setError('Failed to set default.');
    }
  }

  async function handleArchive(id) {
    try {
      await api.post(`/billing/tax-rates/${id}/archive/`);
      await load();
    } catch {
      setError('Failed to archive rate.');
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/billing/tax-rates/${id}/`);
      await load();
    } catch (err) {
      const detail = err?.response?.data?.detail ?? 'Delete failed.';
      setError(String(detail));
    }
  }

  const active   = rates.filter(r => !r.is_archived);
  const archived = rates.filter(r => r.is_archived);

  return (
    <div style={{ maxWidth: 680 }}>
      {/* Disclaimer */}
      <div style={{
        background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6,
        padding: '10px 14px', fontSize: 12, color: '#92400e', marginBottom: 20,
      }}>
        You are responsible for ensuring these rates are correct and up to date.
        DocksBase applies the rate you set — we do not provide tax advice.
        Consult your accountant if you are unsure which rate applies to a given item.
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#b91c1c', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Active rates table */}
      {loading ? (
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>Loading…</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase' }}>Name</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase' }}>Rate</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: 11, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase' }}>Default</th>
              <th style={{ padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {active.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 8px' }}>{r.name}</td>
                <td style={{ textAlign: 'right', padding: '8px 8px', fontVariantNumeric: 'tabular-nums' }}>{parseFloat(r.rate).toFixed(2)}%</td>
                <td style={{ textAlign: 'center', padding: '8px 8px' }}>
                  <button
                    onClick={() => !r.is_default && handleSetDefault(r.id)}
                    title={r.is_default ? 'Default rate' : 'Set as default'}
                    style={{
                      background: 'none', border: 'none', cursor: r.is_default ? 'default' : 'pointer',
                      fontSize: 16, color: r.is_default ? '#f59e0b' : 'rgba(0,0,0,0.2)',
                    }}
                  >★</button>
                </td>
                <td style={{ padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap', display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={() => handleArchive(r.id)}>Archive</button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(r.id, r.name)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add rate form */}
      {showForm ? (
        <form onSubmit={handleCreate} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
          <div>
            <label style={lbl}>Rate Name</label>
            <input style={inputSt} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Reduced Rate — 5.00%" />
          </div>
          <div>
            <label style={lbl}>Rate (%)</label>
            <input style={{ ...inputSt, width: 120 }} type="number" min="0" max="100" step="0.01" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} placeholder="0.00" />
          </div>
          {formError && <p style={{ color: '#b91c1c', fontSize: 12, margin: 0 }}>{formError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Add Rate'}</button>
            <button type="button" className="btn btn-sm" onClick={() => { setShowForm(false); setFormError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setShowForm(true)}>+ Add Tax Rate</button>
      )}

      {/* Archived section */}
      {archived.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', cursor: 'pointer' }}>
            Archived ({archived.length})
          </summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8, opacity: 0.6 }}>
            <tbody>
              {archived.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', color: 'rgba(0,0,0,0.5)' }}>{r.name}</td>
                  <td style={{ textAlign: 'right', padding: '6px 8px' }}>{parseFloat(r.rate).toFixed(2)}%</td>
                  <td style={{ padding: '6px 8px' }} />
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify `api.js` has the needed methods**

```bash
grep -n "get\|post\|delete" frontend/src/api.js | head -20
```

Confirm `api.get`, `api.post`, and `api.delete` exist. If the methods are named differently, update the `TaxRatesSettings.jsx` calls to match.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/TaxRatesSettings.jsx
git commit -m "feat(frontend): TaxRatesSettings component"
```

---

## Task 11: Frontend — wire Tax Rates tab into Settings

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`

- [ ] **Step 1: Add the import**

At the top of `frontend/src/screens/Settings.jsx`, add:

```jsx
import TaxRatesSettings from './TaxRatesSettings.jsx';
```

- [ ] **Step 2: Add the tab definition**

Find the tab array (around line 619):

```jsx
['billing',       'Billing',          false],
```

Add after it:

```jsx
['tax-rates',     'Tax Rates',        false],
```

- [ ] **Step 3: Add the tab panel**

Find the last `{tab === '...' && (...)}` block and add after it:

```jsx
{tab === 'tax-rates' && (
  <div style={{ padding: '24px 0' }}>
    <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Tax Rates</h3>
    <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>
      Define the tax rates applied to individual items in your service catalog.
      Rates are immutable once created — to change a rate, create a new one and archive the old.
    </p>
    <TaxRatesSettings />
  </div>
)}
```

- [ ] **Step 4: Verify in browser**

Start the dev server:
```bash
cd frontend && npm run dev
```

Navigate to Settings → Tax Rates tab. Verify:
- Seeded rates appear in the table
- ★ default toggle works
- Archive button hides a rate and moves it to the collapsed Archived section
- Delete button prompts and removes an unused rate
- + Add Tax Rate form creates a new rate and it appears in the table
- Disclaimer banner is visible

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/Settings.jsx
git commit -m "feat(frontend): add Tax Rates tab to Settings screen"
```

---

## Task 12: Frontend — update `CatalogFormDrawer` to use `tax_category_id`

**Files:**
- Modify: `frontend/src/screens/CatalogFormDrawer.jsx`

- [ ] **Step 1: Fetch tax rates in the drawer**

In `CatalogFormDrawer.jsx`, add a `taxRates` state and fetch on open. Add after the existing `useState` declarations:

```jsx
const [taxRates, setTaxRates] = useState([]);

useEffect(() => {
  if (open) {
    api.get('/billing/tax-rates/').then(setTaxRates).catch(() => {});
  }
}, [open]);
```

- [ ] **Step 2: Update `blankForm` to use `tax_category_id`**

Replace:
```jsx
function blankForm(category) {
  return {
    ...
    tax_rate: '20',
    ...
  };
}
```
With:
```jsx
function blankForm(category) {
  return {
    name:                       '',
    pricing_model:              DEFAULT_PRICING_MODEL[category] ?? 'flat_fee',
    unit_price:                 '',
    tax_category_id:            '',
    is_mandatory_transient_fee: false,
    is_fuel_product:            false,
    show_in_pos:                false,
    fuel_dock_type:             '',
  };
}
```

- [ ] **Step 3: Update the `useEffect` that populates the form for editing**

Find:
```jsx
tax_rate: item.tax_rate != null ? String(item.tax_rate) : '20',
```
Replace with:
```jsx
tax_category_id: item.tax_category?.id != null ? String(item.tax_category.id) : '',
```

- [ ] **Step 4: Update the `handleSave` payload**

Find:
```jsx
tax_rate: parseFloat(form.tax_rate) || 0,
```
Replace with:
```jsx
tax_category_id: parseInt(form.tax_category_id, 10),
```

Also add validation — if `tax_category_id` is empty, return an error:

In the `validate()` function, add:
```jsx
if (!form.tax_category_id) return 'Tax Treatment is required.';
```

- [ ] **Step 5: Replace the tax rate `<input>` with a `<select>`**

Find the JSX that renders the `tax_rate` input field (around line 258) and replace it with:

```jsx
<div>
  <label style={lbl}>Tax Treatment</label>
  <select
    value={form.tax_category_id}
    onChange={e => setForm(f => ({ ...f, tax_category_id: e.target.value }))}
    style={inputSt}
    required
  >
    <option value="">Select tax treatment…</option>
    {taxRates.map(r => (
      <option key={r.id} value={r.id}>
        {r.name} ({parseFloat(r.rate).toFixed(2)}%)
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 6: Set default tax_category_id when taxRates loads**

After `setTaxRates(data)` in the useEffect, set the default for new items:

```jsx
api.get('/billing/tax-rates/').then(data => {
  setTaxRates(data);
  if (!item) {
    const def = data.find(r => r.is_default);
    if (def) setForm(f => ({ ...f, tax_category_id: String(def.id) }));
  }
}).catch(() => {});
```

- [ ] **Step 7: Verify in browser**

Navigate to Service Catalog. Create a new item — confirm the Tax Treatment dropdown shows all active rates with the default pre-selected. Edit an existing item — confirm the correct rate is pre-selected. Save and verify the API call includes `tax_category_id` (not `tax_rate`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/screens/CatalogFormDrawer.jsx
git commit -m "feat(frontend): replace tax_rate input with tax_category_id dropdown in CatalogFormDrawer"
```

---

## Task 13: Full regression run

- [ ] **Step 1: Run all backend tests**

```bash
cd backend
python manage.py test -v 2
```
Expected: All tests PASS. Zero failures.

- [ ] **Step 2: Run the browser smoke test**

Start the dev server and manually verify this critical path:
1. Settings → Tax Rates: table shows seeded rates
2. Create a new rate "Reduced Rate — 5.00%"
3. Set it as default (star moves)
4. Service Catalog → create a new berth item: dropdown shows all rates, Reduced Rate pre-selected
5. Create a booking invoice in any flow: confirm the line item's `tax_rate` snapshot matches the rate on the ChargeableItem's `tax_category`
6. Archive the "Exempt" rate: it disappears from active table, appears in Archived section
7. Try to delete "Standard" while a ChargeableItem uses it: confirm 409 error message appears

- [ ] **Step 3: Final commit**

```bash
git add -p  # stage any remaining unstaged changes
git commit -m "feat(billing): complete tax architecture — TaxRate model, item-level resolution, Settings UI"
```
