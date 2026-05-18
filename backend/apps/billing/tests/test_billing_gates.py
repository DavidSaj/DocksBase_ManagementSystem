"""
Tests for the platform billing-gate engine.

Covers the three critical traps from the spec review:
  TRAP 1: Out-of-order Stripe webhook race condition.
  TRAP 2: Zombie Stripe subscription on manual-contract flag.
  TRAP 3: Never block inbound boater payments via Stripe Connect.

Plus state advancement, email cadence, override expiry, and audit rows.

Spec ref: docs/superpowers/specs/2026-05-17-billing-gates-design.md
"""
from __future__ import annotations

import datetime as _dt
import json
from unittest.mock import patch, MagicMock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.admin_portal.models import (
    AuditLog, BillingStateChange, ProcessedStripeEvent,
)
from apps.billing import gates
from config.billing_gates import (
    STATE_CURRENT, STATE_PAST_DUE, STATE_GRACE, STATE_RESTRICTED,
    STATE_SUSPENDED, STATE_CANCELLED, STATE_MANUAL,
    BILLING_GRACE_DAYS, BILLING_RESTRICTED_DAYS,
)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def make_marina(stripe_customer_id='cus_test', stripe_sub_id='sub_test', **kwargs):
    defaults = dict(
        name='Test Marina', status='active', currency='EUR',
        stripe_customer_id=stripe_customer_id,
        stripe_subscription_id=stripe_sub_id,
    )
    defaults.update(kwargs)
    return Marina.objects.create(**defaults)


def make_user(marina=None, email=None, is_platform_admin=False, role='owner',
              platform_role=''):
    return User.objects.create_user(
        email=email or f'u{User.objects.count()}@test.com', password='pass',
        marina=marina, role=role, is_active=True,
        is_platform_admin=is_platform_admin, platform_role=platform_role,
    )


def auth_client(user):
    c = APIClient()
    refresh = RefreshToken.for_user(user)
    refresh['role'] = user.role
    refresh['is_platform_admin'] = user.is_platform_admin
    c.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return c


# ────────────────────────────────────────────────────────────────────────────
# TRAP 1 — Out-of-order webhook race
# ────────────────────────────────────────────────────────────────────────────

class Trap1OutOfOrderWebhookTest(TestCase):
    """
    Stripe doesn't guarantee chronological webhook delivery. If a marina
    pays the failed invoice between the failure and the payment-succeeded
    webhook arriving, the events may be delivered in the wrong order. The
    gates module must inspect the Stripe object's CURRENT `status` and
    refuse to regress from `current` back to `past_due`.
    """

    def test_record_failure_ignores_event_with_paid_status(self):
        """A late-delivered invoice.payment_failed whose payload says
        status==paid must NOT regress us from current → past_due."""
        marina = make_marina(billing_state=STATE_CURRENT)
        # Simulate Stripe ground truth saying the invoice is paid now.
        gates.record_failure(marina, {'id': 'in_1', 'status': 'paid'},
                             stripe_event_id='evt_late_fail')
        marina.refresh_from_db()
        self.assertEqual(marina.billing_state, STATE_CURRENT)
        # No transition row should have been written.
        self.assertFalse(
            BillingStateChange.objects.filter(
                marina=marina, to_state=STATE_PAST_DUE).exists()
        )

    def test_apply_subscription_truth_uses_status_not_event_type(self):
        """An out-of-order customer.subscription.updated whose payload says
        status==active flips us back to current, regardless of any earlier
        past_due state."""
        marina = make_marina(billing_state=STATE_PAST_DUE)
        gates.apply_subscription_truth(
            marina, {'status': 'active'}, stripe_event_id='evt_resume',
        )
        marina.refresh_from_db()
        self.assertEqual(marina.billing_state, STATE_CURRENT)

    def test_apply_subscription_truth_flips_to_past_due_on_unpaid_status(self):
        marina = make_marina(billing_state=STATE_CURRENT)
        gates.apply_subscription_truth(
            marina, {'status': 'past_due'}, stripe_event_id='evt_failed',
        )
        marina.refresh_from_db()
        self.assertEqual(marina.billing_state, STATE_PAST_DUE)

    def test_webhook_event_id_deduplication(self):
        """Replayed Stripe events (same event id) must be no-ops."""
        marina = make_marina(billing_state=STATE_CURRENT)
        client = APIClient()

        def _event(eid):
            return {
                'id': eid, 'type': 'invoice.payment_failed',
                'data': {'object': {
                    'customer': marina.stripe_customer_id,
                    'id': 'in_xxx', 'status': 'open',
                }},
            }

        with patch('apps.billing.views._stripe_svc') as mock_svc:
            mock_svc.stripe.Webhook.construct_event.return_value = _event('evt_dup_1')
            with patch('apps.billing.views._send_payment_failed_email'):
                client.post('/api/v1/billing/stripe/webhook/',
                            data='{}', content_type='application/json',
                            HTTP_STRIPE_SIGNATURE='sig')
            # Replay same event id — should be ignored.
            mock_svc.stripe.Webhook.construct_event.return_value = _event('evt_dup_1')
            with patch('apps.billing.views._send_payment_failed_email'):
                client.post('/api/v1/billing/stripe/webhook/',
                            data='{}', content_type='application/json',
                            HTTP_STRIPE_SIGNATURE='sig')

        # Exactly one ProcessedStripeEvent row.
        self.assertEqual(
            ProcessedStripeEvent.objects.filter(event_id='evt_dup_1').count(), 1
        )
        # Exactly one past_due transition (replay was ignored).
        self.assertEqual(
            BillingStateChange.objects.filter(
                marina=marina, to_state=STATE_PAST_DUE).count(),
            1,
        )


