import { useState } from 'react';
import api from '@docksbase/portal-ui/api';
import DateRangePicker from '../components/DateRangePicker';
import { HarbourScene, WaveLines } from '../components/HarbourScene';

const EMPTY_BOAT = { loa: '', beam: '', draft: '', category: null, categories: [] };

export default function SearchScreen({ state, navigate, marina }) {
  const initialBoats = state.boats?.length
    ? state.boats.map(b => ({ ...EMPTY_BOAT, loa: b.loa || '', beam: b.beam || '', draft: b.draft || '' }))
    : [{ ...EMPTY_BOAT }];

  const [checkIn,  setCheckIn]  = useState(state.checkIn  || '');
  const [checkOut, setCheckOut] = useState(state.checkOut || '');
  const [boats,    setBoats]    = useState(initialBoats);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  const nights =
    checkIn && checkOut
      ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
      : 0;

  const updateBoat = (idx, field, value) =>
    setBoats(bs => bs.map((b, i) => i === idx ? { ...b, [field]: value } : b));

  const addBoat = () => setBoats(bs => [...bs, { ...EMPTY_BOAT }]);

  const removeBoat = (idx) =>
    setBoats(bs => bs.filter((_, i) => i !== idx));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!checkIn || !checkOut) return;
    setBusy(true); setError('');

    try {
      const catResults = await Promise.all(
        boats.map(boat => {
          const params = new URLSearchParams({ check_in: checkIn, check_out: checkOut });
          if (boat.loa)   params.set('boat_loa',   boat.loa);
          if (boat.beam)  params.set('boat_beam',  boat.beam);
          if (boat.draft) params.set('boat_draft', boat.draft);
          return api.get(`/public/bookings/berth-categories/?${params}`)
            .then(r => r.data)
            .catch(() => []);
        })
      );

      const updatedBoats = boats.map((boat, i) => ({ ...boat, categories: catResults[i] }));
      const hasAnyCategories = updatedBoats.some(b => b.categories.length > 0);

      if (hasAnyCategories) {
        navigate('options', { checkIn, checkOut, boats: updatedBoats });
      } else {
        navigate('quote', { checkIn, checkOut, boats: updatedBoats });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 360 }}>
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

      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)', paddingBottom: 280 }}>
        <WaveLines />

        <div className="p-form-card">
          <div className="p-form-card-inner" style={{ position: 'relative' }}>
            {state.errorBanner && (
              <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{state.errorBanner}</p>
            )}

            <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <DateRangePicker
                  checkIn={checkIn}
                  checkOut={checkOut}
                  onChange={({ checkIn: ci, checkOut: co }) => { setCheckIn(ci); setCheckOut(co); }}
                />
              </div>

              {boats.map((boat, idx) => (
                <div key={idx} style={{ marginBottom: 16 }}>
                  {boats.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Boat {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeBoat(idx)}
                        style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div className="p-field" style={{ marginBottom: 0 }}>
                      <label className="p-label">Length (m) *</label>
                      <input className="p-input" type="number" step="0.1" min="1" placeholder="e.g. 12"
                        required value={boat.loa} onChange={e => updateBoat(idx, 'loa', e.target.value)} />
                    </div>
                    <div className="p-field" style={{ marginBottom: 0 }}>
                      <label className="p-label">Beam (m)</label>
                      <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 4.2"
                        value={boat.beam} onChange={e => updateBoat(idx, 'beam', e.target.value)} />
                    </div>
                    <div className="p-field" style={{ marginBottom: 0 }}>
                      <label className="p-label">Draft (m)</label>
                      <input className="p-input" type="number" step="0.1" min="0" placeholder="e.g. 1.8"
                        value={boat.draft} onChange={e => updateBoat(idx, 'draft', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addBoat}
                style={{ fontSize: 12, color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px', display: 'block' }}
              >
                + Add another boat
              </button>

              {nights > 0 && (
                <p className="p-nights-note">{nights} night{nights !== 1 ? 's' : ''}</p>
              )}

              <button
                type="submit"
                className="p-btn-gold"
                disabled={busy || !checkIn || !checkOut || boats.some(b => !b.loa)}
                style={{ width: '100%', marginTop: 8 }}
              >
                {busy ? 'Checking…' : 'Check availability →'}
              </button>

              {error && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 12 }}>{error}</p>}
            </form>
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
