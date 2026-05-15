"""
Tests for Settings → Data tab (marina data export).

Covers:
  - DataExport model creation
  - generate_data_export task end-to-end (writes a zip with expected CSVs)
  - Per-section error isolation (one broken section doesn't fail the job)
  - API: list, create, conflict, daily cap, download, expired
"""

import io
import zipfile
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User, DataExport


def _auth_client(user):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


class DataExportModelTest(TestCase):
    def test_defaults(self):
        marina = Marina.objects.create(name='M')
        export = DataExport.objects.create(marina=marina)
        self.assertEqual(export.status, DataExport.Status.PENDING)
        self.assertEqual(export.entity_counts, {})
        self.assertIsNone(export.size_bytes)
        self.assertIsNone(export.ready_at)


class GenerateDataExportTaskTest(TestCase):
    """End-to-end run of the export task against a minimal marina."""

    def _seed(self):
        from apps.members.models import Member
        from apps.vessels.models import Vessel
        from apps.berths.models import Berth
        from apps.reservations.models import Reservation
        from apps.billing.models import Invoice
        marina = Marina.objects.create(name='Seed Marina', slug='seed')
        member = Member.objects.create(marina=marina, name='Alice', email='a@x.com')
        Vessel.objects.create(marina=marina, name='Sea Otter', owner=member)
        Berth.objects.create(marina=marina, code='A1', side='port', length_m=10)
        Reservation.objects.create(marina=marina, member=member,
                                   status='confirmed', total_price=Decimal('100.00'))
        # status='draft' avoids the GL-posting signal that needs a chart of accounts.
        Invoice.objects.create(marina=marina, invoice_number='INV-1', member=member,
                               status='draft', subtotal=Decimal('100.00'),
                               tax_total=Decimal('20.00'), total=Decimal('120.00'))
        return marina

    def test_task_produces_zip_with_expected_csvs(self):
        from apps.accounts.data_export import generate_data_export
        from django.core.files.storage import default_storage

        marina = self._seed()
        export = DataExport.objects.create(marina=marina, status='pending')
        generate_data_export(export.pk)
        export.refresh_from_db()

        self.assertEqual(export.status, DataExport.Status.READY)
        self.assertGreater(export.size_bytes, 0)
        self.assertEqual(export.error_message, '')
        self.assertEqual(export.entity_counts['members.csv'], 1)
        self.assertEqual(export.entity_counts['vessels.csv'], 1)
        self.assertEqual(export.entity_counts['berths.csv'], 1)
        self.assertEqual(export.entity_counts['reservations.csv'], 1)
        self.assertEqual(export.entity_counts['invoices.csv'], 1)
        self.assertEqual(export.entity_counts['payments.csv'], 0)
        self.assertIsNotNone(export.expires_at)
        self.assertIsNotNone(export.ready_at)

        # Verify zip contents.
        with default_storage.open(export.file_path, 'rb') as f:
            data = f.read()
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = set(zf.namelist())
        self.assertIn('README.txt', names)
        for csv in ['members.csv', 'vessels.csv', 'berths.csv',
                    'reservations.csv', 'invoices.csv', 'payments.csv']:
            self.assertIn(csv, names)
        # Members CSV has Alice
        members_csv = zf.read('members.csv').decode()
        self.assertIn('Alice', members_csv)
        self.assertIn('a@x.com', members_csv)
        # No errors.txt when all sections succeed
        self.assertNotIn('errors.txt', names)

    def test_one_failing_section_does_not_break_zip(self):
        """If one entity raises, the others still export and errors.txt records the failure."""
        from apps.accounts import data_export
        from django.core.files.storage import default_storage

        marina = self._seed()
        export = DataExport.objects.create(marina=marina, status='pending')

        def _boom(_marina):
            raise RuntimeError('synthetic vessel failure')

        # SECTIONS is a list of function references; patching the module attribute
        # _vessels alone wouldn't affect the list. Swap inside the list and
        # always restore (try/finally) so test order can't matter.
        original = list(data_export.SECTIONS)
        data_export.SECTIONS = [data_export._members, _boom, data_export._berths]
        try:
            data_export.generate_data_export(export.pk)
        finally:
            data_export.SECTIONS = original

        export.refresh_from_db()
        self.assertEqual(export.status, DataExport.Status.READY)
        self.assertIn('synthetic vessel failure', export.error_message)
        # The other sections still ran.
        self.assertEqual(export.entity_counts['members.csv'], 1)
        self.assertEqual(export.entity_counts['berths.csv'], 1)
        self.assertNotIn('vessels.csv', export.entity_counts)

        with default_storage.open(export.file_path, 'rb') as f:
            zf = zipfile.ZipFile(io.BytesIO(f.read()))
        self.assertIn('errors.txt', zf.namelist())
        self.assertIn('synthetic vessel failure', zf.read('errors.txt').decode())


