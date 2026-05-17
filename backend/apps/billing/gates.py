"""
Platform billing-gate engine.

This module is the authoritative state-machine for `Marina.billing_state` and
the helper layer used by:

  - Stripe webhook handlers (apps/billing/views.py)
  - BillingGateMiddleware (apps/accounts/middleware.py)
  - Admin manual-contract / override views (apps/admin_portal/views.py)
  - The hourly Celery beat task `billing.advance_billing_states`
  - Per-mutation serializer guards (BookingSerializer.validate, etc.)

Trap-prevention contract:
  TRAP 1 — Out-of-order webhook race: callers pass the Stripe object's
           CURRENT `status` (read from event payload) as ground truth. We do
           NOT transition blindly on event type. See `apply_subscription_truth`.
  TRAP 2 — Zombie Stripe subscription on manual-contract flag: see
           `set_manual_contract` which atomically cancels the live Stripe sub
           at period end inside the same DB transaction.
  TRAP 3 — Never block inbound boater payments: `assert_marina_can(... ,
           ACTION_BOATER_INVOICE_PAY)` and ACTION_SUBSCRIPTION_SELF_SERVICE
           ALWAYS return without raising (even at `cancelled`). The
           BillingGateMiddleware excludes these endpoints from blocking too.

Spec ref: docs/superpowers/specs/2026-05-17-billing-gates-design.md
"""
from __future__ import annotations

import datetime as _dt
import logging
from functools import wraps
from typing import Optional

from django.db import transaction
from django.utils import timezone

from config import billing_gates as _cfg
from config.billing_gates import (
    STATE_CURRENT, STATE_PAST_DUE, STATE_GRACE, STATE_RESTRICTED,
    STATE_SUSPENDED, STATE_CANCELLED, STATE_MANUAL,
    ACTION_NEW_BOOKING, ACTION_BROADCAST, ACTION_EDIT_PRICING,
    ACTION_INVITE_STAFF, ACTION_CHECK_IN_OUT, ACTION_LOGIN,
    ACTION_BOATER_INVOICE_PAY, ACTION_SUBSCRIPTION_SELF_SERVICE,
)

logger = logging.getLogger(__name__)


class BillingBlocked(Exception):
    """Raised by assert_marina_can when an action is blocked by billing_state."""
    def __init__(self, marina, action, state):
        self.marina = marina
        self.action = action
        self.state = state
        super().__init__(f'marina={marina.id} action={action} state={state}')


# ── Blocking matrix ──────────────────────────────────────────────────────────
# Each entry maps an action to the set of billing_states in which it is BLOCKED.
#
# TRAP 3 (boater payments / subscription self-service) — those actions are
# ALWAYS allowed and are deliberately absent from this matrix.

_BLOCKED_BY_STATE = {
    ACTION_NEW_BOOKING:  {STATE_RESTRICTED, STATE_SUSPENDED, STATE_CANCELLED},
    ACTION_BROADCAST:    {STATE_GRACE, STATE_RESTRICTED, STATE_SUSPENDED, STATE_CANCELLED},
    ACTION_EDIT_PRICING: {STATE_RESTRICTED, STATE_SUSPENDED, STATE_CANCELLED},
    ACTION_INVITE_STAFF: {STATE_GRACE, STATE_RESTRICTED, STATE_SUSPENDED, STATE_CANCELLED},
    ACTION_CHECK_IN_OUT: {STATE_CANCELLED},
    ACTION_LOGIN:        {STATE_SUSPENDED, STATE_CANCELLED},
}


def _resolve_effective_state(marina):
    """Return the state to use for enforcement decisions, after applying bypasses.

    Bypasses (in order):
      1. Manual contract — always treated as `current`.
      2. Active admin override — always treated as `current`.

    Otherwise the persisted `billing_state` is returned.

    Backwards-compat: the middleware ALSO honours legacy `marina.status=='suspended'`,
    that decision is layered on at the call site, not here, so the audit /
    state-machine views stay readable.
    """
    if marina.manual_contract:
        return STATE_CURRENT
    if marina.billing_admin_override_active:
        return STATE_CURRENT
    return marina.billing_state or STATE_CURRENT


