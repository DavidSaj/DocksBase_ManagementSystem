import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function vesselLabel(b) {
  if (b.vessel && typeof b.vessel === 'object') return b.vessel.name || b.guest_name || '—';
  return b.vessel_name || b.guest_name || '—';
}

function berthCode(b) {
  if (b.berth && typeof b.berth === 'object') return b.berth.code;
  return b.berth_code || null;
}

const STATUS_PILL = { pending: 'f-pill f-pill--gold', checked_in: 'f-pill f-pill--green', confirmed: 'f-pill f-pill--gold' };

function Section({ label, items }) {
  if (!items.length) return null;
  return (
    <>
      <div className="f-section-title">{label}</div>
      {items.map(b => {
        const berth = berthCode(b);
        return (
          <div key={b.id} className="f-card">
            <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{vesselLabel(b)}</div>
            <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)', marginBottom: 8 }}>
              {[berth ? `Berth ${berth}` : null, `${b.check_in} → ${b.check_out}`].filter(Boolean).join(' · ')}
            </div>
            <span className={STATUS_PILL[b.status] || 'f-pill'}>
              {b.status}
            </span>
          </div>
        );
      })}
    </>
  );
}

export default function ArrivalsList({ onBack }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading]   = useState(true);

  const today    = dateStr(0);
  const tomorrow = dateStr(1);

  useEffect(() => {
    Promise.all([
      api.get('/bookings/', { params: { status: 'pending',   check_in: today } }),
      api.get('/bookings/', { params: { status: 'confirmed', check_in: today } }),
      api.get('/bookings/', { params: { status: 'pending',   check_in: tomorrow } }),
      api.get('/bookings/', { params: { status: 'confirmed', check_in: tomorrow } }),
    ]).then(results => {
      const all = results.flatMap(r => r.data.results ?? r.data);
      setBookings(all);
    }).finally(() => setLoading(false));
  }, []);

  const todayList    = bookings.filter(b => b.check_in === today);
  const tomorrowList = bookings.filter(b => b.check_in === tomorrow);

  return (
    <div className="f-screen">
      <div className="f-topbar">
        <button className="f-dw-back" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
          Back
        </button>
        <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>Arrivals</span>
        <span style={{ width: 50 }} />
      </div>
      {loading ? (
        <div className="f-dw-loading">Loading…</div>
      ) : bookings.length === 0 ? (
        <div className="f-dw-loading" style={{ padding: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="ship" size={36} color="var(--db-on-dark-faint)" />
          </div>
          <div style={{ fontSize: 15 }}>No arrivals today or tomorrow.</div>
        </div>
      ) : (
        <div style={{ paddingBottom: 24 }}>
          <Section label="Today" items={todayList} />
          <Section label="Tomorrow" items={tomorrowList} />
        </div>
      )}
    </div>
  );
}
