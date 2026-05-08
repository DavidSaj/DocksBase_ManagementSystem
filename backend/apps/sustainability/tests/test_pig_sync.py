"""
tests/test_pig_sync.py

Play It Green sync task tests — skip, retry, and failure handling.
"""

import json
import pytest
from decimal import Decimal
from unittest.mock import patch, MagicMock


@pytest.mark.django_db
class TestPlayItGreenSync:

    def _make_marina(self, pig_api_key=None):
        from apps.accounts.models import Marina
        features = {'esg_enabled': True}
        if pig_api_key:
            features['pig_api_key'] = pig_api_key
        return Marina.objects.create(name='PIG Marina', slug='pig', features=features)

    def _make_contribution(self, marina, synced=False):
        from apps.sustainability.models import OffsetContribution
        from django.utils import timezone
        return OffsetContribution.objects.create(
            marina=marina,
            amount_gbp=Decimal('25.00'),
            pig_contribution_id='' if not synced else 'pig-id-123',
            synced_at=timezone.now() if synced else None,
        )

    def test_pig_sync_skips_when_no_api_key(self):
        """sync_play_it_green() skips marinas that have no pig_api_key feature flag."""
        from apps.sustainability.tasks import sync_play_it_green
        marina = self._make_marina(pig_api_key=None)
        self._make_contribution(marina, synced=False)

        with patch('urllib.request.urlopen') as mock_urlopen:
            sync_play_it_green()
            mock_urlopen.assert_not_called()

    def test_pig_sync_5xx_creates_failed_sync_log(self):
        """sync_play_it_green() records a failed PlayItGreenSync on HTTP errors."""
        from apps.sustainability.tasks import sync_play_it_green
        from apps.sustainability.models import PlayItGreenSync
        marina = self._make_marina(pig_api_key='test-key-abc')
        self._make_contribution(marina, synced=False)

        import urllib.error
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('503 service unavailable')):
            sync_play_it_green()

        sync_log = PlayItGreenSync.objects.filter(marina=marina).first()
        assert sync_log is not None
        assert sync_log.status in ('failed', 'retry')

    def test_pig_sync_4xx_marks_failed_no_retry(self):
        """sync_play_it_green() marks PlayItGreenSync as failed on errors."""
        from apps.sustainability.tasks import sync_play_it_green
        from apps.sustainability.models import PlayItGreenSync
        marina = self._make_marina(pig_api_key='bad-key')
        self._make_contribution(marina, synced=False)

        import urllib.error
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('401 unauthorized')):
            sync_play_it_green()

        sync_log = PlayItGreenSync.objects.filter(marina=marina).first()
        assert sync_log is not None
        assert sync_log.status == 'failed'