def assert_marina_can(marina, action):
    """Raise BillingBlocked if `action` is not permitted for marina's current state.

    Trap 3: ACTION_BOATER_INVOICE_PAY and ACTION_SUBSCRIPTION_SELF_SERVICE are
    NEVER blocked, regardless of state. This is the single chokepoint that
    keeps boater Stripe Connect flows alive even when the marina is in
    `cancelled`.
    """
    if action in (ACTION_BOATER_INVOICE_PAY, ACTION_SUBSCRIPTION_SELF_SERVICE):
        return  # Always allowed — see TRAP 3 contract above.

    state = _resolve_effective_state(marina)
    blocked = _BLOCKED_BY_STATE.get(action, set())
    if state in blocked:
        raise BillingBlocked(marina, action, state)


def can_marina(marina, action) -> bool:
    """Boolean form of assert_marina_can — convenience for serializer validate()."""
    try:
        assert_marina_can(marina, action)
        return True
    except BillingBlocked:
        return False


# ── State transitions ────────────────────────────────────────────────────────

@transaction.atomic
def _transition(marina, to_state, *, reason, stripe_event_id='', actor=None, detail=None):
    """Persist a state transition + write an immutable BillingStateChange row.

    Idempotent at the row level: if the target state matches current state and
    no significant detail differs, we still write the audit row but don't bump
    `billing_state_since` (to avoid resetting timers). Callers that want a
    no-op short-circuit should compare first.
    """
    # Local import to avoid circulars at app-load time.
    from apps.admin_portal.models import BillingStateChange

    from_state = marina.billing_state or STATE_CURRENT
    now = timezone.now()
    detail = dict(detail or {})

    fields = []
    if from_state != to_state:
        marina.billing_state = to_state
        marina.billing_state_since = now
        fields += ['billing_state', 'billing_state_since']

    # State-specific bookkeeping
    if to_state == STATE_CURRENT:
        marina.billing_failure_count = 0
        marina.billing_grace_until = None
        marina.billing_last_failure_at = None
        marina.billing_last_email_at = None
        fields += ['billing_failure_count', 'billing_grace_until',
                   'billing_last_failure_at', 'billing_last_email_at']

    if fields:
        # Deduplicate the field list
        marina.save(update_fields=list(dict.fromkeys(fields)))

    BillingStateChange.objects.create(
        marina=marina,
        from_state=from_state,
        to_state=to_state,
        reason=reason,
        stripe_event_id=stripe_event_id or '',
        actor_user=actor,
        detail=detail,
    )
    return marina


def _stripe_status_to_state(stripe_status: str) -> Optional[str]:
    """Map a Stripe subscription `status` value to our billing_state."""
    if stripe_status in ('active', 'trialing'):
        return STATE_CURRENT
    if stripe_status in ('past_due', 'unpaid'):
        # We can't tell from status alone whether retries are exhausted; default
        # to past_due. The hourly task or a later subscription.updated event
        # will advance us to `grace`/`restricted` once Stripe gives up retrying.
        return STATE_PAST_DUE
    if stripe_status in ('incomplete', 'incomplete_expired'):
        return STATE_PAST_DUE
    if stripe_status == 'canceled':
        return STATE_CANCELLED
    return None  # Unknown — leave state untouched.


# ── Webhook entry points (TRAP 1 ground-truth handlers) ─────────────────────

def apply_subscription_truth(marina, stripe_subscription_obj, *, stripe_event_id=''):
    """Reconcile billing_state from a Stripe subscription object's CURRENT status.

    TRAP 1 — Out-of-order webhook fix.
    Stripe does NOT guarantee chronological webhook delivery. Two events for
    the same subscription (e.g. payment_failed + invoice.paid moments later)
    may arrive in either order. We refuse to transition based on the event
    *type*; we transition based on the subscription's `status` field as
    embedded in the event payload — that field IS the latest ground truth at
    the time Stripe assembled the event.

    Manual-contract marinas are no-ops (Feature B.4).
    """
    if marina.manual_contract:
        return marina

    status = (stripe_subscription_obj or {}).get('status') or ''
    target = _stripe_status_to_state(status)
    if target is None:
        return marina

    if marina.billing_state == target:
        return marina  # No-op, already correct.

    # Race-condition guard: do NOT regress from `current` back to `past_due`
    # if a stale failed-payment event arrives after a successful payment. We
    # detect this by comparing the embedded event timestamp (if available).
    if marina.billing_state == STATE_CURRENT and target == STATE_PAST_DUE:
        # Compare event-payload's current_period_start / latest_invoice if
        # available. If the local state was set later than this event's
        # information, we discard.
        latest_invoice_paid = (stripe_subscription_obj or {}).get('latest_invoice')
        # Heuristic: trust local `current` when set since billing_state_since
        # is after Stripe's "current_period_start" reported here.
        period_start_ts = (stripe_subscription_obj or {}).get('current_period_start')
        if (
            period_start_ts
            and marina.billing_state_since
            and marina.billing_state_since.timestamp() >= period_start_ts
        ):
            logger.info(
                'Discarding stale Stripe past_due event for marina=%s '
                '(local current set after event period_start)', marina.id,
            )
            return marina

    return _transition(
        marina, target,
        reason=f'stripe.subscription.status={status}',
        stripe_event_id=stripe_event_id,
        detail={'stripe_status': status},
    )


