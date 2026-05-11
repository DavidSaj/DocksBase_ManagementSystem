# Platform Admin — sanitize_db Management Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `python manage.py sanitize_db` — a command that scrambles PII in a restored production DB dump so engineers can develop locally without touching real data.

**Architecture:** Django management command with hard safety guards (DEBUG=True and no "prod" in DB name). Uses Faker for name/email/phone fields, sets Stripe IDs to null. Processes in batches of 500 via `bulk_update()`. Completely independent of Plans A and B.

**Tech Stack:** Django management command, Faker (dev-only dependency)

---

## File Map

| Action | File |
|---|---|
| Create | `apps/admin_portal/management/__init__.py` |
| Create | `apps/admin_portal/management/commands/__init__.py` |
| Create | `apps/admin_portal/management/commands/sanitize_db.py` |
| Modify | `requirements-dev.txt` — add `faker` |
| Create | `apps/admin_portal/tests_sanitizer.py` |

---

### Task 1: Add Faker to dev requirements

**Files:**
- Modify: `backend/requirements-dev.txt` (create if absent)

- [ ] **Step 1: Check if requirements-dev.txt exists**

```
ls backend/requirements*.txt
```

If `requirements-dev.txt` doesn't exist, create it. If it does, append to it.

- [ ] **Step 2: Add faker**

In `backend/requirements-dev.txt`:

```
faker>=24.0.0
```

- [ ] **Step 3: Install**

```
cd backend
pip install faker
```

- [ ] **Step 4: Commit**

```bash
git add requirements-dev.txt
git commit -m "chore: add faker to dev requirements for sanitize_db command"
```

---

### Task 2: Command skeleton + safety guards

**Files:**
- Create: `apps/admin_portal/management/__init__.py`
- Create: `apps/admin_portal/management/commands/__init__.py`
- Create: `apps/admin_portal/management/commands/sanitize_db.py`
- Create: `apps/admin_portal/tests_sanitizer.py`

- [ ] **Step 1: Write failing tests for safety guards**

Create `apps/admin_portal/tests_sanitizer.py`:

```python
from unittest.mock import patch
from django.test import TestCase, override_settings
from django.core.management import call_command
from io import StringIO


class SanitizeDbSafetyGuardTest(TestCase):

    @override_settings(DEBUG=False)
    def test_refuses_when_debug_false(self):
        with self.assertRaises(SystemExit):
            call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())

    @override_settings(DEBUG=True, DATABASES={
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': '/tmp/prod_docksbase.db',
        }
    })
    def test_refuses_when_db_name_contains_prod(self):
        with self.assertRaises(SystemExit):
            call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())

    @override_settings(DEBUG=True)
    def test_runs_when_safe(self):
        # Should not raise — no PII rows exist so nothing to sanitize
        out = StringIO()
        call_command('sanitize_db', stdout=out, stderr=StringIO())
        self.assertIn('Sanitized', out.getvalue())
```

- [ ] **Step 2: Run to verify FAIL**

```
python manage.py test apps.admin_portal.tests_sanitizer.SanitizeDbSafetyGuardTest --settings=config.settings.test
```

Expected: `CommandError: Unknown command 'sanitize_db'`

- [ ] **Step 3: Create management command directories and skeleton**

```
mkdir -p apps/admin_portal/management/commands
touch apps/admin_portal/management/__init__.py
touch apps/admin_portal/management/commands/__init__.py
```

Create `apps/admin_portal/management/commands/sanitize_db.py`:

```python
import sys
from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Anonymise PII in a restored production DB dump. Refuses to run in production.'

    def handle(self, *args, **options):
        self._check_safety()
        totals = {}
        totals['Users'] = self._sanitize_users()
        totals['Members'] = self._sanitize_members()
        totals['Marinas'] = self._sanitize_marinas()
        totals['Vessels'] = self._sanitize_vessels()

        summary = ', '.join(f'{v} {k}' for k, v in totals.items())
        self.stdout.write(self.style.SUCCESS(f'Sanitized {summary}'))

    def _check_safety(self):
        if not settings.DEBUG:
            self.stderr.write(self.style.ERROR('sanitize_db refuses to run with DEBUG=False.'))
            sys.exit(1)
        db_name = settings.DATABASES.get('default', {}).get('NAME', '')
        if 'prod' in str(db_name).lower():
            self.stderr.write(self.style.ERROR(f'sanitize_db refuses to run against DB: {db_name}'))
            sys.exit(1)

    def _sanitize_users(self):
        return 0

    def _sanitize_members(self):
        return 0

    def _sanitize_marinas(self):
        return 0

    def _sanitize_vessels(self):
        return 0
```

- [ ] **Step 4: Run tests to verify PASS**

```
python manage.py test apps.admin_portal.tests_sanitizer.SanitizeDbSafetyGuardTest --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/admin_portal/management/ apps/admin_portal/tests_sanitizer.py
git commit -m "feat(admin_portal): sanitize_db command skeleton with safety guards"
```

---

### Task 3: Sanitize Users

**Files:**
- Modify: `apps/admin_portal/management/commands/sanitize_db.py`

