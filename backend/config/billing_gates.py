"""
Tunables for the platform billing-gate dunning lifecycle.

Spec ref: docs/superpowers/specs/2026-05-17-billing-gates-design.md §A.3
"""
from __future__ import annotations


# ── Lifecycle defaults (days) ────────────────────────────────────────────────
BILLING_GRACE_DAYS = 7
BILLING_RESTRICTED_DAYS = 7
BILLING_SUSPENDED_TO_CANCELLED_DAYS = 30

# Super-admin override caps
BILLING_OVERRIDE_MAX_DAYS = 90

# Transition grace after admin clears the manual-contract flag — the marina has
# this many days to attach a Stripe payment method before being kicked into
# past_due. (Locked decision B.3.)
BILLING_MANUAL_CONTRACT_CLEAR_GRACE_DAYS = 7

# Data retention after `cancelled` before cold-storage archive. The archival
# management command is a stub for v1 (see TODO in
# apps/billing/management/commands/archive_cancelled_marinas.py).
BILLING_CANCELLED_RETENTION_DAYS = 90

# ── State constants ──────────────────────────────────────────────────────────
STATE_CURRENT     = 'current'
STATE_PAST_DUE    = 'past_due'
STATE_GRACE       = 'grace'
STATE_RESTRICTED  = 'restricted'
STATE_SUSPENDED   = 'suspended'
STATE_CANCELLED   = 'cancelled'
STATE_MANUAL      = 'manual'

ALL_STATES = (
    STATE_CURRENT,
    STATE_PAST_DUE,
    STATE_GRACE,
    STATE_RESTRICTED,
    STATE_SUSPENDED,
    STATE_CANCELLED,
    STATE_MANUAL,
)

# ── Action enum for assert_marina_can(...) ──────────────────────────────────
# Anything NOT listed here is allowed by default for current/past_due/grace
# and follows the matrix in spec §A.4 for restricted/suspended/cancelled.

# Actions blocked starting at `restricted`:
ACTION_NEW_BOOKING        = 'new_booking'
ACTION_BROADCAST          = 'broadcast'
ACTION_EDIT_PRICING       = 'edit_pricing'
ACTION_INVITE_STAFF       = 'invite_staff'
# Actions blocked starting at `suspended`:
ACTION_CHECK_IN_OUT       = 'check_in_out'   # allowed until suspended
ACTION_LOGIN              = 'login'          # refused at suspended+

# Actions ALWAYS allowed (including at cancelled — see Trap 3):
ACTION_BOATER_INVOICE_PAY = 'boater_invoice_pay'
ACTION_SUBSCRIPTION_SELF_SERVICE = 'subscription_self_service'

# Email cadence for past_due (locked decision A.4). Days into past_due at
# which the marina owner gets an email. After day 7, fall back to
# `every 48h during grace` (handled by advance_billing_states).
PAST_DUE_EMAIL_DAYS = (1, 3, 7)
GRACE_EMAIL_INTERVAL_HOURS = 48