def apply_invoice_paid(marina, stripe_invoice_obj, *, stripe_event_id=''):
    """Handle invoice.paid for the platform subscription.

    Only transitions if the invoice's `status` is `paid` (ground truth).
    """
    if marina.manual_contract:
        return marina
    status = (stripe_invoice_obj or {}).get('status') or ''
    if status != 'paid':
        return marina
    if marina.billing_state == STATE_CURRENT:
        return marina
    return _transition(
        marina, STATE_CURRENT,
        reason='stripe.invoice.paid',
        stripe_event_id=stripe_event_id,
        detail={'invoice_id': (stripe_invoice_obj or {}).get('id')},
    )


def record_failure(marina, stripe_invoice_obj, *, stripe_event_id=''):
    """Handle invoice.payment_failed.

    TRAP 1: We still inspect the invoice's CURRENT status. If Stripe says
    `paid` (race — payment_failed delivered late, after retry succeeded), we
    do NOT regress to past_due.
    """
    if marina.manual_contract:
        return marina

    status = (stripe_invoice_obj or {}).get('status') or ''
    if status == 'paid':
        logger.info(
            'Ignoring stale invoice.payment_failed for marina=%s — '
            'invoice.status==paid in event payload (TRAP 1 protection)',
            marina.id,
        )
        return marina

    now = timezone.now()
    marina.billing_failure_count = (marina.billing_failure_count or 0) + 1
    marina.billing_last_failure_at = now
    marina.save(update_fields=['billing_failure_count', 'billing_last_failure_at'])

    if marina.billing_state in (STATE_CURRENT,):
        return _transition(
            marina, STATE_PAST_DUE,
            reason='stripe.invoice.payment_failed',
            stripe_event_id=stripe_event_id,
            detail={'invoice_id': (stripe_invoice_obj or {}).get('id'),
                    'attempt': marina.billing_failure_count},
        )
    return marina


def apply_subscription_deleted(marina, stripe_subscription_obj, *, stripe_event_id=''):
    """Handle customer.subscription.deleted → cancelled."""
    if marina.manual_contract:
        return marina
    return _transition(
        marina, STATE_CANCELLED,
        reason='stripe.subscription.deleted',
        stripe_event_id=stripe_event_id,
        detail={'subscription_id': (stripe_subscription_obj or {}).get('id')},
    )


# ── Email cadence ────────────────────────────────────────────────────────────

def _send_dunning_email(marina, kind):
    """Send a dunning email to all active owners. Best-effort, errors logged."""
    from apps.accounts.emails import send_payment_failed_email
    try:
        owners = list(marina.users.filter(role='owner', is_active=True))
        for owner in owners:
            try:
                send_payment_failed_email(owner)
            except Exception:
                logger.exception('Failed to send dunning email kind=%s marina=%s', kind, marina.id)
    except Exception:
        logger.exception('dunning email outer failure')


def maybe_send_past_due_email(marina):
    """Email cadence: day 1, 3, 7 of past_due (locked decision A.4)."""
    if marina.billing_state != STATE_PAST_DUE or not marina.billing_state_since:
        return
    now = timezone.now()
    days_in = (now - marina.billing_state_since).days
    if days_in not in _cfg.PAST_DUE_EMAIL_DAYS:
        return
    # De-dup: don't re-send within last 18 hours.
    if marina.billing_last_email_at and (now - marina.billing_last_email_at).total_seconds() < 18 * 3600:
        return
    _send_dunning_email(marina, kind=f'past_due_day_{days_in}')
    marina.billing_last_email_at = now
    marina.save(update_fields=['billing_last_email_at'])


