import Ic from '../components/ui/Icon.jsx';
import { useBerths } from '../hooks/useBerths.js';
import useBookings from '../hooks/useBookings.js';

const ACTIVITY_FEED = [
  { text: 'Nomad III checked in to Slip A2', time: '08:14',      color: '#38a860' },
  { text: 'Invoice INV-2041 marked paid',    time: '07:52',      color: '#3a7fc8' },
  { text: 'Maintenance flag raised — Pier B cleat', time: '07:30', color: '#e08020' },
  { text: 'Blue Horizon departed Slip C1',   time: 'Yesterday',  color: '#b8965a' },
  { text: 'New booking BK-1048 created',     time: 'Yesterday',  color: '#38a860' },
  { text: 'Insurance expired — Saltwater',   time: 'Yesterday',  color: '#c04040' },
];

export default function Overview({ setScreen }) {
  const { counts, loading: bLoading } = useBerths();
  const { bookings: pending, loading: pkLoading, updateBooking } = useBookings({ status: 'pending' });

  const stats = [
    {
      label: 'Berths Occupied',
      val:   bLoading ? '…' : `${counts.occupied}/${counts.total}`,
      sub:   `${counts.maintenance} in maintenance`,
      trend: '+3', up: true,
    },
    { label: 'Arrivals Today',   val: '5',             sub: 'Next: 11:00',        trend: 'On time', up: true },
    {
      label: 'Available Slips',
      val:   bLoading ? '…' : counts.available,
      sub:   'Across piers',
      trend: '−2 vs yesterday', up: false,
    },
    { label: 'Pending Payments', val: '3',             sub: '€1,190 outstanding', trend: 'Overdue: 1', up: false },
    { label: 'Open Tasks',       val: '6',             sub: '2 high priority',    trend: '2 unassigned', up: false },
  ];

  async function confirmBooking(b) {
    await updateBooking(b.id, { status: 'confirmed' });
  }

  return (
    <div>
      <div className="stat-row">
        {stats.map(s => (
          <div key={s.label} className="card stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-val">{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
            <div className={`stat-trend ${s.up ? 'up' : 'dn'}`}>{s.trend}</div>
          </div>
        ))}
      </div>

      <div className="grid-a" style={{ alignItems: 'start' }}>
        {/* Activity Log */}
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Activity Log</div>
            <button className="btn btn-ghost btn-sm">View all</button>
          </div>
          <div className="card-body">
            {ACTIVITY_FEED.map((a, i) => (
              <div key={i} className="act-item">
                <div className="act-dot" style={{ background: a.color }} />
                <div>
                  <div className="act-text">{a.text}</div>
                  <div className="act-time">{a.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Weather */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Today's Weather</div>
              <span className="badge badge-green" style={{ fontSize: 10 }}>Live</span>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[['14°C','Temperature'],['12kn SW','Wind'],['0.6m','Swell'],['8km','Visibility']].map(([v,l]) => (
                  <div key={l} style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 12px' }}>
                    <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.5px' }}>{v}</div>
                    <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Low tide 14:22 · 1.2m</span><span>High tide 20:48 · 3.8m</span>
              </div>
            </div>
          </div>

          {/* Urgent */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Urgent</div>
              <span className="badge badge-red">3</span>
            </div>
            <div className="card-body" style={{ padding: '8px 18px' }}>
              {[
                { color: 'var(--red)',    text: 'Saltwater — insurance EXPIRED. Do not extend stay.' },
                { color: 'var(--orange)', text: 'BK-1045 overdue payment — €330 due 3 days ago.' },
                { color: 'var(--orange)', text: 'Pier B cleat inspection required — safety flag.' },
              ].map((a, i) => (
                <div key={i} className="act-item">
                  <div className="act-dot" style={{ background: a.color }} />
                  <div className="act-text" style={{ fontSize: 11 }}>{a.text}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Pending Bookings */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Pending Bookings</div>
              {!pkLoading && pending.length > 0 && (
                <span className="badge badge-gold">{pending.length}</span>
              )}
            </div>
            <div style={{ padding: '4px 8px 8px' }}>
              {pkLoading ? (
                <div style={{ padding: '12px 10px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
              ) : pending.length === 0 ? (
                <div style={{ padding: '12px 10px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No pending bookings.</div>
              ) : (
                pending.map(b => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: 'var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{b.vessel_name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>{b.check_in} · Slip {b.berth_code}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => confirmBooking(b)}>Confirm</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
