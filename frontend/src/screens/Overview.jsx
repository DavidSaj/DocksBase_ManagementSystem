import useBerths from '../hooks/useBerths.js';
import useBookings from '../hooks/useBookings.js';
import useOverview from '../hooks/useOverview.js';
import useWeather from '../hooks/useWeather.js';
import useMarina from '../hooks/useMarina.js';
import SetupGuide from '../components/onboarding/SetupGuide.jsx';

function relativeTime(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  if (hrs < 48) return 'Yesterday';
  return new Date(isoStr).toLocaleDateString();
}

function fmt(amount, currency = 'EUR') {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export default function Overview({ setScreen }) {
  const { counts, loading: bLoading } = useBerths();
  const { bookings: pending, loading: pkLoading, updateBooking } = useBookings({ status: 'pending' });
  const { overview, loading: ovLoading } = useOverview();
  const { marina } = useMarina();
  const { weather, loading: wLoading } = useWeather(marina?.lat, marina?.lng);

  const ov = overview ?? {};
  const currency = marina?.currency ?? 'EUR';

  const stats = [
    {
      label: 'Berths Occupied',
      val:   bLoading ? '…' : `${counts.occupied}/${counts.total}`,
      sub:   bLoading ? '' : `${counts.maintenance} in maintenance`,
      trend: bLoading || !counts.total ? '' : `${Math.round((counts.occupied / counts.total) * 100)}% full`,
      up:    counts.occupied > 0,
    },
    {
      label: 'Arrivals Today',
      val:   ovLoading ? '…' : (ov.arrivals_today ?? '—'),
      sub:   'Confirmed check-ins',
      trend: '',
      up:    true,
    },
    {
      label: 'Available Slips',
      val:   bLoading ? '…' : counts.available,
      sub:   'Across all piers',
      trend: '',
      up:    counts.available > 0,
    },
    {
      label: 'Pending Payments',
      val:   ovLoading ? '…' : (ov.pending_payments_count ?? '—'),
      sub:   ovLoading ? '' : (ov.pending_payments_amount > 0 ? `${fmt(ov.pending_payments_amount, currency)} outstanding` : 'All clear'),
      trend: ovLoading ? '' : (ov.overdue_count > 0 ? `Overdue: ${ov.overdue_count}` : ''),
      up:    false,
    },
    {
      label: 'Open Tasks',
      val:   ovLoading ? '…' : (ov.open_tasks_count ?? '—'),
      sub:   ovLoading ? '' : (ov.high_priority_count > 0 ? `${ov.high_priority_count} high priority` : 'No urgent tasks'),
      trend: ovLoading ? '' : (ov.unassigned_count > 0 ? `${ov.unassigned_count} unassigned` : ''),
      up:    false,
    },
  ];

  async function confirmBooking(b) {
    await updateBooking(b.id, { status: 'confirmed' });
  }

  const urgentAlerts = ov.urgent_alerts ?? [];
  const activity = ov.recent_activity ?? [];

  return (
    <div>
      <SetupGuide setScreen={setScreen} />
      <div className="stat-row">
        {stats.map(s => (
          <div key={s.label} className="card stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-val">{s.val}</div>
            <div className="stat-sub">{s.sub}</div>
            {s.trend && <div className={`stat-trend ${s.up ? 'up' : 'dn'}`}>{s.trend}</div>}
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
            {ovLoading ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>Loading…</div>
            ) : activity.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>No recent activity.</div>
            ) : activity.map((a, i) => (
              <div key={i} className="act-item">
                <div className="act-dot" style={{ background: a.color }} />
                <div>
                  <div className="act-text">{a.text}</div>
                  <div className="act-time">{relativeTime(a.ts)}</div>
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
              {marina?.lat && weather && (
                <span className="badge badge-green" style={{ fontSize: 10 }}>Live · {weather.updatedAt}</span>
              )}
            </div>
            <div className="card-body">
              {!marina?.lat ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: 1.5 }}>
                  Set your marina's location in{' '}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0 4px', fontSize: 12, height: 'auto' }}
                    onClick={() => setScreen('settings')}
                  >
                    Settings
                  </button>{' '}
                  to see live weather.
                </div>
              ) : wLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
              ) : weather ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[
                      [weather.temp, 'Temperature'],
                      [weather.wind, 'Wind'],
                      [weather.swell, 'Wave height'],
                      [weather.condition, 'Conditions'],
                    ].map(([v, l]) => (
                      <div key={l} style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
                        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Weather unavailable.</div>
              )}
            </div>
          </div>

          {/* Urgent */}
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Urgent</div>
              {urgentAlerts.length > 0 && (
                <span className="badge badge-red">{urgentAlerts.length}</span>
              )}
            </div>
            <div className="card-body" style={{ padding: '8px 18px' }}>
              {ovLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
              ) : urgentAlerts.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No urgent items.</div>
              ) : urgentAlerts.map((a, i) => (
                <div key={i} className="act-item">
                  <div className="act-dot" style={{ background: a.severity === 'red' ? 'var(--red)' : 'var(--orange)' }} />
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
