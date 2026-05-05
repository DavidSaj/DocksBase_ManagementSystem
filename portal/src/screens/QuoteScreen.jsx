import { useState } from 'react';
import api from '../api';

const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 };
const card = { background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };
const labelStyle = { display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 5, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6 };

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function QuoteScreen({ state, navigate, marina }) {
  const [form, setForm] = useState({ guestName: '', guestEmail: '', guestPhone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/public/bookings/engine-request/', {
        check_in: state.checkIn,
        check_out: state.checkOut,
        ...(state.boatLoa && { boat_loa: parseFloat(state.boatLoa) }),
        ...(state.boatBeam && { boat_beam: parseFloat(state.boatBeam) }),
        ...(state.boatDraft && { boat_draft: parseFloat(state.boatDraft) }),
        guest_name: form.guestName,
        guest_email: form.guestEmail,
        guest_phone: form.guestPhone,
      });
      window.location.href = data.checkout_url;
    } catch (err) {
      if (err.response?.status === 409) {
        navigate('search', { errorBanner: 'Availability changed while you were reviewing. Please check your dates again.' });
        return;
      }
      setBusy(false);
      setError('Something went wrong, please try again.');
    }
  };

  const field = (labelText, key, type = 'text') => (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={key} style={labelStyle}>{labelText}</label>
      <input
        id={key}
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        required={key !== 'guestPhone'}
        style={inputStyle}
      />
    </div>
  );

  return (
    <div style={page}>
      <div style={card}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{marina?.name}</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 20px' }}>Confirm your booking</p>

        <div style={{ background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '14px 16px', marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            {formatDate(state.checkIn)} – {formatDate(state.checkOut)}
          </div>
          <div style={{ color: 'rgba(0,0,0,0.55)', fontSize: 13, marginBottom: 8 }}>
            {nights} night{nights !== 1 ? 's' : ''} · pontoon berth, suitable for your vessel
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>€{state.quotedTotal?.toFixed(2)}</div>
        </div>

        <form onSubmit={handleSubmit}>
          {field('Full name', 'guestName')}
          {field('Email address', 'guestEmail', 'email')}
          {field('Phone number', 'guestPhone', 'tel')}

          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '12px 0', background: busy ? '#94a3b8' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 4 }}
          >
            {busy ? 'Processing…' : 'Book & Pay'}
          </button>
        </form>
      </div>
    </div>
  );
}