- [ ] **Step 1: Write failing test**

In `apps/admin_portal/tests_sanitizer.py`, add:

```python
from django.test import override_settings
from apps.accounts.models import User, Marina


class SanitizeUsersTest(TestCase):

    @override_settings(DEBUG=True)
    def test_user_pii_is_scrambled(self):
        marina = Marina.objects.create(name='Test Marina')
        u = User.objects.create_user(
            email='john.doe@realmail.com',
            first_name='John',
            last_name='Doe',
            password='realpassword',
            marina=marina,
        )
        call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())
        u.refresh_from_db()
        self.assertNotEqual(u.email, 'john.doe@realmail.com')
        self.assertNotEqual(u.first_name, 'John')
        self.assertNotEqual(u.last_name, 'Doe')
        self.assertFalse(u.has_usable_password())

    @override_settings(DEBUG=True)
    def test_platform_admin_is_also_sanitized(self):
        u = User.objects.create_user(
            email='admin@docksbase.com',
            is_platform_admin=True,
            password='secret',
        )
        call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())
        u.refresh_from_db()
        self.assertNotEqual(u.email, 'admin@docksbase.com')
        self.assertFalse(u.has_usable_password())
```

- [ ] **Step 2: Run to verify FAIL**

```
python manage.py test apps.admin_portal.tests_sanitizer.SanitizeUsersTest --settings=config.settings.test
```

Expected: Tests fail — `_sanitize_users` returns 0 and does nothing.

- [ ] **Step 3: Implement _sanitize_users**

Update `sanitize_db.py` — replace `_sanitize_users`:

```python
def _sanitize_users(self):
    from faker import Faker
    from apps.accounts.models import User

    fake = Faker('en_GB')
    qs = User.objects.all()
    total = 0
    batch_size = 500

    for offset in range(0, qs.count(), batch_size):
        batch = list(qs[offset:offset + batch_size])
        for u in batch:
            u.first_name = fake.first_name()
            u.last_name = fake.last_name()
            u.email = fake.unique.email()
            u.set_unusable_password()
        User.objects.bulk_update(batch, ['first_name', 'last_name', 'email', 'password'])
        total += len(batch)

    return total
```

- [ ] **Step 4: Run tests to verify PASS**

```
python manage.py test apps.admin_portal.tests_sanitizer.SanitizeUsersTest --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/admin_portal/management/commands/sanitize_db.py
git commit -m "feat(admin_portal): sanitize_db — anonymise User PII with Faker"
```

---

### Task 4: Sanitize Members

**Files:**
- Modify: `apps/admin_portal/management/commands/sanitize_db.py`

- [ ] **Step 1: Inspect Member model**

Run:

```
python manage.py shell --settings=config.settings.dev -c "from apps.members.models import Member; print([f.name for f in Member._meta.fields])"
```

Note the exact field names for: first name, last name, email, phone, address.

- [ ] **Step 2: Write failing test**

In `apps/admin_portal/tests_sanitizer.py`, add:

```python
from apps.members.models import Member


class SanitizeMembersTest(TestCase):

    @override_settings(DEBUG=True)
    def test_member_pii_is_scrambled(self):
        marina = Marina.objects.create(name='Test Marina 2')
        # Use the actual Member model fields from the shell output above
        # Common fields: first_name, last_name, email, phone, address
        m = Member.objects.create(
            marina=marina,
            first_name='Jane',
            last_name='Smith',
            email='jane.smith@real.com',
        )
        call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())
        m.refresh_from_db()
        self.assertNotEqual(m.email, 'jane.smith@real.com')
        self.assertNotEqual(m.first_name, 'Jane')
```

**Note:** If Member uses different field names (e.g., `full_name`), adjust the test and the implementation accordingly based on the shell output from Step 1.

- [ ] **Step 3: Implement _sanitize_members**

Replace `_sanitize_members` in `sanitize_db.py`:

```python
def _sanitize_members(self):
    from faker import Faker
    from apps.members.models import Member

    fake = Faker('en_GB')
    qs = Member.objects.all()
    total = 0
    batch_size = 500
    # Adjust field names if the shell output showed different names
    update_fields = []

    for offset in range(0, qs.count(), batch_size):
        batch = list(qs[offset:offset + batch_size])
        for m in batch:
            if hasattr(m, 'first_name'):
                m.first_name = fake.first_name()
                if 'first_name' not in update_fields:
                    update_fields.append('first_name')
            if hasattr(m, 'last_name'):
                m.last_name = fake.last_name()
                if 'last_name' not in update_fields:
                    update_fields.append('last_name')
            if hasattr(m, 'email'):
                m.email = fake.unique.email()
                if 'email' not in update_fields:
                    update_fields.append('email')
            if hasattr(m, 'phone'):
                m.phone = fake.phone_number()[:30]
                if 'phone' not in update_fields:
                    update_fields.append('phone')
            if hasattr(m, 'address'):
                m.address = fake.address().replace('\n', ', ')
                if 'address' not in update_fields:
                    update_fields.append('address')
        if update_fields:
            Member.objects.bulk_update(batch, update_fields)
        total += len(batch)

    return total
```

