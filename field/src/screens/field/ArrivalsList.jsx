import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const HDR = { background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };

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

const STATUS_COLOR = { pending: '#e67e22', checked_in: '#27ae60', confirmed: '#2980b9' };

function Section({ label, items }) {
  if (!items.length) return null;
  return (
    <>
      <div style={{ padding: '12px 16px 6px', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)' }}>{label}</div>
      {items.map(b => {
        const berth = berthCode(b);
        return (
          <div key={b.id} style={{ margin: '0 16px 10px', background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{vesselLabel(b)}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 6 }}>
              {[berth ? `Berth ${berth}` : null, `${b.check_in} → ${b.check_out}`].filter(Boolean).join(' · ')}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: STATUS_COLOR[b.status] || '#aaa', color: '#fff' }}>
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
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Arrivals</span>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : bookings.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="ship" size={36} color="rgba(0,0,0,0.25)" />
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
