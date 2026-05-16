import stripe
from django.conf import settings

stripe.api_key = settings.STRIPE_SECRET_KEY


def _create_checkout_session(invoice):
    line_items = [
        {
            'price_data': {
                'currency': invoice.marina.currency.lower(),
                'product_data': {'name': item.description},
                'unit_amount': int(round(float(item.unit_price) * 100)),
            },
            'quantity': int(item.quantity),
        }
        for item in invoice.items.all()
    ]
    session = stripe.checkout.Session.create(
        payment_method_types=['card'],
        line_items=line_items,
        mode='payment',
        success_url=f'{settings.PORTAL_BASE_URL}/{invoice.marina.slug}/booking/{invoice.source_id}/confirmed',
        cancel_url=f'{settings.PORTAL_BASE_URL}/{invoice.marina.slug}/booking/{invoice.source_id}/cancelled',
        metadata={'invoice_id': str(invoice.id)},
        stripe_account=invoice.marina.stripe_account_id or None,
    )
    invoice.stripe_checkout_session_id = session.id
    invoice.save(update_fields=['stripe_checkout_session_id'])
    return session.url


def create_payment_intent(marina, amount_cents, currency, metadata=None):
    """Creates a PaymentIntent on the marina's Connect account. Returns client_secret."""
    intent = stripe.PaymentIntent.create(
        amount=amount_cents,
        currency=currency.lower(),
        payment_method_types=['card'],
        metadata=metadata or {},
        stripe_account=marina.stripe_account_id or None,
    )
    return intent.client_secret


# Sentinel substrings Stripe puts in InvalidRequestError messages when a
# refund is older than the 180-day window.
_REFUND_TOO_OLD_HINTS = (
    'older than',
    '180 days',
    'charge is too old',
    'charge_already_refunded',  # safety
    'expired',
)


def _is_too_old_error(err) -> bool:
    msg = (getattr(err, 'user_message', None) or str(err) or '').lower()
    return any(h in msg for h in _REFUND_TOO_OLD_HINTS)


def refund_payment_intent(
    *,
    payment_intent_id: str,
    amount_cents: int | None = None,
    reason: str | None = None,
    metadata: dict | None = None,
    requested_by_user_id: int,
):
    """
    Refund a Stripe PaymentIntent and return a billing.Refund row.

    Handles the 180-day-old-charge trap: if Stripe rejects the refund because
    the underlying charge is too old, the Refund row is recorded with
    status='manual_required' instead of raising — callers can then cut a
    cheque offline.

    The caller is responsible for invoice/marina scoping; this helper only
    talks to Stripe and persists the Refund row.
    """
    # Local imports avoid circular dependency at module-import time.
    from django.utils import timezone
    from .models import Invoice, Refund

    # Locate the originating invoice + marina (the Refund row needs both).
    invoice = Invoice.objects.filter(
        stripe_payment_intent_id=payment_intent_id
    ).select_related('marina').first()

    if invoice is None:
        raise ValueError(
            f'No invoice found for payment_intent_id={payment_intent_id!r}'
        )

    marina = invoice.marina
    currency = (invoice.marina.currency or 'eur').lower()

    refund_row = Refund.objects.create(
        marina=marina,
        invoice=invoice,
        stripe_payment_intent_id=payment_intent_id,
        amount_cents=amount_cents or 0,
        currency=currency,
        reason=reason or Refund.Reason.OTHER,
        status=Refund.Status.PENDING,
        requested_by_id=requested_by_user_id,
        notes='',
    )

    kwargs = {
        'payment_intent': payment_intent_id,
        'metadata': metadata or {},
    }
    if amount_cents:
        kwargs['amount'] = amount_cents
    # Stripe accepts a subset of reason codes — only forward the matching ones.
    stripe_reason_map = {
        'duplicate': 'duplicate',
        'fraudulent': 'fraudulent',
        'requested_by_customer': 'requested_by_customer',
    }
    if reason in stripe_reason_map:
        kwargs['reason'] = stripe_reason_map[reason]
    if marina.stripe_account_id:
        kwargs['stripe_account'] = marina.stripe_account_id

    try:
        stripe_refund = stripe.Refund.create(**kwargs)
    except stripe.error.InvalidRequestError as err:
        if _is_too_old_error(err):
            refund_row.status = Refund.Status.MANUAL_REQUIRED
            refund_row.notes = (
                f'Stripe rejected the refund (charge older than 180 days): '
                f'{getattr(err, "user_message", None) or str(err)}'
            )
            refund_row.save(update_fields=['status', 'notes'])
            return refund_row
        refund_row.status = Refund.Status.FAILED
        refund_row.notes = f'Stripe error: {err}'
        refund_row.save(update_fields=['status', 'notes'])
        raise

    refund_row.stripe_refund_id = getattr(stripe_refund, 'id', '') or ''
    stripe_status = getattr(stripe_refund, 'status', None)
    if stripe_status == 'succeeded':
        refund_row.status = Refund.Status.SUCCEEDED
        refund_row.completed_at = timezone.now()
    elif stripe_status == 'pending':
        refund_row.status = Refund.Status.PENDING
    elif stripe_status == 'requires_action':
        refund_row.status = Refund.Status.REQUIRES_ACTION
    elif stripe_status == 'failed':
        refund_row.status = Refund.Status.FAILED
    refund_row.save()
    return refund_row