# ────────────────────────────────────────────────────────────────────────────
# TRAP 2 — Zombie Stripe subscription on manual-contract flag
# ────────────────────────────────────────────────────────────────────────────

class Trap2ZombieSubscriptionTest(TestCase):
    """
    Flipping manual_contract=True MUST atomically cancel the Stripe sub at
    period end inside the same backend service call. If Stripe API fails,
    the entire DB transaction rolls back.
    """

    def test_set_manual_contract_cancels_stripe_atomically(self):
        marina = make_marina(stripe_sub_id='sub_zombie')
        admin = make_user(is_platform_admin=True, platform_role='admin')
        with patch('stripe.Subscription.modify') as mock_modify:
            gates.set_manual_contract(
                marina, actor=admin, fields={'reference': 'CON-001'},
            )
            mock_modify.assert_called_once_with(
                'sub_zombie', cancel_at_period_end=True,
            )
        marina.refresh_from_db()
        self.assertTrue(marina.manual_contract)
        self.assertEqual(marina.billing_state, STATE_MANUAL)
        self.assertEqual(marina.manual_contract_reference, 'CON-001')

    def test_stripe_failure_rolls_back_manual_contract_flip(self):
        """If Stripe API call fails, the flag must NOT be set in the DB."""
        marina = make_marina(stripe_sub_id='sub_will_fail')
        admin = make_user(is_platform_admin=True, platform_role='admin')

        with patch('stripe.Subscription.modify',
                   side_effect=Exception('Stripe API down')):
            with self.assertRaises(Exception):
                gates.set_manual_contract(
                    marina, actor=admin, fields={'reference': 'CON-002'},
                )
        marina.refresh_from_db()
        # Manual contract NOT set, no transition row.
        self.assertFalse(marina.manual_contract)
        self.assertEqual(marina.billing_state, STATE_CURRENT)
        self.assertFalse(
            BillingStateChange.objects.filter(
                marina=marina, to_state=STATE_MANUAL).exists()
        )

    def test_admin_endpoint_invokes_atomic_cancel(self):
        marina = make_marina(stripe_sub_id='sub_via_admin')
        admin = make_user(is_platform_admin=True, platform_role='admin')
        client = auth_client(admin)
        with patch('stripe.Subscription.modify') as mock_modify:
            resp = client.post(
                f'/api/v1/admin/marinas/{marina.pk}/manual-contract/',
                data={
                    'manual_contract': True,
                    'manual_contract_reference': 'CON-007',
                    'manual_contract_signed_by': 'Jane Sales',
                }, format='json',
            )
            self.assertEqual(resp.status_code, 200, resp.content)
            mock_modify.assert_called_once_with(
                'sub_via_admin', cancel_at_period_end=True,
            )
        marina.refresh_from_db()
        self.assertTrue(marina.manual_contract)

    def test_support_role_cannot_set_manual_contract(self):
        marina = make_marina()
        support = make_user(is_platform_admin=True, platform_role='support')
        client = auth_client(support)
        resp = client.post(
            f'/api/v1/admin/marinas/{marina.pk}/manual-contract/',
            data={'manual_contract': True}, format='json',
        )
        self.assertEqual(resp.status_code, 403)


# ────────────────────────────────────────────────────────────────────────────
# TRAP 3 — Never block inbound boater payments
# ────────────────────────────────────────────────────────────────────────────

