from unittest.mock import patch
from django.test import TestCase, override_settings
from django.core.management import call_command
from io import StringIO

from apps.accounts.models import User, Marina
from apps.members.models import Member


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


class SanitizeMembersTest(TestCase):

    @override_settings(DEBUG=True)
    def test_member_pii_is_scrambled(self):
        marina = Marina.objects.create(name='Test Marina 2')
        m = Member.objects.create(
            marina=marina,
            name='Jane Smith',
            email='jane.smith@real.com',
        )
        call_command('sanitize_db', stdout=StringIO(), stderr=StringIO())
        m.refresh_from_db()
        self.assertNotEqual(m.email, 'jane.smith@real.com')
        self.assertNotEqual(m.name, 'Jane Smith')
