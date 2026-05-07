import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import api from '../api';
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
      <div className="p-section-title" style={{ color: 'var(--navy)', opacity: 0.6 }}>Your details</div>
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

      <div className="p-section-title" style={{ marginTop: 24, color: 'var(--navy)', opacity: 0.6 }}>Payment</div>
      <div style={{ border: '1px solid #e8e8e8', borderRadius: 8, padding: 20, marginBottom: 20 }}>
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
      variables: { colorPrimary: '#b8965a', fontFamily: 'IBM Plex Sans, system-ui, sans-serif' },
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

      {/* White section */}
      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />
        <div className="p-form-card">
          <div className="p-form-card-inner">

            {/* Summary bar */}
            <div style={{
              background: '#f7f7f7', border: '1px solid #ebebeb', borderRadius: 8,
              padding: '14px 20px', marginBottom: 24,
              display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Category</div>
                <div style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 500 }}>{state.selectedCategory?.name ?? 'Best available berth'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Dates</div>
                <div style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 500 }}>{formatDate(state.checkIn)} – {formatDate(state.checkOut)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Nights</div>
                <div style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 500 }}>{nights}</div>
              </div>
              <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-serif)', fontSize: 24, color: 'var(--gold)' }}>
                €{state.quotedTotal?.toFixed(2)}
              </div>
            </div>

            {intentError && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{intentError}</p>}

            {state.selectedCategory && clientSecret && (
              <Elements stripe={stripePromise} options={stripeOptions}>
                <PayForm state={state} navigate={navigate} onSuccess={handleSuccess} />
              </Elements>
            )}

            {state.selectedCategory && !clientSecret && !intentError && (
              <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>Preparing payment…</p>
            )}

            {!state.selectedCategory && (
              <FallbackQuoteForm state={state} navigate={navigate} nights={nights} />
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
        navigate('search', { errorBanner: 'Availability changed. Please search again.' });
        return;
      }
      setBusy(false);
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-section-title" style={{ color: 'var(--navy)', opacity: 0.6 }}>Your details</div>
      <div className="p-field"><label className="p-label">Full name *</label><input className="p-input" required value={form.guestName} onChange={e => set('guestName', e.target.value)} /></div>
      <div className="p-field"><label className="p-label">Email *</label><input className="p-input" type="email" required value={form.guestEmail} onChange={e => set('guestEmail', e.target.value)} /></div>
      <div className="p-field"><label className="p-label">Phone</label><input className="p-input" type="tel" value={form.guestPhone} onChange={e => set('guestPhone', e.target.value)} /></div>
      {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      <button type="submit" className="p-btn-gold" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Processing…' : `Book & Pay €${state.quotedTotal?.toFixed(2)}`}
      </button>
    </form>
  );
}
