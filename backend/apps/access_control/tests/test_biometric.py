"""
tests/test_biometric.py

GDPR Art. 17 biometric deletion flow tests.
"""

import pytest
from unittest.mock import patch
from django.utils import timezone


@pytest.mark.django_db
class TestBiometricDeletion:

    def _setup(self):
        from apps.accounts.models import Marina
        from apps.members.models import Member
        marina = Marina.objects.create(name='Bio Marina', slug='bio-marina', features={'biometric_enabled': True})
        member = Member.objects.create(marina=marina, name='Bob', member_type='seasonal')
        return marina, member

    def _make_enrolment(self, marina, member):
        from apps.access_control.models import BiometricEnrolment
        return BiometricEnrolment.all_objects.create(
            marina=marina, subject_type='member', member=member,
            terminal_uid='TERM01', template_handle='enc_handle_xyz',
            consent_given_at=timezone.now(), consent_method='portal',
        )

    def test_delete_sets_pending_deletion_immediately(self):
        marina, member = self._setup()
        enrolment = self._make_enrolment(marina, member)
        now = timezone.now()
        enrolment.pending_deletion       = True
        enrolment.pending_deletion_since = now
        enrolment.save()

        enrolment.refresh_from_db()
        assert enrolment.pending_deletion is True
        assert enrolment.pending_deletion_since is not None

    def test_pending_deletion_hidden_from_default_manager(self):
        from apps.access_control.models import BiometricEnrolment
        marina, member = self._setup()
        enrolment = self._make_enrolment(marina, member)
        enrolment.pending_deletion = True
        enrolment.pending_deletion_since = timezone.now()
        enrolment.save()

        # Default manager should NOT return this row
        assert BiometricEnrolment.objects.filter(pk=enrolment.pk).count() == 0
        # all_objects manager SHOULD return it
        assert BiometricEnrolment.all_objects.filter(pk=enrolment.pk).count() == 1

    def test_revoke_task_hard_deletes_on_success(self):
        from apps.access_control.models import BiometricEnrolment
        from apps.access_control.tasks import revoke_biometric_enrolment
        marina, member = self._setup()
        enrolment = self._make_enrolment(marina, member)
        enrolment.pending_deletion = True
        enrolment.pending_deletion_since = timezone.now()
        enrolment.save()

        with patch('apps.access_control.hal.adapters.demo.DemoBiometricAdapter.revoke_face', return_value=True):
            revoke_biometric_enrolment(enrolment_pk=enrolment.pk)

        # Hard-deleted
        assert BiometricEnrolment.all_objects.filter(pk=enrolment.pk).count() == 0

    def test_revoke_task_creates_stall_alert_after_24h(self):
        from apps.access_control.models import BiometricEnrolment, FraudAnomalyAlert
        from apps.access_control.tasks import revoke_biometric_enrolment
        from datetime import timedelta
        marina, member = self._setup()
        enrolment = self._make_enrolment(marina, member)
        enrolment.pending_deletion       = True
        # Set pending_deletion_since to >24 hours ago
        enrolment.pending_deletion_since = timezone.now() - timedelta(hours=25)
        enrolment.save()

        with patch('apps.access_control.hal.adapters.demo.DemoBiometricAdapter.revoke_face', return_value=False):
            with pytest.raises(RuntimeError):
                revoke_biometric_enrolment(enrolment_pk=enrolment.pk)

        assert FraudAnomalyAlert.objects.filter(
            marina=marina, alert_type='biometric_deletion_stalled'
        ).exists()
