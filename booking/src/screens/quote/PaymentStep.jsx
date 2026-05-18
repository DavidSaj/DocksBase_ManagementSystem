import { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { confirmReservation } from '@docksbase/portal-ui/api';

export default function PaymentStep({ state, intentData, onConfirmed, onError, onBack }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handlePay(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError('');

    const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: `${window.location.origin}${window.location.pathname}`,
        payment_method_data: {
          billing_details: {
            name:  state.guest.name,
            email: state.guest.email,
            phone: state.guest.phone || undefined,
            address: {
              line1:       state.guest.billing_street,
              city:        state.guest.billing_city,
              postal_code: state.guest.billing_postcode,
              country:     state.guest.billing_country,
            },
          },
        },
      },
    });

    if (stripeErr) {
      setError(stripeErr.message || 'Payment failed. Please try again.');
      setBusy(false);
      return;
    }
    if (!paymentIntent) { setBusy(false); return; }

    try {
      await confirmReservation(intentData.marinaSlug, intentData.reservationId, paymentIntent.id);
      onConfirmed(intentData.reference);
    } catch (err) {
      if (err.response?.status === 409) {
        onConfirmed(intentData.reference);
        return;
      }
      setError('Payment received but confirmation failed. Please contact the marina with reference ' + intentData.reference);
      setBusy(false);
    }
  }

  return (
    <form className="q-step" onSubmit={handlePay}>
      <h3>Payment</h3>
      <div style={{ marginBottom: 20 }}>
        <PaymentElement
          options={{
            layout: 'tabs',
            fields: { billingDetails: { address: 'never' } },
          }}
        />
      </div>
      {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      <div className="q-step-footer">
        <button type="button" className="p-btn-outline" onClick={onBack} disabled={busy}>← Back</button>
        <button type="submit" className="p-btn-gold" disabled={busy || !stripe}>
          {busy ? 'Processing…' : `Confirm & Pay €${parseFloat(intentData.total).toFixed(2)}`}
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 10 }}>
        Secure payment powered by Stripe.
      </p>
    </form>
  );
}
