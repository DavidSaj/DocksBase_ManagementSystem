import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

function Topbar({ onBack, title }) {
  return (
    <div className="f-topbar">
      <button className="f-dw-back" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
        Back
      </button>
      <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>{title}</span>
      <span style={{ width: 50 }} />
    </div>
  );
}

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
    <div className="f-screen">
      <Topbar onBack={onBack} title="Check In" />
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <Icon name="check-circle" size={56} color="var(--db-status-green)" strokeWidth={1.5} />
        </div>
        <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 24, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 6 }}>Checked In</div>
        <div style={{ fontSize: 14, color: 'var(--db-on-dark-muted)', marginBottom: 28 }}>{vesselLabel(selected)}</div>
        <button className="f-btn-primary" style={{ width: '100%' }} onClick={onBack}>Back to Actions</button>
      </div>
    </div>
  );

  if (selected) {
    const berth = berthLabel(selected);
    return (
      <div className="f-screen">
        <Topbar onBack={() => setSelected(null)} title="Check In" />
        <div style={{ padding: 20 }}>
          <div className="f-card" style={{ margin: '0 0 16px' }}>
            <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{vesselLabel(selected)}</div>
            {berth && <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 4 }}>Berth {berth}</div>}
            <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 4 }}>Arriving: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)' }}>Departing: {selected.check_out}</div>
          </div>
          {error && <div style={{ color: 'var(--db-status-red)', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{error}</div>}
          <button className="f-btn-primary" style={{ width: '100%' }} disabled={saving} onClick={handleCheckIn}>{saving ? 'Saving…' : 'Check In'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="f-screen">
      <Topbar onBack={onBack} title="Today's Arrivals" />
      {loading ? (
        <div className="f-dw-loading">Loading…</div>
      ) : bookings.length === 0 ? (
        <div className="f-dw-loading" style={{ padding: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="anchor" size={36} color="var(--db-on-dark-faint)" />
          </div>
          <div style={{ fontSize: 15 }}>No pending arrivals today.</div>
        </div>
      ) : (
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
          {bookings.map(b => {
            const berth = berthLabel(b);
            return (
              <div key={b.id} className="f-card" style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
                <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{vesselLabel(b)}</div>
                {berth && <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)' }}>Berth {berth}</div>}
                <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)' }}>{b.check_in} → {b.check_out}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