def maybe_send_grace_email(marina):
    """During `grace`, send every GRACE_EMAIL_INTERVAL_HOURS hours."""
    if marina.billing_state != STATE_GRACE:
        return
    now = timezone.now()
    last = marina.billing_last_email_at
    if last and (now - last).total_seconds() < _cfg.GRACE_EMAIL_INTERVAL_HOURS * 3600:
        return
    _send_dunning_email(marina, kind='grace')
    marina.billing_last_email_at = now
    marina.save(update_fields=['billing_last_email_at'])


# ── Hourly state-advancement (Celery task target) ───────────────────────────

def advance_billing_states():
    """Hourly state-machine tick.

    - `past_due` → `grace`     (after Stripe's smart-retry window — we
                                  approximate by treating any past_due older
                                  than 4 days as exhausted; in practice this
                                  is normally driven by the webhook setting
                                  `grace` directly via apply_subscription_truth
                                  when Stripe reports `unpaid`).
    - `grace` → `restricted`   when billing_grace_until elapses.
    - `restricted` → `suspended` after BILLING_RESTRICTED_DAYS.
    - Expired admin overrides: clear & re-sync from Stripe ground truth (A.5).

    Returns a dict of transitions performed, for tests / logging.
    """
    from apps.accounts.models import Marina

    now = timezone.now()
    results = {'past_due_to_grace': 0, 'grace_to_restricted': 0,
               'restricted_to_suspended': 0, 'overrides_expired': 0,
               'emails_sent': 0}

    # 1) Expire admin overrides
    expired = Marina.objects.filter(
        billing_admin_override=True,
        billing_admin_override_expires_at__lt=now,
    )
    for marina in expired:
        marina.billing_admin_override = False
        marina.billing_admin_override_reason = ''
        marina.save(update_fields=['billing_admin_override',
                                   'billing_admin_override_reason'])
        # Audit: re-sync from Stripe ground truth (A.5).
        _resync_from_stripe(marina, reason='admin_override_expired')
        results['overrides_expired'] += 1

    # 2) past_due → grace once we've been in past_due for >= 7 days OR
    #    Stripe declared `unpaid`. The Stripe-driven path goes via
    #    apply_subscription_truth; this is the time-based fallback.
    past_due_threshold = now - _dt.timedelta(days=_cfg.BILLING_GRACE_DAYS)
    past_due_marinas = Marina.objects.filter(
        billing_state=STATE_PAST_DUE,
        manual_contract=False,
        billing_state_since__lt=past_due_threshold,
    )
    for marina in past_due_marinas:
        marina.billing_grace_until = now + _dt.timedelta(days=_cfg.BILLING_GRACE_DAYS)
        marina.save(update_fields=['billing_grace_until'])
        _transition(marina, STATE_GRACE, reason='grace_started')
        results['past_due_to_grace'] += 1

    # 3) grace → restricted
    grace_marinas = Marina.objects.filter(
        billing_state=STATE_GRACE,
        manual_contract=False,
        billing_grace_until__lt=now,
    )
    for marina in grace_marinas:
        _transition(marina, STATE_RESTRICTED, reason='grace_expired')
        results['grace_to_restricted'] += 1

    # 4) restricted → suspended after BILLING_RESTRICTED_DAYS
    restricted_threshold = now - _dt.timedelta(days=_cfg.BILLING_RESTRICTED_DAYS)
    restricted_marinas = Marina.objects.filter(
        billing_state=STATE_RESTRICTED,
        manual_contract=False,
        billing_state_since__lt=restricted_threshold,
    )
    for marina in restricted_marinas:
        _transition(marina, STATE_SUSPENDED, reason='restricted_expired')
        results['restricted_to_suspended'] += 1

    # 5) Email cadence
    for marina in Marina.objects.filter(
        billing_state__in=(STATE_PAST_DUE, STATE_GRACE), manual_contract=False,
    ):
        before = marina.billing_last_email_at
        if marina.billing_state == STATE_PAST_DUE:
            maybe_send_past_due_email(marina)
        else:
            maybe_send_grace_email(marina)
        if marina.billing_last_email_at != before:
            results['emails_sent'] += 1

    return results


