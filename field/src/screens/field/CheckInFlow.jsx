import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const HDR = { background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const CARD = { background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

function todayStr() { return new Date().toISOString().slice(0, 10); }
function vesselLabel(b) {
  if (b.vessel && typeof b.vessel === 'object') return b.vessel.name || b.guest_name || '—';
  return b.vessel_name || b.guest_name || '—';
}
function berthLabel(b) {
  if (b.berth && typeof b.berth === 'object') return b.berth.code;
  return b.berth_code || null;
}

export default function CheckInFlow({ onBack }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    const today = todayStr();
    Promise.all([
      api.get('/bookings/', { params: { status: 'pending',    check_in: today } }),
      api.get('/bookings/', { params: { status: 'confirmed',  check_in: today } }),
    ]).then(([r1, r2]) => {
      const all = [...(r1.data.results ?? r1.data), ...(r2.data.results ?? r2.data)];
      setBookings(all);
    }).finally(() => setLoading(false));
  }, []);

  async function handleCheckIn() {
    setSaving(true); setError(null);
    try {
      await api.patch(`/bookings/${selected.id}/`, { status: 'checked_in' });
      setDone(true);
    } catch {
      setError('Check-in failed. Please try again.');
    } finally { setSaving(false); }
  }

  if (done) return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={HDR}><button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button><span style={{ fontSize: 16, fontWeight: 700 }}>Check In</span></div>
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <Icon name="check-circle" size={56} color="#27ae60" strokeWidth={1.5} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Checked In</div>
        <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 28 }}>{vesselLabel(selected)}</div>
        <button style={ACTION_BTN} onClick={onBack}>Back to Actions</button>
      </div>
    </div>
  );

  if (selected) {
    const berth = berthLabel(selected);
    return (
      <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
        <div style={HDR}><button style={BACK_BTN} onClick={() => setSelected(null)}><Icon name="arrow-left" size={22} color="#fff" /></button><span style={{ fontSize: 16, fontWeight: 700 }}>Check In</span></div>
        <div style={{ padding: 20 }}>
          <div style={{ ...CARD, cursor: 'default', marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Berth {berth}</div>}
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Arriving: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Departing: {selected.check_out}</div>
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}
          <button style={ACTION_BTN} disabled={saving} onClick={handleCheckIn}>{saving ? 'Saving…' : 'Check In'}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={HDR}><button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button><span style={{ fontSize: 16, fontWeight: 700 }}>Today's Arrivals</span></div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : bookings.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="anchor" size={36} color="rgba(0,0,0,0.25)" />
          </div>
          <div style={{ fontSize: 15 }}>No pending arrivals today.</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bookings.map(b => {
            const berth = berthLabel(b);
            return (
              <div key={b.id} style={CARD} onClick={() => setSelected(b)}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(b)}</div>
                {berth && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Berth {berth}</div>}
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{b.check_in} → {b.check_out}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
