import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  available:   'badge-green',
  occupied:    'badge-blue',
  reserved:    'badge-gold',
  maintenance: 'badge-red',
};

const OP_TYPE_BADGE = {
  permanent:  'badge-blue',
  transient:  'badge-gray',
  reserved:   'badge-gold',
};

const CATEGORY_BADGE = {
  wet:     'badge-blue',
  dry:     'badge-gray',
  mooring: 'badge-green',
};

const AVAIL_COLORS = {
  occupied:    '#e74c3c',
  available:   '#2ecc71',
  maintenance: '#f39c12',
  reserved:    '#f1c40f',
  unknown:     '#ecf0f1',
};

const TABS = [
  ['grid',         'Berth Grid'],
  ['availability', 'Availability Matrix'],
  ['stats',        'Occupancy Stats'],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d) {
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${m[d.getMonth()]}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

// ─── Loading / Empty helpers ──────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" style={{ marginRight: 8, animation: 'spin 1s linear infinite' }}>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="40 20" />
      </svg>
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function EmptyState({ title, sub }) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center' }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>{sub}</div>}
    </div>
  );
}

// ─── Status Toggle ────────────────────────────────────────────────────────────

function StatusToggle({ berth, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const nextStatus = berth.status === 'available' ? 'maintenance' : 'available';

  async function toggle(e) {
    e.stopPropagation();
    setBusy(true);
    try {
      await api.patch(`/berths/${berth.id}/`, { status: nextStatus });
      onUpdated();
    } catch {
      // silently fail — table will still show current state
    } finally {
      setBusy(false);
    }
  }

  const canToggle = berth.status === 'available' || berth.status === 'maintenance';

  return (
    <button
      onClick={toggle}
      disabled={busy || !canToggle}
      title={canToggle ? `Set to ${nextStatus}` : 'Cannot toggle occupied/reserved berths'}
      style={{
        fontSize: 11, padding: '3px 9px', borderRadius: 5, cursor: canToggle ? 'pointer' : 'default',
        border: `1px solid ${canToggle ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)'}`,
        background: canToggle ? '#fff' : 'transparent',
        color: canToggle ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)',
        fontFamily: 'var(--font)',
        minWidth: 60,
      }}
    >
      {busy ? '…' : (canToggle ? `→ ${nextStatus}` : berth.status)}
    </button>
  );
}

// ─── Tab 1: Berth Grid ────────────────────────────────────────────────────────