class Trap3BoaterPaymentsAlwaysOpenTest(TestCase):
    """
    Boater portal payment endpoints must remain accessible even when the
    marina is in `cancelled`. assert_marina_can refuses to block
    ACTION_BOATER_INVOICE_PAY at any state.
    """

    def test_gates_helper_never_blocks_boater_pay(self):
        for state in (STATE_CURRENT, STATE_PAST_DUE, STATE_GRACE,
                      STATE_RESTRICTED, STATE_SUSPENDED, STATE_CANCELLED):
            marina = make_marina(billing_state=state,
                                 stripe_customer_id=f'cus_{state}',
                                 stripe_sub_id=f'sub_{state}')
            # Must not raise — even at `cancelled`.
            gates.assert_marina_can(marina, gates.ACTION_BOATER_INVOICE_PAY)
            gates.assert_marina_can(marina, gates.ACTION_SUBSCRIPTION_SELF_SERVICE)

    def test_gates_helper_blocks_new_bookings_at_restricted(self):
        marina = make_marina(billing_state=STATE_RESTRICTED)
        with self.assertRaises(gates.BillingBlocked):
            gates.assert_marina_can(marina, gates.ACTION_NEW_BOOKING)

    def test_middleware_does_not_block_portal_path_when_marina_cancelled(self):
        """Boater /api/v1/portal/... must respond even at `cancelled`."""
        marina = make_marina(billing_state=STATE_CANCELLED, status='suspended')
        client = APIClient()
        # Use a portal endpoint that exists; we expect any response other than
        # a 402 billing block (404/401 are fine — point is the middleware
        # didn't intercept). Hit a known prefix.
        resp = client.get('/api/v1/portal/healthcheck/that-does-not-exist')
        self.assertNotEqual(resp.status_code, 402)

    def test_middleware_blocks_marina_app_when_suspended(self):
        """Sanity: marina-app endpoints DO get blocked when suspended.

        Marina-app clients identify their tenant via the X-Marina-Slug
        header (resolved by TenantMiddleware → request.tenant). The
        BillingGateMiddleware reads from that, since DRF JWT auth doesn't
        populate request.user at the Django-middleware layer.
        """
        marina = make_marina(billing_state=STATE_SUSPENDED)
        client = APIClient()
        resp = client.post(
            '/api/v1/reservations/that-does-not-exist',
            data={}, format='json',
            HTTP_X_MARINA_SLUG=marina.slug,
        )
        # We expect 402 from BillingGateMiddleware (path matches
        # /api/v1/reservations/ mutation prefix), not 404.
        self.assertEqual(resp.status_code, 402, resp.content)
        self.assertEqual(resp.json()['error'], 'marina_billing_blocked')

    def test_middleware_does_not_block_boater_payment_path_even_when_cancelled(self):
        """Trap 3 verified via the actual middleware path-matching: even
        when the marina is in `cancelled` AND legacy status='suspended',
        portal/public/billing-invoice paths must not 402."""
        marina = make_marina(billing_state=STATE_CANCELLED, status='suspended')
        client = APIClient()
        for path in (
            '/api/v1/portal/some-endpoint',
            '/api/v1/public/some-endpoint',
            '/api/v1/billing/invoices/9999/checkout/',  # boater Connect path
        ):
            resp = client.get(path, HTTP_X_MARINA_SLUG=marina.slug)
            self.assertNotEqual(
                resp.status_code, 402,
                f'TRAP 3 violation on {path}: got 402 from middleware',
            )


# ────────────────────────────────────────────────────────────────────────────
# State advancement / Celery task
# ────────────────────────────────────────────────────────────────────────────

class StateAdvancementTest(TestCase):
    def test_grace_expired_advances_to_restricted(self):
        marina = make_marina(billing_state=STATE_GRACE)
        marina.billing_state_since = timezone.now() - _dt.timedelta(days=10)
        marina.billing_grace_until = timezone.now() - _dt.timedelta(hours=1)
        marina.save()
        results = gates.advance_billing_states()
        marina.refresh_from_db()
        self.assertEqual(marina.billing_state, STATE_RESTRICTED)
        self.assertEqual(results['grace_to_restricted'], 1)

    def test_restricted_expired_advances_to_suspended(self):
        marina = make_marina(billing_state=STATE_RESTRICTED)
        marina.billing_state_since = timezone.now() - _dt.timedelta(
            days=BILLING_RESTRICTED_DAYS + 1,
        )
        marina.save()
        gates.advance_billing_states()
        marina.refresh_from_db()
        self.assertEqual(marina.billing_state, STATE_SUSPENDED)

    def test_audit_row_written_on_every_transition(self):
        marina = make_marina(billing_state=STATE_CURRENT)
        gates._transition(marina, STATE_PAST_DUE,
                          reason='test', stripe_event_id='evt_1')
        self.assertTrue(
            BillingStateChange.objects.filter(
                marina=marina, from_state=STATE_CURRENT,
                to_state=STATE_PAST_DUE, reason='test',
                stripe_event_id='evt_1',
            ).exists()
        )


