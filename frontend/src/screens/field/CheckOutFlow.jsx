import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

function vesselLabel(b) {
  if (b.vessel && typeof b.vessel === 'object') return b.vessel.name || b.guest_name || '—';
  return b.vessel_name || b.guest_name || '—';
}

function berthCode(b) {
  if (b.berth && typeof b.berth === 'object') return b.berth.code;
  return b.berth_code || null;
}

export default function CheckOutFlow({ onBack }) {
  const [allBookings, setAllBookings] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const [checkedOut, setCheckedOut]   = useState(null);

  useEffect(() => {
    api.get('/bookings/', { params: { status: 'checked_in' } })
      .then(r => setAllBookings(r.data.results ?? r.data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = allBookings.filter(b => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (vesselLabel(b).toLowerCase().includes(q)) || ((berthCode(b) || '').toLowerCase().includes(q));
  });

  async function handleCheckOut() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.patch(`/bookings/${selected.id}/`, { status: 'checked_out' });
      setCheckedOut(data);
      setAllBookings(prev => prev.filter(b => b.id !== selected.id));
    } catch {
      setError('Check-out failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (checkedOut) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={onBack}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚪</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Checked Out</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{vesselLabel(selected)}</div>
          {checkedOut.amount && (
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2d4a', marginBottom: 28 }}>
              Invoice: €{Number(checkedOut.amount).toFixed(2)}
            </div>
          )}
          <button style={ACTION_BTN} onClick={onBack}>Back to Actions</button>
        </div>
      </div>
    );
  }

  if (selected) {
    const berth = berthCode(selected);
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={() => { setSelected(null); setError(null); }}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Berth {berth}</div>}
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Arrived: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Departs: {selected.check_out}</div>
            {selected.nights && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Nights: {selected.nights}</div>}
            {selected.amount && (
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2d4a', marginTop: 8 }}>
                Amount: €{Number(selected.amount).toFixed(2)}
              </div>
            )}
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}
          <button style={ACTION_BTN} disabled={saving} onClick={handleCheckOut}>
            {saving ? 'Saving…' : '🚪 Check Out'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
      </div>
      <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', zIndex: 10 }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vessel or berth…"
          style={{ width: '100%', height: 40, padding: '0 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box' }}
        />
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚓</div>
          <div style={{ fontSize: 15 }}>{search ? 'No matches.' : 'No vessels checked in.'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(b => {
            const berth = berthCode(b);
            return (
              <div key={b.id} onClick={() => setSelected(b)}
                style={{ background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(b)}</div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                  {[berth ? `Berth ${berth}` : null, b.check_in].filter(Boolean).join(' · ')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
