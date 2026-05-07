import { useState } from 'react';
import api from '../api';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function SearchScreen({ state, navigate, marina }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    checkIn:   state.checkIn   || '',
    checkOut:  state.checkOut  || '',
    boatLoa:   state.boatLoa   || '',
    boatBeam:  state.boatBeam  || '',
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
    setBusy(true); setError('');
    const params = new URLSearchParams({
      check_in:  form.checkIn,
      check_out: form.checkOut,
    });
    if (form.boatLoa)   params.set('boat_loa',   form.boatLoa);
    if (form.boatBeam)  params.set('boat_beam',  form.boatBeam);
    if (form.boatDraft) params.set('boat_draft', form.boatDraft);

    try {
      // Try berth-categories first (marina with configured tiers)
      const { data: cats } = await api.get(`/public/bookings/berth-categories/?${params}`);
      if (cats.length > 0) {
        navigate('options', { ...form, categories: cats });
        return;
      }
      // Fallback: plain availability check
      const { data: berths } = await api.get(`/public/bookings/available-berths/?${params}`);
      if (berths.length > 0) {
        const pricePerNight = parseFloat(berths[0].pricing_tier_unit_price || 0);
        navigate('quote', { ...form, quotedPrice: pricePerNight, quotedTotal: pricePerNight * nights, selectedCategory: null });
        return;
      }
      const { data: alts } = await api.get(`/public/bookings/availability-alternatives/?${params}`);
      if (alts.length > 0) {
        navigate('alternatives', { ...form, alternatives: alts });
        return;
      }
      setError('No availability for those dates or dimensions. Please contact the marina directly.');
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
        {marina && <span className="p-nav-marina">— {marina.name}</span>}
      </nav>
      <div className="p-shell">
        <div className="p-eyebrow">Berth booking</div>
        <h1 className="p-title">Find a berth.</h1>
        <p className="p-sub">Enter your dates and vessel dimensions to check availability.</p>

        {state.errorBanner && (
          <div className="p-error" style={{ marginBottom: 20 }}>{state.errorBanner}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="p-grid-2" style={{ marginBottom: 0 }}>
            <div className="p-field">
              <label className="p-label">Arrival date</label>
              <input className="p-input" type="date" required min={today}
                value={form.checkIn} onChange={e => set('checkIn', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Departure date</label>
              <input className="p-input" type="date" required min={form.checkIn || today}
                value={form.checkOut} onChange={e => set('checkOut', e.target.value)} />
            </div>
          </div>
          {nights > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              {nights} night{nights !== 1 ? 's' : ''} · {formatDate(form.checkIn)} → {formatDate(form.checkOut)}
            </p>
          )}

          <div className="p-section-title" style={{ marginTop: 8 }}>Vessel dimensions</div>
          <div className="p-grid-3">
            <div className="p-field">
              <label className="p-label">LOA (m)</label>
              <input className="p-input" type="number" step="0.1" min="1" placeholder="12.5"
                value={form.boatLoa} onChange={e => set('boatLoa', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Beam (m)</label>
              <input className="p-input" type="number" step="0.1" min="0" placeholder="4.2"
                value={form.boatBeam} onChange={e => set('boatBeam', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Draft (m)</label>
              <input className="p-input" type="number" step="0.1" min="0" placeholder="1.8"
                value={form.boatDraft} onChange={e => set('boatDraft', e.target.value)} />
            </div>
          </div>

          {error && <p className="p-error">{error}</p>}

          <button type="submit" className="p-btn-gold" disabled={busy} style={{ marginTop: 8, width: '100%' }}>
            {busy ? 'Checking…' : 'Search'}
          </button>
        </form>
      </div>
    </>
  );
}
