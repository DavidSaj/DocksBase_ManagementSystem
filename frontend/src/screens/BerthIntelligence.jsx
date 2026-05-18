import { useState, useEffect } from 'react';
import api from '../api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

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
  return (
    <div>
      <PageHeader
        title="Berth Intelligence"
        subtitle="Live occupancy stats and breakdown by category and operational type."
        infoBody={SCREEN_INFO.berthIntelligence}
      />
      <OccupancyStats />
    </div>
  );
}