def _resync_from_stripe(marina, *, reason):
    """When an admin override expires, query Stripe for ground truth and
    enforce the correct restrictive state.

    Spec §A.5: "override auto-snap-back queries Stripe API for ground truth".

    Failures fall back to leaving billing_state where it is — defence in
    depth ensures the marina remains gated by the persisted state.
    """
    from apps.admin_portal.models import BillingStateChange
    if marina.manual_contract:
        return
    if not marina.stripe_subscription_id:
        # No Stripe sub on file → if local state is cancelled, leave it;
        # otherwise we have nothing to reconcile against.
        return
    try:
        import stripe as _stripe
        sub = _stripe.Subscription.retrieve(marina.stripe_subscription_id)
        apply_subscription_truth(marina, dict(sub), stripe_event_id='')
        # Record the resync event for audit even when state didn't change.
        BillingStateChange.objects.create(
            marina=marina,
            from_state=marina.billing_state,
            to_state=marina.billing_state,
            reason=f'resync:{reason}',
            detail={'stripe_status': getattr(sub, 'status', None)},
        )
    except Exception:
        logger.exception('Stripe re-sync failed for marina=%s', marina.id)


# ── Manual contract (Feature B / TRAP 2) ─────────────────────────────────────

@transaction.atomic
def set_manual_contract(marina, *, actor, fields, also_cancel_stripe=True):
    """Flip `manual_contract = True` on `marina` and atomically cancel any
    live Stripe subscription at period-end.

    TRAP 2 — Zombie Stripe subscription.
    If a Stripe subscription is present and we are unable to cancel it
    (network error, Stripe API failure), the ENTIRE transaction must roll
    back. The marina must NOT be left in a state where it's flagged as
    manual-contract while Stripe continues to auto-charge the card on file.

    `fields` is a dict of allowed manual_contract_* fields the admin set
    (signed_at, signed_by, reference, po_number, notes, invoice_terms,
    renewal_date).
    """
    if marina.manual_contract:
        # Already on; just update fields.
        for k, v in (fields or {}).items():
            setattr(marina, f'manual_contract_{k}', v)
        marina.save()
        return marina

    # 1. Cancel Stripe subscription at period end first (so an API failure
    #    aborts before we touch any DB state).
    if also_cancel_stripe and marina.stripe_subscription_id:
        import stripe as _stripe
        # NOTE: any exception here propagates OUT of the @transaction.atomic
        # block, causing the entire change to roll back. That's the trap fix.
        _stripe.Subscription.modify(
            marina.stripe_subscription_id,
            cancel_at_period_end=True,
        )

    # 2. Flip the flag + record metadata.
    marina.manual_contract = True
    marina.manual_contract_set_by = actor
    marina.manual_contract_set_at = timezone.now()
    for k, v in (fields or {}).items():
        setattr(marina, f'manual_contract_{k}', v)
    marina.save()

    # 3. Transition billing_state to 'manual'.
    _transition(
        marina, STATE_MANUAL,
        reason='manual_contract_set',
        actor=actor,
        detail={'fields': list((fields or {}).keys())},
    )
    return marina


@transaction.atomic
def clear_manual_contract(marina, *, actor, reason=''):
    """Clear the manual_contract flag.

    Per locked decision B.3, the marina enters a 7-day transition grace
    window (billing_state='grace') until they attach a Stripe payment
    method. This avoids instant lockout while still requiring action.
    """
    if not marina.manual_contract:
        return marina
    marina.manual_contract = False
    marina.manual_contract_set_by = actor
    marina.manual_contract_set_at = timezone.now()
    marina.save()

    grace_until = timezone.now() + _dt.timedelta(
        days=_cfg.BILLING_MANUAL_CONTRACT_CLEAR_GRACE_DAYS,
    )
    marina.billing_grace_until = grace_until
    marina.save(update_fields=['billing_grace_until'])

    _transition(
        marina, STATE_GRACE,
        reason='manual_contract_cleared',
        actor=actor,
        detail={'reason': reason or '', 'grace_until': grace_until.isoformat()},
    )
    return marina


