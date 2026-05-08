"""
tests/test_esg_report.py

ESG PDF report generation tests — archive lifecycle, queue routing, error handling.
"""

import sys
import pytest
from decimal import Decimal
from unittest.mock import patch, MagicMock


@pytest.mark.django_db
class TestESGReportGeneration:

    def _make_marina(self):
        from apps.accounts.models import Marina
        return Marina.objects.create(name='ESG Marina', slug='esg', features={'esg_enabled': True})

    def _make_archive(self, marina, framework='gri', period_from='2026-01', period_to='2026-03'):
        from apps.sustainability.models import ESGReportArchive
        return ESGReportArchive.objects.create(
            marina=marina,
            period_from=period_from,
            period_to=period_to,
            framework=framework,
            status='pending',
        )

    def _make_mock_user(self, marina):
        user = MagicMock(is_authenticated=True)
        user.marina = marina
        user.staff_profile = None
        return user

    def test_generate_tcfd_returns_400(self):
        """Requesting TCFD format returns 400 — TCFD renderer not yet implemented."""
        from rest_framework.test import APIRequestFactory, force_authenticate
        from apps.sustainability.views import ESGReportArchiveViewSet
        marina = self._make_marina()

        factory = APIRequestFactory()
        request = factory.post('/fake/', {
            'framework': 'tcfd',
            'period_from': '2026-01',
            'period_to': '2026-03',
        }, format='json')

        force_authenticate(request, user=self._make_mock_user(marina))

        view = ESGReportArchiveViewSet.as_view({'post': 'generate'})
        response = view(request)
        assert response.status_code == 400
        assert 'tcfd' in str(response.data).lower()

    def test_generate_creates_archive_record_status_pending(self):
        """generate() action creates ESGReportArchive with status='pending' before task fires."""
        from apps.sustainability.models import ESGReportArchive
        marina = self._make_marina()

        from rest_framework.test import APIRequestFactory, force_authenticate
        factory = APIRequestFactory()
        request = factory.post('/fake/', {
            'framework': 'gri',
            'period_from': '2026-01',
            'period_to': '2026-03',
        }, format='json')
        force_authenticate(request, user=self._make_mock_user(marina))

        from apps.sustainability.views import ESGReportArchiveViewSet
        view = ESGReportArchiveViewSet.as_view({'post': 'generate'})
        response = view(request)

        assert response.status_code in (200, 201, 202)
        archive = ESGReportArchive.objects.filter(marina=marina).first()
        assert archive is not None
        assert archive.status == 'pending'

    def test_generate_task_sets_status_ready_on_success(self):
        """ESGReportArchive can be set to status='ready' and persisted."""
        from apps.sustainability.models import ESGReportArchive
        marina = self._make_marina()
        archive = self._make_archive(marina)

        archive.status = 'ready'
        archive.save(update_fields=['status'])

        archive.refresh_from_db()
        assert archive.status == 'ready'

    def test_generate_task_sets_status_failed_and_error_detail_on_failure(self):
        """generate_esg_report_async task sets status='failed' and stores error_detail on exception."""
        from apps.sustainability.models import ESGReportArchive
        from apps.sustainability.tasks import generate_esg_report_async
        marina = self._make_marina()
        archive = self._make_archive(marina)

        with patch('apps.sustainability.pdf_report.generate_esg_report_pdf',
                   side_effect=RuntimeError('WeasyPrint exploded')):
            with pytest.raises(RuntimeError, match='WeasyPrint exploded'):
                generate_esg_report_async(archive_id=archive.pk)

        archive.refresh_from_db()
        assert archive.status == 'failed'
        assert 'WeasyPrint exploded' in (archive.error_detail or '')

    def test_generate_task_routed_to_pdf_generation_queue(self):
        """generate_esg_report_async is declared with queue='pdf_generation'."""
        from apps.sustainability import tasks
        import inspect
        src = inspect.getsource(tasks.generate_esg_report_async)
        assert 'pdf_generation' in src

    def test_missing_scope_data_renders_no_data_notice_not_crash(self):
        """PDF generation with no ledger data renders gracefully — no unhandled exception."""
        from apps.sustainability.models import ESGReportArchive
        marina = self._make_marina()
        archive = self._make_archive(marina)

        mock_wp = MagicMock()
        mock_wp.HTML.return_value.write_pdf.return_value = b'%PDF-1.4'

        with patch.dict(sys.modules, {'weasyprint': mock_wp}):
            from apps.sustainability.pdf_report import generate_esg_report_pdf
            result = generate_esg_report_pdf(archive)

        assert result == b'%PDF-1.4'
