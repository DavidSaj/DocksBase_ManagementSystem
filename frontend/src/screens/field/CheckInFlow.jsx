import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const CARD = { background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function vesselLabel(b) {
  // Handle both flat and nested serializer responses
  if (b.vessel && typeof b.vessel === 'object') return b.vessel.name || b.guest_name || '—';
  return b.vessel_name || b.guest_name || '—';
}

function berthLabel(b) {
  if (b.berth && typeof b.berth === 'object') return b.berth.code;
  return b.berth_code || null;
}

export default function CheckInFlow({ onBack }) {
  const [bookings, setBookings]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const [done, setDone]           = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    api.get('/bookings/', { params: { status: 'pending' } })
      .then(r => {
        const today = todayStr();
        const data = r.data.results ?? r.data;
        setBookings(data.filter(b => b.check_in === today));
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleCheckIn() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/bookings/${selected.id}/`, { status: 'checked_in' });
      setDone(true);
    } catch {
      setError('Check-in failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={onBack}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check In</span>
        </div>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Checked In</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 28 }}>{vesselLabel(selected)}</div>
          <button style={ACTION_BTN} onClick={onBack}>Back to Actions</button>
        </div>
      </div>
    );
  }

  if (selected) {
    const berth = berthLabel(selected);
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={() => setSelected(null)}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check In</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ ...CARD, cursor: 'default', marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Berth {berth}</div>}
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Arriving: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Departing: {selected.check_out}</div>
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}
          <button style={ACTION_BTN} disabled={saving} onClick={handleCheckIn}>
            {saving ? 'Saving…' : '✅ Check In'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Today's Arrivals</span>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : bookings.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚓</div>
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
