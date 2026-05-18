"""Serializer-level billing-state gates.

Companion to :class:`apps.accounts.middleware.BillingGateMiddleware`. The
middleware is defence-in-depth and returns a generic 402; these serializer
guards fire BEFORE the middleware blocks and produce action-specific
``ValidationError`` messages so the UI can show a useful banner instead of
a raw "402 Payment Required".

Usage in a serializer::

    def validate(self, data):
        marina = self.context['request'].user.marina
        assert_marina_can(marina, ACTION_CREATE_BOOKING)
        return data

The check is a no-op for marinas with no billing-state restriction; it only
raises when the marina is in ``restricted`` / ``suspended`` / ``cancelled``.
"""
from rest_framework import serializers

# Action constants. New ones may be added; each maps to the same predicate
# (no per-action divergence yet) but carries its own human-readable message.
ACTION_CREATE_BOOKING       = 'create_booking'
ACTION_CREATE_RESERVATION   = 'create_reservation'
ACTION_MUTATE_BOOKING       = 'mutate_booking'

_BLOCKED_STATES_MUTATION = {'restricted', 'suspended', 'cancelled'}
_BLOCKED_STATES_FULL     = {'suspended', 'cancelled'}

# Per-action message templates. {state} is interpolated with the marina's
# current billing_state.
_MESSAGES = {
    ACTION_CREATE_BOOKING: (
        "This marina's subscription is {state} — new bookings cannot be created. "
        "Update billing in Settings → Subscription to re-enable booking creation."
    ),
    ACTION_CREATE_RESERVATION: (
        "This marina's subscription is {state} — new reservations cannot be created. "
        "Update billing in Settings → Subscription."
    ),
    ACTION_MUTATE_BOOKING: (
        "This marina's subscription is {state} — bookings cannot be modified. "
        "Update billing in Settings → Subscription."
    ),
}


def _marina_is_blocked(marina, action):
    """Return the blocking state name, or None if the action is allowed."""
    if marina is None:
        return None
    # Manual contract bypass — matches middleware behaviour.
    if getattr(marina, 'manual_contract', False):
        return None
    # Admin override bypass.
    if getattr(marina, 'billing_admin_override_active', False):
        return None

    state = getattr(marina, 'billing_state', 'current') or 'current'
    legacy_suspended = (getattr(marina, 'status', '') == 'suspended')

    if state in _BLOCKED_STATES_FULL or legacy_suspended:
        return state if state in _BLOCKED_STATES_FULL else 'suspended'
    if state in _BLOCKED_STATES_MUTATION and action in _MESSAGES:
        return state
    return None


def assert_marina_can(marina, action):
    """Raise ``serializers.ValidationError`` if ``action`` is gated for this marina.

    Silent for healthy marinas, raises a user-readable error for blocked
    states. The action key controls the error wording — see ``_MESSAGES``.
    """
    blocked_state = _marina_is_blocked(marina, action)
    if blocked_state is None:
        return
    template = _MESSAGES.get(action, _MESSAGES[ACTION_MUTATE_BOOKING])
    raise serializers.ValidationError({
        'detail': template.format(state=blocked_state),
        'billing_state': blocked_state,
        'action': action,
    })
