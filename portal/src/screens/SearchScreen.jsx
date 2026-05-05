import { useState } from 'react';
import api from '../api';

const card = { background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };
const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 };
const labelStyle = { display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 5, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6 };

export default function SearchScreen({ state, navigate, marina }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    checkIn: state.checkIn || '',
    checkOut: state.checkOut || '',
    boatLoa: state.boatLoa || '',
    boatBeam: state.boatBeam || '',
    boatDraft: state.boatDraft || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const nights =
    form.checkIn && form.checkOut
      ? Math.round((new Date(form.checkOut) - new Date(form.checkIn)) / 86400000)
      : 0;

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const params = new URLSearchParams({ check_in: form.checkIn, check_out: form.checkOut, boat_loa: form.boatLoa, boat_beam: form.boatBeam });
    if (form.boatDraft) params.set('boat_draft', form.boatDraft);
    try {
      const { data: berths } = await api.get(`/public/bookings/available-berths/?${params}`);
      if (berths.length > 0) {
        const pricePerNight = parseFloat(berths[0].pricing_tier_unit_price);
        navigate('quote', { ...form, quotedPrice: pricePerNight, quotedTotal: pricePerNight * nights });
        return;
      }
      const { data: alternatives } = await api.get(`/public/bookings/availability-alternatives/?${params}`);
      if (alternatives.length > 0) {
        navigate('alternatives', { ...form, alternatives });
        return;
      }
      setError('No availability for those dates or nearby alternatives. Please contact the marina directly.');
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = (labelText, id, type = 'text', extra = {}) => (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} style={labelStyle}>{labelText}</label>
      <input
        id={id}
        type={type}
        value={form[id]}
        min={type === 'date' ? today : undefined}
        onChange={e => set(id, e.target.value)}
        style={inputStyle}
        {...extra}
      />
    </div>
  );

  return (
    <div style={page}>
      <div style={card}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{marina?.name}</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 28px' }}>Find a berth</p>

        {state.errorBanner && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
            {state.errorBanner}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{field('Check-in', 'checkIn', 'date')}</div>
            <div>{field('Check-out', 'checkOut', 'date', { min: form.checkIn || today })}</div>
          </div>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>
            Vessel dimensions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>{field('LOA (m)', 'boatLoa', 'number', { step: '0.1', min: '0', placeholder: '12.5' })}</div>
            <div>{field('Beam (m)', 'boatBeam', 'number', { step: '0.1', min: '0', placeholder: '4.2' })}</div>
            <div>{field('Draft (m)', 'boatDraft', 'number', { step: '0.1', min: '0', placeholder: '1.8' })}</div>
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '12px 0', background: busy ? '#94a3b8' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 8 }}
          >
            {busy ? 'Checking…' : 'Check Availability'}
          </button>
        </form>
      </div>
    </div>
  );
}
