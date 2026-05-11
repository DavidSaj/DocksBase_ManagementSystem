"""
apps/accounting/services/__init__.py

Service layer for the accounting module.  Re-exports all public service functions.

Sub-modules:
  - .gl_posting       — GL journal entry creation and posting
  - .deferred_revenue — deferred revenue lifecycle (adjust, refund)
  - .payment_plans    — payment plan creation + instalment invoice issuing
  - .credit           — on-account member credit top-up and deduction

Usage:
    from apps.accounting.services import post_invoice_gl
    # or
    from apps.accounting.services.gl_posting import post_invoice_gl
"""

from apps.accounting.services.gl_posting import (
    post_invoice_gl,
    post_payment_gl,
    post_credit_note_gl,
    post_ap_invoice_gl,
    post_deferred_refund_gl,
    post_deferred_recognition_gl,
)
from apps.accounting.services.deferred_revenue import (
    adjust_deferred_entry,
)
from apps.accounting.services.payment_plans import (
    distribute_evenly,
    create_payment_plan,
    issue_instalment_invoice,
)
from apps.accounting.services.credit import (
    top_up_credit,
    deduct_credit,
    auto_deduct_on_invoice,
)

__all__ = [
    # GL posting
    'post_invoice_gl',
    'post_payment_gl',
    'post_credit_note_gl',
    'post_ap_invoice_gl',
    'post_deferred_refund_gl',
    'post_deferred_recognition_gl',
    # Deferred revenue
    'adjust_deferred_entry',
    # Payment plans
    'distribute_evenly',
    'create_payment_plan',
    'issue_instalment_invoice',
    # Credit
    'top_up_credit',
    'deduct_credit',
    'auto_deduct_on_invoice',
]
