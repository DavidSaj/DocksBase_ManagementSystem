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
