import { useState, useEffect, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import api from '../../api.js';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

const STRIPE_APPEARANCE = {
  theme: 'night',
  variables: {
    colorPrimary: '#b8965a',
    colorBackground: '#162d52',
    colorText: '#f5f0e6',
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
    borderRadius: '6px',
    spacingUnit: '4px',
  },
};

function formatCurrency(amount, currency) {
  return Number(amount).toLocaleString('de-CH', {
    style: 'currency',
    currency: (currency || 'chf').toUpperCase(),
  });
}

function CheckoutForm({ invoice, currency, onPaid, onClose }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [succeeded, setSucceeded]   = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError('');

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message || 'Payment failed. Please try again.');
      setSubmitting(false);
    } else {
      setSucceeded(true);
      timerRef.current = setTimeout(() => {
        onPaid(invoice.id);
        onClose();
      }, 2000);
    }
  }

  if (succeeded) {
    return (
      <div className="pay-modal-success">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
          stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div className="pay-modal-success-text">Payment received</div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="pay-modal-form">
      <div className="pay-modal-amount">{formatCurrency(invoice.total, currency)}</div>
      <PaymentElement />
      {error && <p className="pay-modal-error">{error}</p>}
      <button
        type="submit"
        className="abtn abtn-gold portal-full-btn"
        disabled={submitting || !stripe}
      >
        {submitting ? 'Processing…' : `Pay ${formatCurrency(invoice.total, currency)}`}
      </button>
      <button type="button" className="pay-modal-cancel" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}

export default function PaymentModal({ invoice, onClose, onPaid }) {
  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret, setClientSecret]   = useState('');
  const [currency, setCurrency]           = useState('chf');
  const [loading, setLoading]             = useState(true);
  const [fetchError, setFetchError]       = useState('');

  useEffect(() => {
    api.post(`/portal/invoices/${invoice.id}/pay/`)
      .then(r => {
        const { client_secret, currency: curr, stripe_account_id } = r.data;
        setClientSecret(client_secret);
        setCurrency(curr);
        setStripePromise(loadStripe(STRIPE_PK, { stripeAccount: stripe_account_id }));
      })
      .catch(() => setFetchError('Could not initialise payment. Please try again.'))
      .finally(() => setLoading(false));
  }, [invoice.id]);

  return (
    <div className="pay-modal-overlay" onClick={onClose}>
      <div className="pay-modal-card" onClick={e => e.stopPropagation()}>
        <div className="pay-modal-title">Pay Invoice</div>
        <div className="pay-modal-ref">
          {invoice.invoice_number || `INV-${invoice.id}`}
        </div>

        {loading && <div className="portal-loading">Initialising payment…</div>}

        {fetchError && <p className="pay-modal-error">{fetchError}</p>}

        {!loading && !fetchError && clientSecret && stripePromise && (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
          >
            <CheckoutForm
              invoice={invoice}
              currency={currency}
              onPaid={onPaid}
              onClose={onClose}
            />
          </Elements>
        )}
      </div>
    </div>
  );
}