class DataExportAPITest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='API M', slug='api-m')
        self.user = User.objects.create_user(
            email='owner@m.com', password='x', marina=self.marina,
        )
        self.client = _auth_client(self.user)

    def test_list_initially_empty(self):
        r = self.client.get('/api/v1/marina/exports/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['results'], [])

    def test_create_runs_inline_when_no_broker(self):
        r = self.client.post('/api/v1/marina/exports/', {}, format='json')
        self.assertEqual(r.status_code, 201)
        body = r.json()
        # Inline fallback in the view kicks in because Celery broker
        # isn't running in the test env — status flips to 'ready'.
        self.assertEqual(body['status'], 'ready')
        self.assertTrue(body['downloadable'])
        self.assertGreater(body['size_bytes'], 0)

    def test_duplicate_pending_returns_409(self):
        # Force a stuck-pending row to block the next request.
        DataExport.objects.create(marina=self.marina, requested_by=self.user,
                                  status='pending')
        r = self.client.post('/api/v1/marina/exports/', {}, format='json')
        self.assertEqual(r.status_code, 409)

    def test_daily_cap_returns_429(self):
        for _ in range(10):
            DataExport.objects.create(marina=self.marina, requested_by=self.user,
                                      status='ready', file_path='x',
                                      ready_at=timezone.now())
        r = self.client.post('/api/v1/marina/exports/', {}, format='json')
        self.assertEqual(r.status_code, 429)

    def test_download_redirects_to_signed_url(self):
        r = self.client.post('/api/v1/marina/exports/', {}, format='json')
        exp_id = r.json()['id']
        r = self.client.get(f'/api/v1/marina/exports/{exp_id}/download/')
        self.assertEqual(r.status_code, 302)
        # In dev/test, default_storage is FS-backed and returns a /media/... URL.
        self.assertIn('exports/', r['Location'])

    def test_download_when_not_ready_returns_404(self):
        e = DataExport.objects.create(marina=self.marina, requested_by=self.user,
                                      status='running')
        r = self.client.get(f'/api/v1/marina/exports/{e.pk}/download/')
        self.assertEqual(r.status_code, 404)

    def test_download_when_expired_returns_410(self):
        # Need a real file on disk for the storage call later, but the expiry
        # check happens first, so a stub path is fine.
        e = DataExport.objects.create(
            marina=self.marina, requested_by=self.user,
            status='ready', file_path='exports/test/expired.zip',
            ready_at=timezone.now() - timedelta(days=10),
            expires_at=timezone.now() - timedelta(days=3),
        )
        r = self.client.get(f'/api/v1/marina/exports/{e.pk}/download/')
        self.assertEqual(r.status_code, 410)

    def test_marina_scoping(self):
        """Another marina's export must 404, never leak."""
        other = Marina.objects.create(name='Other')
        other_user = User.objects.create_user(
            email='other@m.com', password='x', marina=other,
        )
        their_export = DataExport.objects.create(marina=other, requested_by=other_user,
                                                 status='ready', file_path='x')
        r = self.client.get(f'/api/v1/marina/exports/{their_export.pk}/download/')
        self.assertEqual(r.status_code, 404)