- [ ] **Step 4: Run tests to verify PASS**

```
python manage.py test apps.admin_portal.tests_sanitizer.SanitizeMembersTest --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/admin_portal/management/commands/sanitize_db.py
git commit -m "feat(admin_portal): sanitize_db — anonymise Member PII"
```

---

### Task 5: Sanitize Marinas and Vessels

**Files:**
- Modify: `apps/admin_portal/management/commands/sanitize_db.py`

- [ ] **Step 1: Write failing tests**

In `apps/admin_portal/tests_sanitizer.py`, add:

```python
class SanitizeMarinasAndVesselsTest(TestCase):

    @override_settings(DEBUG=True)
    def test_marina_contact_fields_scrambled_stripe_ids_nulled(self):
        from apps.accounts.models import Marina
        m = Marina.objects.create(
            name='Real Marina',
            contact_email='harbourmaster@real.com',
            phone='+44 1234 567890',
            stripe_account_id='acct_1AbcRealStripe',
            stripe_customer_id='cus_RealCustomer123',
            stripe_subscription_id='sub_RealSub456',
        )
        call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())
        m.refresh_from_db()
        self.assertNotEqual(m.contact_email, 'harbourmaster@real.com')
        self.assertIsNone(m.stripe_account_id or None)  # blank string or null both acceptable
        self.assertIsNone(m.stripe_customer_id or None)
        self.assertIsNone(m.stripe_subscription_id or None)

    @override_settings(DEBUG=True)
    def test_vessel_name_and_registration_scrambled(self):
        from apps.vessels.models import Vessel
        from apps.accounts.models import Marina
        marina = Marina.objects.create(name='Test Marina 3')
        v = Vessel.objects.create(
            marina=marina,
            name='Lady Elizabeth',
            registration_number='ABC-123-REAL',
        )
        call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())
        v.refresh_from_db()
        self.assertNotEqual(v.name, 'Lady Elizabeth')
        self.assertNotEqual(v.registration_number, 'ABC-123-REAL')
```

**Note:** Check the Vessel model with `python manage.py shell -c "from apps.vessels.models import Vessel; print([f.name for f in Vessel._meta.fields])"` if the test fails due to missing fields. Adjust field names accordingly.

- [ ] **Step 2: Run to verify FAIL**

```
python manage.py test apps.admin_portal.tests_sanitizer.SanitizeMarinasAndVesselsTest --settings=config.settings.test
```

Expected: Fails — `_sanitize_marinas` and `_sanitize_vessels` return 0.

- [ ] **Step 3: Implement both methods**

Replace `_sanitize_marinas` and `_sanitize_vessels` in `sanitize_db.py`:

```python
def _sanitize_marinas(self):
    from faker import Faker
    from apps.accounts.models import Marina

    fake = Faker('en_GB')
    qs = Marina.objects.all()
    total = 0
    batch_size = 500

    for offset in range(0, qs.count(), batch_size):
        batch = list(qs[offset:offset + batch_size])
        for m in batch:
            m.contact_email = fake.unique.company_email()
            m.phone = fake.phone_number()[:30]
            # Stripe IDs must be null — fake strings crash the Stripe API
            m.stripe_account_id = ''
            m.stripe_customer_id = None
            m.stripe_subscription_id = None
        Marina.objects.bulk_update(
            batch,
            ['contact_email', 'phone', 'stripe_account_id', 'stripe_customer_id', 'stripe_subscription_id'],
        )
        total += len(batch)

    return total


def _sanitize_vessels(self):
    from faker import Faker
    from apps.vessels.models import Vessel

    fake = Faker('en_GB')
    qs = Vessel.objects.all()
    total = 0
    batch_size = 500

    for offset in range(0, qs.count(), batch_size):
        batch = list(qs[offset:offset + batch_size])
        for v in batch:
            v.name = f'{fake.color_name()} {fake.last_name()}'
            v.registration_number = fake.bothify(text='??-###-??').upper()
        Vessel.objects.bulk_update(batch, ['name', 'registration_number'])
        total += len(batch)

    return total
```

- [ ] **Step 4: Run full sanitizer test suite**

```
python manage.py test apps.admin_portal.tests_sanitizer --settings=config.settings.test -v 2
```

Expected: All tests pass.

- [ ] **Step 5: Manual smoke test**

```
python manage.py sanitize_db --settings=config.settings.dev
```

Expected output (counts will vary):
```
Sanitized 5 Users, 42 Members, 3 Marinas, 12 Vessels
```

Confirm no Stripe IDs remain by running:

```
python manage.py shell --settings=config.settings.dev -c "
from apps.accounts.models import Marina
print(Marina.objects.exclude(stripe_customer_id__isnull=True).exclude(stripe_customer_id='').count())
"
```

Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add apps/admin_portal/management/commands/sanitize_db.py apps/admin_portal/tests_sanitizer.py
git commit -m "feat(admin_portal): sanitize_db — anonymise Marina contact fields, null Stripe IDs, scramble Vessel names"
```
