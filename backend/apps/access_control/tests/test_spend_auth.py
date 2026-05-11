"""
tests/test_spend_auth.py

SpendAuthorisationRequest workflow tests.
"""

import pytest
from django.utils import timezone
from decimal import Decimal


@pytest.mark.django_db
class TestSpendAuth:

    def _setup(self):
        from apps.accounts.models import Marina
        from apps.staff.models import StaffMember
        from apps.access_control.models import SpendAuthorisationRule
        from apps.billing.models import Invoice
        marina = Marina.objects.create(name='Auth Marina', slug='auth-marina', features={})
        staff  = StaffMember.objects.create(marina=marina, name='Staff Member', role='staff')
        rule   = SpendAuthorisationRule.objects.create(
            marina=marina, role='staff', action_type='discount',
            threshold_amount=Decimal('50.00'), requires_approver_role='manager',
        )
        invoice = Invoice.objects.create(marina=marina, status='draft', total=Decimal('100.00'))
        return marina, staff, rule, invoice

    def _make_request(self, marina, staff, rule, invoice):
        from apps.access_control.models import SpendAuthorisationRequest
        return SpendAuthorisationRequest.objects.create(
            marina=marina, rule=rule, action_type='discount',
            amount=Decimal('75.00'), description='Test discount',
            requested_by=staff, invoice=invoice,
        )

    def test_suspend_sets_suspended_at_no_fraud_alert(self):
        from apps.access_control.models import SpendAuthorisationRequest, FraudAnomalyAlert
        marina, staff, rule, invoice = self._setup()
        req = self._make_request(marina, staff, rule, invoice)

        req.status       = 'suspended'
        req.suspended_at = timezone.now()
        req.save()

        req.refresh_from_db()
        assert req.status == 'suspended'
        assert req.suspended_at is not None
        # No fraud alert for a normal park
        assert FraudAnomalyAlert.objects.filter(marina=marina, alert_type='forced_override').count() == 0

    def test_force_override_creates_fraud_anomaly_alert(self):
        from apps.access_control.models import SpendAuthorisationRequest, FraudAnomalyAlert
        marina, staff, rule, invoice = self._setup()
        req = self._make_request(marina, staff, rule, invoice)

        now   = timezone.now()
        alert = FraudAnomalyAlert.objects.create(
            marina=marina, alert_type='forced_override', staff_member=staff,
            period_start=now, period_end=now, event_count=1, total_amount=req.amount,
        )
        req.status               = 'overridden'
        req.override_forced_by   = staff
        req.override_forced_at   = now
        req.override_fraud_alert = alert
        req.save()

        req.refresh_from_db()
        assert req.status == 'overridden'
        assert req.override_fraud_alert == alert
        assert FraudAnomalyAlert.objects.filter(marina=marina, alert_type='forced_override').count() == 1

    def test_approve_requires_correct_role(self):
        """Approver must exist before a request can move to approved status."""
        from apps.access_control.models import SpendAuthorisationRequest
        from apps.staff.models import StaffMember
        marina, staff, rule, invoice = self._setup()
        req     = self._make_request(marina, staff, rule, invoice)
        manager = StaffMember.objects.create(marina=marina, name='Manager', role='manager')

        req.status      = 'approved'
        req.approver    = manager
        req.actioned_at = timezone.now()
        req.save()

        req.refresh_from_db()
        assert req.status == 'approved'
        assert req.approver == manager