# ── Admin overrides ──────────────────────────────────────────────────────────

def grant_override(marina, *, actor, reason, expires_at):
    """Activate billing_admin_override for the marina until `expires_at`."""
    if not reason:
        raise ValueError('Reason is required.')
    max_exp = timezone.now() + _dt.timedelta(days=_cfg.BILLING_OVERRIDE_MAX_DAYS)
    if expires_at > max_exp:
        raise ValueError(f'Override cap is {_cfg.BILLING_OVERRIDE_MAX_DAYS} days.')
    marina.billing_admin_override = True
    marina.billing_admin_override_reason = reason
    marina.billing_admin_override_set_by = actor
    marina.billing_admin_override_set_at = timezone.now()
    marina.billing_admin_override_expires_at = expires_at
    marina.save(update_fields=[
        'billing_admin_override', 'billing_admin_override_reason',
        'billing_admin_override_set_by', 'billing_admin_override_set_at',
        'billing_admin_override_expires_at',
    ])
    from apps.admin_portal.models import BillingStateChange
    BillingStateChange.objects.create(
        marina=marina, from_state=marina.billing_state,
        to_state=marina.billing_state, reason='admin_override_granted',
        actor_user=actor,
        detail={'reason': reason, 'expires_at': expires_at.isoformat()},
    )
    return marina


def revoke_override(marina, *, actor):
    marina.billing_admin_override = False
    marina.billing_admin_override_reason = ''
    marina.save(update_fields=['billing_admin_override',
                               'billing_admin_override_reason'])
    from apps.admin_portal.models import BillingStateChange
    BillingStateChange.objects.create(
        marina=marina, from_state=marina.billing_state,
        to_state=marina.billing_state, reason='admin_override_revoked',
        actor_user=actor,
    )
    _resync_from_stripe(marina, reason='override_revoked')
    return marina


def force_restore(marina, *, actor, reason):
    """Hard force the marina back to `current` (e.g. wire-transfer agreed)."""
    if not reason:
        raise ValueError('Reason is required.')
    return _transition(
        marina, STATE_CURRENT, reason='force_restore', actor=actor,
        detail={'reason': reason},
    )


def extend_grace(marina, *, actor, days):
    """Add `days` to billing_grace_until."""
    if days <= 0:
        raise ValueError('days must be positive.')
    now = timezone.now()
    base = marina.billing_grace_until or now
    if base < now:
        base = now
    marina.billing_grace_until = base + _dt.timedelta(days=int(days))
    marina.save(update_fields=['billing_grace_until'])
    from apps.admin_portal.models import BillingStateChange
    BillingStateChange.objects.create(
        marina=marina, from_state=marina.billing_state,
        to_state=marina.billing_state, reason='admin_extend_grace',
        actor_user=actor,
        detail={'days': days, 'new_grace_until': marina.billing_grace_until.isoformat()},
    )
    return marina


# ── Decorator for view-level enforcement ────────────────────────────────────

def require_billing_state(*allowed_states):
    """Decorator: only allow a view to run if marina.billing_state is in `allowed_states`.

    Used as defence-in-depth alongside BillingGateMiddleware. Resolves the
    marina via `request.user.marina` or `request.tenant`.
    """
    allowed = set(allowed_states)

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped(self_or_request, *args, **kwargs):
            # Works on both function-based and method views.
            request = self_or_request if hasattr(self_or_request, 'method') \
                else getattr(self_or_request, 'request', None) or args[0]
            marina = (
                getattr(getattr(request, 'user', None), 'marina', None)
                or getattr(request, 'tenant', None)
            )
            if marina is not None:
                state = _resolve_effective_state(marina)
                if state not in allowed:
                    from rest_framework.response import Response
                    from rest_framework import status as _http
                    return Response(
                        {
                            'error': 'marina_billing_blocked',
                            'billing_state': marina.billing_state,
                            'grace_until': (
                                marina.billing_grace_until.isoformat()
                                if marina.billing_grace_until else None
                            ),
                            'contact': 'billing@docksbase.com',
                        },
                        status=_http.HTTP_402_PAYMENT_REQUIRED,
                    )
            return view_func(self_or_request, *args, **kwargs)
        return _wrapped
    return decorator