# ────────────────────────────────────────────────────────────────────────────
# Email cadence
# ────────────────────────────────────────────────────────────────────────────

class EmailCadenceTest(TestCase):
    def test_past_due_email_on_day_1_3_7(self):
        marina = make_marina(billing_state=STATE_PAST_DUE)
        make_user(marina, role='owner')
        for day in (1, 3, 7):
            marina.billing_state_since = timezone.now() - _dt.timedelta(days=day)
            marina.billing_last_email_at = None
            marina.save()
            with patch('apps.accounts.emails.send_payment_failed_email') as mock_send:
                gates.maybe_send_past_due_email(marina)
                self.assertEqual(mock_send.call_count, 1, f'day={day}')

    def test_no_email_on_other_days(self):
        marina = make_marina(billing_state=STATE_PAST_DUE)
        make_user(marina, role='owner')
        marina.billing_state_since = timezone.now() - _dt.timedelta(days=4)
        marina.save()
        with patch('apps.accounts.emails.send_payment_failed_email') as mock_send:
            gates.maybe_send_past_due_email(marina)
            mock_send.assert_not_called()

    def test_grace_email_every_48h(self):
        marina = make_marina(billing_state=STATE_GRACE)
        make_user(marina, role='owner')
        with patch('apps.accounts.emails.send_payment_failed_email') as mock_send:
            # First call → sends.
            gates.maybe_send_grace_email(marina)
            self.assertEqual(mock_send.call_count, 1)
            # Immediate second call → de-duped.
            mock_send.reset_mock()
            marina.refresh_from_db()
            gates.maybe_send_grace_email(marina)
            mock_send.assert_not_called()


# ────────────────────────────────────────────────────────────────────────────
# Override expiry → Stripe ground-truth re-sync
# ────────────────────────────────────────────────────────────────────────────

class OverrideExpiryResyncTest(TestCase):
    def test_expired_override_resyncs_from_stripe(self):
        marina = make_marina(billing_state=STATE_GRACE)
        marina.billing_admin_override = True
        marina.billing_admin_override_set_at = timezone.now() - _dt.timedelta(days=2)
        marina.billing_admin_override_expires_at = timezone.now() - _dt.timedelta(hours=1)
        marina.save()

        # Stripe says: subscription is past_due.
        fake_sub = MagicMock()
        fake_sub.status = 'past_due'
        fake_sub.__iter__ = lambda self: iter({'status': 'past_due'}.items())
        fake_sub.get = lambda k, default=None: {'status': 'past_due'}.get(k, default)
        # Use a plain dict instead of MagicMock for clean iteration.
        with patch('stripe.Subscription.retrieve',
                   return_value={'status': 'past_due'}):
            results = gates.advance_billing_states()

        marina.refresh_from_db()
        self.assertFalse(marina.billing_admin_override)
        # State should now reflect Stripe ground truth (past_due).
        self.assertEqual(marina.billing_state, STATE_PAST_DUE)
        self.assertEqual(results['overrides_expired'], 1)


# ────────────────────────────────────────────────────────────────────────────
# Manual-contract clear flow — locked decision B.3
# ────────────────────────────────────────────────────────────────────────────

class ManualContractClearTest(TestCase):
    def test_clear_flag_places_marina_in_transition_grace(self):
        marina = make_marina(manual_contract=True, billing_state=STATE_MANUAL)
        admin = make_user(is_platform_admin=True, platform_role='admin')
        gates.clear_manual_contract(marina, actor=admin, reason='moved to Stripe')
        marina.refresh_from_db()
        self.assertFalse(marina.manual_contract)
        self.assertEqual(marina.billing_state, STATE_GRACE)
        self.assertIsNotNone(marina.billing_grace_until)


# ────────────────────────────────────────────────────────────────────────────
# Owner-visible subscription endpoint when on manual contract (locked B.4)
# ────────────────────────────────────────────────────────────────────────────

class SubscriptionEndpointManualContractTest(TestCase):
    def test_subscription_view_returns_409_for_manual_contract(self):
        marina = make_marina(
            manual_contract=True,
            billing_state=STATE_MANUAL,
            manual_contract_reference='CON-992',
            manual_contract_renewal_date=_dt.date(2027, 1, 1),
        )
        owner = make_user(marina, role='owner')
        client = auth_client(owner)
        resp = client.get('/api/v1/billing/subscription/')
        self.assertEqual(resp.status_code, 409)
        body = resp.json()
        self.assertEqual(body['billing_managed'], 'manual_contract')
        self.assertEqual(body['contract_reference'], 'CON-992')
        self.assertEqual(body['renewal_date'], '2027-01-01')
