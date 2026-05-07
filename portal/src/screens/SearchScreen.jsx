import { useState } from 'react';
import api from '../api';
import DateRangePicker from '../components/portal/DateRangePicker';
import { HarbourScene, WaveLines } from '../components/portal/HarbourScene';

export default function SearchScreen({ state, navigate, marina }) {
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
    if (!form.checkIn || !form.checkOut) return;
    setBusy(true); setError('');
    const params = new URLSearchParams({ check_in: form.checkIn, check_out: form.checkOut });
    if (form.boatLoa)   params.set('boat_loa',   form.boatLoa);
    if (form.boatBeam)  params.set('boat_beam',  form.boatBeam);
    if (form.boatDraft) params.set('boat_draft', form.boatDraft);

    try {
      const { data: cats } = await api.get(`/public/bookings/berth-categories/?${params}`);
      if (cats.length > 0) { navigate('options', { ...form, categories: cats }); return; }

      const { data: berths } = await api.get(`/public/bookings/available-berths/?${params}`);
      if (berths.length > 0) {
        const price = parseFloat(berths[0].pricing_tier_unit_price || 0);
        navigate('quote', { ...form, quotedPrice: price, quotedTotal: price * nights, selectedCategory: null });
        return;
      }
      const { data: alts } = await api.get(`/public/bookings/availability-alternatives/?${params}`);
      if (alts.length > 0) { navigate('alternatives', { ...form, alternatives: alts }); return; }
      setError('No availability for those dates or vessel size. Please contact the marina directly.');
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      {/* Dark hero */}
      <div className="p-hero" style={{ minHeight: 320 }}>
        <nav style={{
          maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>

        <div className="p-hero-inner">
          <div className="p-eyebrow">Online Reservations</div>
          <h1 className="p-title">Book a Berth</h1>
          <p className="p-sub">Check real-time availability and reserve your spot.</p>
        </div>

        <HarbourScene />
      </div>

      {/* White background section — wave lines sit here, behind the card */}
      <div style={{ position: 'relative', background: '#fff' }}>
        <WaveLines />

      {/* White form card — overlaps hero bottom */}
      <div className="p-form-card">
        <div className="p-form-card-inner" style={{ position: 'relative' }}>

          {state.errorBanner && (
            <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 16, position: 'relative' }}>{state.errorBanner}</p>
          )}

          <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
            {/* Date range picker spans both columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <DateRangePicker
                checkIn={form.checkIn}
                checkOut={form.checkOut}
                onChange={({ checkIn, checkOut }) => setForm(f => ({ ...f, checkIn, checkOut }))}
              />
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Vessel length (m)</label>
                <input className="p-input" type="number" step="0.1" min="1" placeholder="e.g. 12"
                  value={form.boatLoa} onChange={e => set('boatLoa', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Beam (m) — optional</label>
                <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 4.2"
                  value={form.boatBeam} onChange={e => set('boatBeam', e.target.value)} />
              </div>
              <div className="p-field" style={{ marginBottom: 0 }}>
                <label className="p-label">Draft (m) — optional</label>
                <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 1.8"
                  value={form.boatDraft} onChange={e => set('boatDraft', e.target.value)} />
              </div>
              <button type="submit" className="p-btn-gold" disabled={busy || !form.checkIn || !form.checkOut}
                style={{ whiteSpace: 'nowrap', height: 41 }}>
                {busy ? 'Checking…' : 'Check availability →'}
              </button>
            </div>

            {nights > 0 && (
              <p className="p-nights-note" style={{ marginTop: 10 }}>
                {nights} night{nights !== 1 ? 's' : ''}
              </p>
            )}
            {error && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 12 }}>{error}</p>}
          </form>
        </div>
      </div>

      <p className="p-powered">Powered by DocksBase</p>
      </div> {/* end white section */}
    </div>
  );
}
