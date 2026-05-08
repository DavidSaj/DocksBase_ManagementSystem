import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import api from '../api';
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const AMENITY_LABELS = {
  power_30a:   '⚡ 30A Power',
  power_50a:   '⚡ 50A Power',
  water:       '💧 Water',
  wifi:        '📶 WiFi',
  fuel_nearby: '⛽ Fuel Nearby',
  pump_out:    '🔄 Pump-out',
};

const MOORING_LABELS = {
  finger:       'Finger Pontoon',
  alongside:    'Alongside',
  stern_to:     'Stern-to',
  mooring_ball: 'Mooring Ball',
};

function ReceiptCard({ category, nights, total, checkIn, checkOut, marina }) {
  const pricePerNight  = parseFloat(category.price_per_night);
  const subtotal       = pricePerNight * nights;
  const vatRate        = marina?.vat_rate ? parseFloat(marina.vat_rate) : 0;
  const vatAmount      = vatRate > 0 ? subtotal * vatRate / 100 : 0;
  const displayTotal   = vatRate > 0 ? subtotal + vatAmount : total;
  const fmt            = n => `€${n.toFixed(2)}`;

  return (
    <div className="q-receipt-card">
      <div className="q-receipt-eyebrow">Booking Summary</div>
      <div className="q-receipt-cat-name">{category.name}</div>
      {category.mooring_type && (
        <div className="q-receipt-mooring">
          {MOORING_LABELS[category.mooring_type] || category.mooring_type}
        </div>
      )}
      {category.amenities?.length > 0 && (
        <div className="q-receipt-amenities">
          {category.amenities.map(a => (
            <span key={a} className="q-receipt-amenity">
              {AMENITY_LABELS[a] || a}
            </span>
          ))}
        </div>
      )}

      <hr className="q-receipt-divider" />

      <div className="q-receipt-line">
        <span className="q-receipt-line-label">Price per night</span>
        <span className="q-receipt-line-value">{fmt(pricePerNight)}</span>
      </div>
      <div className="q-receipt-line">
        <span className="q-receipt-line-label">× {nights} night{nights !== 1 ? 's' : ''}</span>
        <span className="q-receipt-line-value">{fmt(subtotal)}</span>
      </div>
      {vatRate > 0 && (
        <div className="q-receipt-line">
          <span className="q-receipt-line-label">VAT ({vatRate}%)</span>
          <span className="q-receipt-line-value">{fmt(vatAmount)}</span>
        </div>
      )}

      <hr className="q-receipt-divider" />

      <div className="q-receipt-total-row">
        <span className="q-receipt-total-label">Total</span>
        <span className="q-receipt-total-amount">{fmt(displayTotal)}</span>
      </div>

      <div className="q-receipt-dates">
        {formatDate(checkIn)} → {formatDate(checkOut)} · {nights} night{nights !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function PayForm({ state, navigate, onSuccess }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [form, setForm] = useState({
    guestName: '', guestEmail: '', guestPhone: '', vesselName: '', eta: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError('');

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}${window.location.pathname}` },
    });

    if (stripeError) {
      setError(stripeError.message || 'Payment failed. Please try again.');
      setBusy(false);
      return;
    }

    try {
      const { data } = await api.post('/public/bookings/engine-request/', {
        check_in:  state.checkIn,
        check_out: state.checkOut,
        ...(state.boatLoa   && { boat_loa:   parseFloat(state.boatLoa) }),
        ...(state.boatBeam  && { boat_beam:  parseFloat(state.boatBeam) }),
        ...(state.boatDraft && { boat_draft: parseFloat(state.boatDraft) }),
        guest_name:  form.guestName,
        guest_email: form.guestEmail,
        guest_phone: form.guestPhone,
        vessel_name: form.vesselName,
        eta:         form.eta || null,
        berth_category_id:  state.selectedCategory?.id ?? null,
        payment_intent_id:  paymentIntent?.id ?? '',
      });
      onSuccess(data.booking?.id);
    } catch (err) {
      if (err.response?.status === 409) {
        navigate('search', { errorBanner: 'Availability changed. Please search again.' });
        return;
      }
      setError('Booking creation failed. Your card was not charged — please contact the marina.');
      setBusy(false);
    }
  };

  const field = (label, key, type = 'text', required = true) => (
    <div className="p-field">
      <label className="p-label">{label}{required ? ' *' : ''}</label>
      <input className="p-input" type={type} required={required}
        value={form[key]} onChange={e => set(key, e.target.value)} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-section-title">Your details</div>
      <div className="p-grid-2">
        {field('Full name', 'guestName')}
        {field('Email', 'guestEmail', 'email')}
      </div>
      <div className="p-grid-2">
        {field('Phone', 'guestPhone', 'tel', false)}
        {field('Vessel name', 'vesselName', 'text', false)}
      </div>
      <div className="p-field" style={{ maxWidth: 200 }}>
        <label className="p-label">Estimated arrival time</label>
        <input className="p-input" type="time" value={form.eta} onChange={e => set('eta', e.target.value)} />
      </div>

      <hr className="q-checkout-divider" />
      <div className="p-section-title">Payment</div>
      <div style={{ marginBottom: 20 }}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}

      <button type="submit" className="p-btn-gold" disabled={busy || !stripe} style={{ width: '100%' }}>
        {busy ? 'Processing…' : `Confirm & Pay €${state.quotedTotal?.toFixed(2)}`}
      </button>
      <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 10 }}>
        Your card will be charged on confirmation. The harbor master assigns your exact slip on arrival.
      </p>
    </form>
  );
}

export default function QuoteScreen({ state, navigate, marina }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [intentError, setIntentError] = useState('');
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);

  useEffect(() => {
    if (!state.selectedCategory) return;
    api.post('/public/bookings/intent/', {
      berth_category_id: state.selectedCategory.id,
      check_in:  state.checkIn,
      check_out: state.checkOut,
    })
      .then(r => setClientSecret(r.data.client_secret))
      .catch(() => setIntentError('Could not initialise payment. Please go back and try again.'));
  }, [state.selectedCategory?.id]);

  function handleSuccess(bookingId) {
    const slug = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
    window.location.href = `/${slug}/booking/${bookingId}/confirmed`;
  }

  const stripeOptions = {
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary:     '#b8965a',
        colorBackground:  '#ede7d8',
        colorText:        '#1a1a1a',
        fontFamily:       'IBM Plex Sans, system-ui, sans-serif',
        borderRadius:     '5px',
      },
    },
  };

  return (
    <div>
      {/* Dark hero */}
      <div className="p-hero" style={{ minHeight: 320 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <button className="p-btn-outline" onClick={() => navigate(state.selectedCategory ? 'options' : (state.fromScreen ?? 'search'))}
            style={{ fontSize: 11, padding: '6px 14px', marginRight: 16 }}>
            ← Back
          </button>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>

        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Complete your booking</div>
          <h1 className="p-title">Review & Pay.</h1>
          <p className="p-sub">
            {formatDate(state.checkIn)} → {formatDate(state.checkOut)} · {nights} night{nights !== 1 ? 's' : ''}
            {state.selectedCategory ? ` · ${state.selectedCategory.name}` : ''}
          </p>
        </div>

        <HarbourScene />
      </div>

      {/* Sandy checkout section */}
      <div className="q-checkout-section">
        <WaveLines />
        <div className="q-checkout-inner">
          <div className="q-checkout-grid">

            {/* Left column — form + payment */}
            <div className="q-checkout-inputs">
              {intentError && <p className="p-error">{intentError}</p>}

              {state.selectedCategory && clientSecret && (
                <Elements stripe={stripePromise} options={stripeOptions}>
                  <PayForm state={state} navigate={navigate} onSuccess={handleSuccess} />
                </Elements>
              )}

              {state.selectedCategory && !clientSecret && !intentError && (
                <p style={{ color: 'rgba(0,0,0,0.55)', fontSize: 13 }}>Preparing payment…</p>
              )}

              {!state.selectedCategory && (
                <FallbackQuoteForm state={state} navigate={navigate} nights={nights} />
              )}
            </div>

            {/* Right column — receipt card (only when a category is selected) */}
            {state.selectedCategory && (
              <ReceiptCard
                category={state.selectedCategory}
                nights={nights}
                total={state.quotedTotal}
                checkIn={state.checkIn}
                checkOut={state.checkOut}
                marina={marina}
              />
            )}
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}

function FallbackQuoteForm({ state, navigate, nights }) {
  const [form, setForm] = useState({ guestName: '', guestEmail: '', guestPhone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/public/bookings/engine-request/', {
        check_in:  state.checkIn, check_out: state.checkOut,
        ...(state.boatLoa   && { boat_loa:   parseFloat(state.boatLoa) }),
        ...(state.boatBeam  && { boat_beam:  parseFloat(state.boatBeam) }),
        ...(state.boatDraft && { boat_draft: parseFloat(state.boatDraft) }),
        guest_name: form.guestName, guest_email: form.guestEmail, guest_phone: form.guestPhone,
      });
      window.location.href = data.checkout_url;
    } catch (err) {
      if (err.response?.status === 409) {
        navigate('search', { errorBanner: 'Availability changed while you were reviewing. Please check your dates again.' });
        return;
      }
      setBusy(false);
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-section-title" style={{ color: 'var(--navy)', opacity: 0.6 }}>Your details</div>
      <div className="p-field"><label htmlFor="fb-name" className="p-label">Full name *</label><input id="fb-name" className="p-input" required value={form.guestName} onChange={e => set('guestName', e.target.value)} /></div>
      <div className="p-field"><label htmlFor="fb-email" className="p-label">Email *</label><input id="fb-email" className="p-input" type="email" required value={form.guestEmail} onChange={e => set('guestEmail', e.target.value)} /></div>
      <div className="p-field"><label htmlFor="fb-phone" className="p-label">Phone</label><input id="fb-phone" className="p-input" type="tel" value={form.guestPhone} onChange={e => set('guestPhone', e.target.value)} /></div>
      {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      <button type="submit" className="p-btn-gold" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Processing…' : 'Book & Pay'}
      </button>
    </form>
  );
}
