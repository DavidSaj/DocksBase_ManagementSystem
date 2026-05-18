"""Tests for the serializer-level billing-state guards (TD4)."""
import pytest
from rest_framework.exceptions import ValidationError

from apps.accounts.billing_gates import (
    ACTION_CREATE_BOOKING,
    ACTION_CREATE_RESERVATION,
    ACTION_MUTATE_BOOKING,
    assert_marina_can,
)


class _FakeMarina:
    def __init__(self, **kwargs):
        self.billing_state = kwargs.get('billing_state', 'current')
        self.status = kwargs.get('status', 'active')
        self.manual_contract = kwargs.get('manual_contract', False)
        self.billing_admin_override_active = kwargs.get('billing_admin_override_active', False)


def test_healthy_marina_passes():
    marina = _FakeMarina(billing_state='current')
    assert_marina_can(marina, ACTION_CREATE_BOOKING)  # no raise


def test_grace_state_still_allows_booking_creation():
    marina = _FakeMarina(billing_state='grace')
    assert_marina_can(marina, ACTION_CREATE_BOOKING)


@pytest.mark.parametrize('state', ['restricted', 'suspended', 'cancelled'])
def test_blocked_states_reject_booking_creation(state):
    marina = _FakeMarina(billing_state=state)
    with pytest.raises(ValidationError) as exc:
        assert_marina_can(marina, ACTION_CREATE_BOOKING)
    payload = exc.value.detail
    assert 'new bookings cannot be created' in str(payload['detail'])
    assert payload['action'] == ACTION_CREATE_BOOKING


@pytest.mark.parametrize('state', ['restricted', 'suspended', 'cancelled'])
def test_blocked_states_use_action_specific_wording(state):
    marina = _FakeMarina(billing_state=state)
    with pytest.raises(ValidationError) as exc:
        assert_marina_can(marina, ACTION_CREATE_RESERVATION)
    assert 'new reservations cannot be created' in str(exc.value.detail['detail'])


def test_legacy_suspended_status_blocks():
    marina = _FakeMarina(billing_state='current', status='suspended')
    with pytest.raises(ValidationError):
        assert_marina_can(marina, ACTION_CREATE_BOOKING)


def test_manual_contract_bypasses():
    marina = _FakeMarina(billing_state='suspended', manual_contract=True)
    assert_marina_can(marina, ACTION_CREATE_BOOKING)  # no raise


def test_admin_override_bypasses():
    marina = _FakeMarina(billing_state='suspended', billing_admin_override_active=True)
    assert_marina_can(marina, ACTION_CREATE_BOOKING)  # no raise


def test_none_marina_is_silent():
    """Anonymous / non-marina users hit other guards — this helper shouldn't crash."""
    assert_marina_can(None, ACTION_CREATE_BOOKING)


def test_mutate_action_blocked_at_restricted():
    marina = _FakeMarina(billing_state='restricted')
    with pytest.raises(ValidationError) as exc:
        assert_marina_can(marina, ACTION_MUTATE_BOOKING)
    assert 'bookings cannot be modified' in str(exc.value.detail['detail'])
