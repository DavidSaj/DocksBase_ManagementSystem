import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import api, { createReservationIntent, confirmReservation } from '../api';
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function GuestDetailsForm({ state, marina, onIntentCreated, onNavigateConfirmed, onNavigateAlternatives }) {
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const marinaSlug = marina?.slug || localStorage.getItem('portal_marina_slug') || '';

  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [vesselNames, setVesselNames] = useState(state.boats.map(() => ''));
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const updateVesselName = (idx, val) =>
    setVesselNames(vs => vs.map((v, i) => i === idx ? val : v));

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true); setError('');

    const payload = {
      check_in:    state.checkIn,
      check_out:   state.checkOut,
      guest_name:  name,
      guest_email: email,
      guest_phone: phone,
      items: state.boats.map((boat, i) => ({
        boat_loa:          parseFloat(boat.loa),
        boat_beam:         boat.beam  ? parseFloat(boat.beam)  : null,
        boat_draft:        boat.draft ? parseFloat(boat.draft) : null,
        berth_category_id: boat.category?.id ?? null,
        vessel_name:       vesselNames[i] || '',
      })),
    };

    try {
      const { data } = await createReservationIntent(marinaSlug, payload);

      if (!data.requires_payment) {
        onNavigateConfirmed(data.reference, 'pending_review');
        return;
      }
      onIntentCreated({
        clientSecret:  data.client_secret,
        reservationId: data.reservation_id,
        total:         data.total,
        reference:     data.reference,
        marinaSlug,
      });
    } catch (err) {
      if (err.response?.status === 409) {
        setBusy(false);
        const params = new URLSearchParams({
          check_in:  state.checkIn,
          check_out: state.checkOut,
          boat_loa:  state.boats[0].loa,
        });
        api.get(`/public/bookings/availability-alternatives/?${params}`)
          .then(r => onNavigateAlternatives(r.data))
          .catch(() => onNavigateAlternatives([]));
        return;
      }
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-section-title">Your details</div>
      <div className="p-grid-2">
        <div className="p-field">
          <label className="p-label" htmlFor="guest-name">Full name *</label>
          <input id="guest-name" className="p-input" required value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label" htmlFor="guest-email">Email *</label>
          <input id="guest-email" className="p-input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="p-field" style={{ maxWidth: 220 }}>
        <label className="p-label" htmlFor="guest-phone">Phone</label>
        <input id="guest-phone" className="p-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>

      <div className="p-section-title" style={{ marginTop: 16 }}>Vessel{state.boats.length > 1 ? 's' : ''}</div>
      {state.boats.map((boat, idx) => (
        <div key={idx} className="p-field">
          <label className="p-label">
            {state.boats.length > 1 ? `Boat ${idx + 1} name (${boat.loa}m)` : 'Vessel name'}
          </label>
          <input className="p-input" value={vesselNames[idx]}
            onChange={e => updateVesselName(idx, e.target.value)} placeholder="e.g. Bella Mare" />
        </div>
      ))}

      {error && <p style={{ fontSize: 13, color: '#dc2626', margin: '12px 0' }}>{error}</p>}

      <button type="submit" className="p-btn-gold" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
        {busy ? 'Checking availability…' : 'Continue to payment →'}
      </button>
    </form>
  );
}

function PaymentForm({ intentData, navigate }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const handlePay = async e => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError('');

    const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}${window.location.pathname}` },
    });

    if (stripeErr) {
      setError(stripeErr.message || 'Payment failed. Please try again.');
      setBusy(false);
      return;
    }

    if (!paymentIntent) {
      setBusy(false);
      return;
    }

    try {
      await confirmReservation(intentData.marinaSlug, intentData.reservationId, paymentIntent.id);
      navigate('confirmed', {
        reservationReference: intentData.reference,
        reservationStatus: 'confirmed',
      });
    } catch (err) {
      if (err.response?.status === 409) {
        navigate('confirmed', {
          reservationReference: intentData.reference,
          reservationStatus: 'confirmed',
        });
        return;
      }
      setError('Payment received but confirmation failed. Please contact the marina with reference ' + intentData.reference);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handlePay}>
      <div className="p-section-title">Payment</div>
      <div style={{ marginBottom: 20 }}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      <button type="submit" className="p-btn-gold" disabled={busy || !stripe} style={{ width: '100%' }}>
        {busy ? 'Processing…' : `Confirm & Pay €${parseFloat(intentData.total).toFixed(2)}`}
      </button>
      <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 10 }}>
        Secure payment powered by Stripe.
      </p>
    </form>
  );
}

export default function QuoteScreen({ state, navigate, marina }) {
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const [intentData, setIntentData] = useState(null);

  const stripeOptions = intentData ? {
    clientSecret: intentData.clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#b8965a', colorBackground: '#ede7d8',
        colorText: '#1a1a1a', fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        borderRadius: '5px',
      },
    },
  } : null;

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 320 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <button className="p-btn-outline"
            onClick={() => navigate(state.boats.some(b => b.categories?.length > 0) ? 'options' : 'search')}
            style={{ fontSize: 11, padding: '6px 14px', marginRight: 16 }}>
            ← Back
          </button>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>
        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Complete your booking</div>
          <h1 className="p-title">{intentData ? 'Payment' : 'Your details'}</h1>
          <p className="p-sub">
            {formatDate(state.checkIn)} → {formatDate(state.checkOut)} · {nights} night{nights !== 1 ? 's' : ''}
            {state.boats.length > 1 ? ` · ${state.boats.length} boats` : ''}
          </p>
        </div>
        <HarbourScene />
      </div>

      <div className="q-checkout-section">
        <WaveLines />
        <div className="q-checkout-inner">
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            {!intentData ? (
              <GuestDetailsForm
                state={state}
                marina={marina}
                onIntentCreated={setIntentData}
                onNavigateConfirmed={(ref, status) => navigate('confirmed', {
                  reservationReference: ref,
                  reservationStatus: status,
                })}
                onNavigateAlternatives={alts => navigate('alternatives', { alternatives: alts })}
              />
            ) : (
              <Elements stripe={stripePromise} options={stripeOptions}>
                <PaymentForm intentData={intentData} navigate={navigate} />
              </Elements>
            )}
          </div>
        </div>
        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
