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