function BerthGrid() {
  const [berths,    setBerths]    = useState([]);
  const [piers,     setPiers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [pierFilter,    setPierFilter]    = useState('');
  const [statusFilter,  setStatusFilter]  = useState('');
  const [opTypeFilter,  setOpTypeFilter]  = useState('');
  const [categoryFilter,setCategoryFilter]= useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status    = statusFilter;
      if (pierFilter)   params.pier      = pierFilter;
      const [bRes, pRes] = await Promise.all([
        api.get('/berths/', { params }),
        api.get('/piers/'),
      ]);
      setBerths(Array.isArray(bRes.data) ? bRes.data : (bRes.data?.results ?? []));
      setPiers(Array.isArray(pRes.data) ? pRes.data : (pRes.data?.results ?? []));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, pierFilter]);

  useEffect(() => { load(); }, [load]);

  const displayed = berths.filter(b => {
    if (search && !b.code?.toLowerCase().includes(search.toLowerCase())) return false;
    if (opTypeFilter  && b.operational_type !== opTypeFilter)  return false;
    if (categoryFilter && b.category        !== categoryFilter) return false;
    return true;
  });

  const thSt = {
    padding: '9px 14px', textAlign: 'left',
    fontSize: 11, fontWeight: 600,
    color: 'rgba(0,0,0,0.45)',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
  };
  const tdSt = { padding: '9px 14px', color: 'rgba(0,0,0,0.55)', fontSize: 13 };

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search berth code…"
          style={{ padding: '6px 10px', border: 'var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)', width: 180 }}
        />

        <select
          value={pierFilter}
          onChange={e => setPierFilter(e.target.value)}
          style={{ padding: '6px 10px', border: 'var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)' }}
        >
          <option value="">All Piers</option>
          {piers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '6px 10px', border: 'var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)' }}
        >
          <option value="">All Statuses</option>
          {['available','occupied','reserved','maintenance'].map(s => (
            <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>
          ))}
        </select>

        <select
          value={opTypeFilter}
          onChange={e => setOpTypeFilter(e.target.value)}
          style={{ padding: '6px 10px', border: 'var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)' }}
        >
          <option value="">All Op. Types</option>
          {['permanent','transient','reserved'].map(t => (
            <option key={t} value={t} style={{ textTransform: 'capitalize' }}>{t}</option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{ padding: '6px 10px', border: 'var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)' }}
        >
          <option value="">All Categories</option>
          {['wet','dry','mooring'].map(c => (
            <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>
          {displayed.length} of {berths.length} berths
        </div>
      </div>

      {loading ? <Spinner /> : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: 'var(--border)', background: 'var(--bg)' }}>
                  {['Code','Pier','Type','Op. Type','Category','Status','Booking Tier','Length','Beam','Draft',''].map(h => (
                    <th key={h} style={thSt}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((b, i) => (
                  <tr
                    key={b.id}
                    style={{ borderBottom: i < displayed.length - 1 ? 'var(--border)' : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ ...tdSt, fontWeight: 700, color: 'var(--navy)' }}>{b.code}</td>
                    <td style={tdSt}>{b.pier_code || b.pier_name || '—'}</td>
                    <td style={tdSt}>
                      {b.berth_type
                        ? <span className="badge badge-gray">{b.berth_type}</span>
                        : <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>}
                    </td>
                    <td style={tdSt}>
                      {b.operational_type
                        ? <span className={`badge ${OP_TYPE_BADGE[b.operational_type] ?? 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>{b.operational_type}</span>
                        : <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>}
                    </td>
                    <td style={tdSt}>
                      {b.category
                        ? <span className={`badge ${CATEGORY_BADGE[b.category] ?? 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>{b.category}</span>
                        : <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>}
                    </td>
                    <td style={tdSt}>
                      <span className={`badge ${STATUS_BADGE[b.status] ?? 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>
                        {b.status}
                      </span>
                    </td>
                    <td style={tdSt}>
                      {b.booking_tier_name || b.pricing_tier_name
                        ? <span className="badge badge-gold">{b.booking_tier_name ?? b.pricing_tier_name}</span>
                        : <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>}
                    </td>
                    <td style={tdSt}>{b.length_m    ? `${b.length_m}m`    : '—'}</td>
                    <td style={tdSt}>{b.max_beam_m  ? `${b.max_beam_m}m`  : '—'}</td>
                    <td style={tdSt}>{b.max_draft_m ? `${b.max_draft_m}m` : '—'}</td>
                    <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                      <StatusToggle berth={b} onUpdated={load} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && displayed.length === 0 && (
            <EmptyState
              title="No berths match your filters"
              sub="Try adjusting the filters above."
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: Availability Matrix ───────────────────────────────────────────────

function AvailabilityMatrix() {
  const [berths,   setBerths]   = useState([]);
  const [avail,    setAvail]    = useState({});   // { berthId: { 'YYYY-MM-DD': status } }
  const [loading,  setLoading]  = useState(true);
  const [pierFilter, setPierFilter] = useState('');
  const [piers,    setPiers]    = useState([]);

  const today = new Date();
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (pierFilter) params.pier = pierFilter;
      const [bRes, pRes, availRes] = await Promise.all([
        api.get('/berths/', { params }),
        api.get('/piers/'),
        api.get('/berths/availability/', {
          params: {
            start_date: isoDate(today),
            end_date:   isoDate(addDays(today, 13)),
            ...(pierFilter ? { pier: pierFilter } : {}),
          }
        }).catch(() => ({ data: {} })),   // graceful fallback if endpoint 404s
      ]);
      setBerths(Array.isArray(bRes.data) ? bRes.data : (bRes.data?.results ?? []));
      setPiers(Array.isArray(pRes.data) ? pRes.data : (pRes.data?.results ?? []));

      // availability response can be either:
      //   { berth_id: { 'YYYY-MM-DD': 'occupied'|'available'|... } }
      //   OR an array of { berth_id, date, status }
      const raw = availRes.data;
      if (Array.isArray(raw)) {
        const map = {};
        raw.forEach(({ berth_id, date, status }) => {
          if (!map[berth_id]) map[berth_id] = {};
          map[berth_id][date] = status;
        });
        setAvail(map);
      } else {
        setAvail(raw ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [pierFilter]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  function cellStatus(berthId, date) {
    const dateStr = isoDate(date);
    return avail?.[berthId]?.[dateStr] ?? null;
  }

  const thSt = {
    padding: '7px 6px', textAlign: 'center',
    fontSize: 11, fontWeight: 600,
    color: 'rgba(0,0,0,0.45)',
    textTransform: 'uppercase', letterSpacing: '0.3px',
    whiteSpace: 'nowrap',
    minWidth: 40,
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={pierFilter}
          onChange={e => setPierFilter(e.target.value)}
          style={{ padding: '6px 10px', border: 'var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font)' }}
        >
          <option value="">All Piers</option>
          {piers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Legend */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
          {Object.entries(AVAIL_COLORS).filter(([k]) => k !== 'unknown').map(([k, c]) => (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
              <span style={{ textTransform: 'capitalize' }}>{k}</span>
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: AVAIL_COLORS.unknown, border: '1px solid rgba(0,0,0,0.12)', display: 'inline-block' }} />
            <span>No data</span>
          </span>
        </div>
      </div>

      {loading ? <Spinner /> : berths.length === 0 ? (
        <EmptyState title="No berths found" sub="Add berths in the Infrastructure screen." />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: 'var(--border)', background: 'var(--bg)' }}>
                  <th style={{ ...thSt, textAlign: 'left', padding: '7px 14px', minWidth: 80 }}>Berth</th>
                  <th style={{ ...thSt, textAlign: 'left', padding: '7px 10px', minWidth: 70 }}>Pier</th>
                  {dates.map(d => (
                    <th key={isoDate(d)} style={{
                      ...thSt,
                      background: isoDate(d) === isoDate(today) ? 'rgba(var(--navy-rgb, 13,71,161), 0.07)' : undefined,
                    }}>
                      {formatDate(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {berths.map((b, i) => (
                  <tr
                    key={b.id}
                    style={{ borderBottom: i < berths.length - 1 ? 'var(--border)' : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '8px 14px', fontWeight: 700, fontSize: 13, color: 'var(--navy)', whiteSpace: 'nowrap' }}>{b.code}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, color: 'rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>{b.pier_code || b.pier_name || '—'}</td>
                    {dates.map(d => {
                      const status = cellStatus(b.id, d) ?? b.status ?? 'unknown';
                      const color = AVAIL_COLORS[status] ?? AVAIL_COLORS.unknown;
                      const isToday = isoDate(d) === isoDate(today);
                      return (
                        <td
                          key={isoDate(d)}
                          title={`${b.code} · ${formatDate(d)}: ${status}`}
                          style={{
                            padding: '6px',
                            textAlign: 'center',
                            background: isToday ? 'rgba(13,71,161,0.04)' : undefined,
                          }}
                        >
                          <span style={{
                            display: 'inline-block',
                            width: 22, height: 22,
                            borderRadius: 4,
                            background: color,
                            border: status === 'unknown' ? '1px solid rgba(0,0,0,0.1)' : 'none',
                          }} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: Occupancy Stats ───────────────────────────────────────────────────

function OccupancyStats() {
  const [stats,   setStats]   = useState(null);
  const [berths,  setBerths]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [sRes, bRes] = await Promise.all([
          api.get('/berths/occupancy-stats/').catch(() => null),
          api.get('/berths/'),
        ]);
        const rawBerths = Array.isArray(bRes.data) ? bRes.data : (bRes.data?.results ?? []);
        setBerths(rawBerths);

        if (sRes?.data) {
          setStats(sRes.data);
        } else {
          // Derive stats from berth list as fallback
          setStats(null);
        }
      } catch (e) {
        setError('Failed to load occupancy data.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Derive counts from berth list (used either as fallback or alongside API stats)
  const derived = berths.length > 0 ? (() => {
    const total      = berths.length;
    const occupied   = berths.filter(b => b.status === 'occupied').length;
    const available  = berths.filter(b => b.status === 'available').length;
    const reserved   = berths.filter(b => b.status === 'reserved').length;
    const maintenance= berths.filter(b => b.status === 'maintenance').length;
    const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;

    const byCategory = {};
    berths.forEach(b => {
      const cat = b.category || 'uncategorised';
      if (!byCategory[cat]) byCategory[cat] = { total: 0, occupied: 0, available: 0, reserved: 0, maintenance: 0 };
      byCategory[cat].total++;
      byCategory[cat][b.status] = (byCategory[cat][b.status] ?? 0) + 1;
    });

    const byOpType = {};
    berths.forEach(b => {
      const t = b.operational_type || 'unset';
      if (!byOpType[t]) byOpType[t] = { total: 0, occupied: 0, available: 0 };
      byOpType[t].total++;
      if (b.status === 'occupied')  byOpType[t].occupied++;
      if (b.status === 'available') byOpType[t].available++;
    });

    return { total, occupied, available, reserved, maintenance, occupancyPct, byCategory, byOpType };
  })() : null;

  // Prefer API stats shape but fall back to derived
  const s = stats ?? derived;

  const kpiCardSt = {
    background: '#fff',
    border: 'var(--border)',
    borderRadius: 10,
    padding: '20px 24px',
    minWidth: 160,
    flex: '1 1 160px',
  };

  if (loading) return <Spinner />;
  if (error)   return <div style={{ color: 'var(--red)', fontSize: 13, padding: 16 }}>{error}</div>;
  if (!s)      return <EmptyState title="No berths found" sub="Add berths in the Infrastructure screen." />;

  const categoryEntries = Object.entries(s.byCategory ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const opTypeEntries   = Object.entries(s.byOpType   ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top KPI row */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={kpiCardSt}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Total Berths</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--navy)', lineHeight: 1 }}>{s.total}</div>
        </div>

        <div style={{ ...kpiCardSt, borderLeft: '3px solid #2ecc71' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Available</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#27ae60', lineHeight: 1 }}>{s.available}</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>
            {s.total > 0 ? Math.round((s.available / s.total) * 100) : 0}% of total
          </div>
        </div>

        <div style={{ ...kpiCardSt, borderLeft: '3px solid #e74c3c' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Occupied</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#c0392b', lineHeight: 1 }}>{s.occupied}</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>
            {s.occupancyPct ?? (s.total > 0 ? Math.round((s.occupied / s.total) * 100) : 0)}% occupancy
          </div>
        </div>

        <div style={{ ...kpiCardSt, borderLeft: '3px solid #f1c40f' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Reserved</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#d4ac0d', lineHeight: 1 }}>{s.reserved ?? 0}</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>
            {s.total > 0 ? Math.round(((s.reserved ?? 0) / s.total) * 100) : 0}% of total
          </div>
        </div>

        <div style={{ ...kpiCardSt, borderLeft: '3px solid #f39c12' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Maintenance</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#e67e22', lineHeight: 1 }}>{s.maintenance ?? 0}</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>
            {s.total > 0 ? Math.round(((s.maintenance ?? 0) / s.total) * 100) : 0}% of total
          </div>
        </div>
      </div>

      {/* Occupancy bar */}
      {s.total > 0 && (
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Overall Occupancy</div>
          <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden', gap: 1 }}>
            {[
              { key: 'occupied',    color: '#e74c3c', count: s.occupied   ?? 0 },
              { key: 'reserved',    color: '#f1c40f', count: s.reserved   ?? 0 },
              { key: 'maintenance', color: '#f39c12', count: s.maintenance ?? 0 },
              { key: 'available',   color: '#2ecc71', count: s.available  ?? 0 },
            ].map(({ key, color, count }) => count > 0 ? (
              <div
                key={key}
                title={`${key}: ${count} (${Math.round((count / s.total) * 100)}%)`}
                style={{ background: color, flex: count, transition: 'flex 0.3s ease' }}
              />
            ) : null)}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            {[
              { key: 'Occupied',    color: '#e74c3c', count: s.occupied   ?? 0 },
              { key: 'Reserved',    color: '#f1c40f', count: s.reserved   ?? 0 },
              { key: 'Maintenance', color: '#f39c12', count: s.maintenance ?? 0 },
              { key: 'Available',   color: '#2ecc71', count: s.available  ?? 0 },
            ].map(({ key, color, count }) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                {key}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* By Category */}
      {categoryEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.6)', marginBottom: 10 }}>By Category</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {categoryEntries.map(([cat, counts]) => (
              <div key={cat} style={{ ...kpiCardSt, flex: '1 1 180px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span className={`badge ${CATEGORY_BADGE[cat] ?? 'badge-gray'}`} style={{ textTransform: 'capitalize', fontSize: 11 }}>{cat}</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)' }}>{counts.total}</span>
                </div>
                <div style={{ display: 'flex', height: 8, borderRadius: 3, overflow: 'hidden', gap: 1, marginBottom: 8 }}>
                  {counts.occupied   > 0 && <div style={{ background: '#e74c3c', flex: counts.occupied }}   />}
                  {counts.reserved   > 0 && <div style={{ background: '#f1c40f', flex: counts.reserved }}   />}
                  {counts.maintenance > 0 && <div style={{ background: '#f39c12', flex: counts.maintenance }} />}
                  {counts.available  > 0 && <div style={{ background: '#2ecc71', flex: counts.available }}  />}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {[
                    ['Occ', counts.occupied ?? 0,    '#e74c3c'],
                    ['Avail', counts.available ?? 0,  '#27ae60'],
                    ['Maint', counts.maintenance ?? 0, '#e67e22'],
                  ].map(([lbl, cnt, col]) => (
                    <span key={lbl} style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                      <span style={{ fontWeight: 600, color: col }}>{cnt}</span> {lbl}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By Operational Type */}
      {opTypeEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.6)', marginBottom: 10 }}>By Operational Type</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: 'var(--border)', background: 'var(--bg)' }}>
                  {['Type','Total','Occupied','Available','Occupancy %'].map(h => (
                    <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {opTypeEntries.map(([type, counts], i) => (
                  <tr key={type} style={{ borderBottom: i < opTypeEntries.length - 1 ? 'var(--border)' : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '9px 16px' }}>
                      <span className={`badge ${OP_TYPE_BADGE[type] ?? 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>{type}</span>
                    </td>
                    <td style={{ padding: '9px 16px', fontWeight: 600 }}>{counts.total}</td>
                    <td style={{ padding: '9px 16px', color: '#c0392b' }}>{counts.occupied ?? 0}</td>
                    <td style={{ padding: '9px 16px', color: '#27ae60' }}>{counts.available ?? 0}</td>
                    <td style={{ padding: '9px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.07)', overflow: 'hidden', maxWidth: 80 }}>
                          <div style={{
                            height: '100%',
                            borderRadius: 3,
                            background: '#e74c3c',
                            width: `${counts.total > 0 ? Math.round(((counts.occupied ?? 0) / counts.total) * 100) : 0}%`,
                          }} />
                        </div>
                        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', minWidth: 30 }}>
                          {counts.total > 0 ? Math.round(((counts.occupied ?? 0) / counts.total) * 100) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BerthIntelligence() {
  const [tab, setTab] = useState('grid');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        {TABS.map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>
            {l}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'grid'         && <BerthGrid />}
        {tab === 'availability' && <AvailabilityMatrix />}
        {tab === 'stats'        && <OccupancyStats />}
      </div>
    </div>
  );
}
