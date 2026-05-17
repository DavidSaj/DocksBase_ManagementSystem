import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function PlanBadge({ plan }) {
  const colors = { starter: 'badge-gray', professional: 'badge-blue', enterprise: 'badge-gold' };
  const labels = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
  return <span className={`badge ${colors[plan] || 'badge-gray'}`}>{labels[plan] || plan}</span>;
}

function StatusBadge({ status }) {
  const map = { active: 'badge-green', trial: 'badge-teal', suspended: 'badge-red' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

export default function Marinas({ onOpenMarina }) {
  const [marinas, setMarinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('all');
  const [query, setQuery]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filter !== 'all') params.status = filter;
    if (query) params.search = query;
    api.get('admin/marinas/', { params })
      .then(r => setMarinas(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, query]);

  useEffect(() => { load(); }, [load]);

  const counts = { all: marinas.length };
  ['active', 'trial', 'suspended'].forEach(s => {
    counts[s] = marinas.filter(m => m.status === s).length;
  });

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Marinas <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({marinas.length})</span></div>
      </div>

      <div>
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
            <div className="search">
              <Ic n="search" s={13} />
              <input placeholder="Search marinas…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div className="filter-bar" style={{ margin: 0 }}>
              {['all', 'active', 'trial', 'suspended'].map(f => (
                <div key={f} className={`filter-chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? `All (${counts.all})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${counts[f]})`}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Marina</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Berths</th>
                  <th style={{ textAlign: 'right' }}>MRR</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : marinas.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No marinas match this filter.</td></tr>
                ) : marinas.map(m => (
                  <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => onOpenMarina && onOpenMarina(m.id)}>
                    <td>
                      <div className="tbl-name">{m.name}</div>
                      {m.group_name
                        ? <div className="tbl-sub" style={{ color: 'rgba(180,140,0,0.8)' }}>{m.group_name}</div>
                        : <div className="tbl-sub">{m.timezone}</div>}
                    </td>
                    <td>
                      {m.group_name
                        ? <span className="badge badge-gold">Enterprise</span>
                        : <PlanBadge plan={m.plan} />}
                    </td>
                    <td>
                      <StatusBadge status={m.status} />
                      {m.status === 'trial' && m.trial_ends && (
                        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>→ {m.trial_ends}</div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.total_berths}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {m.mrr > 0 ? <span style={{ fontWeight: 600 }}>€{m.mrr}</span> : <span style={{ color: 'rgba(0,0,0,0.28)' }}>—</span>}
                    </td>
                    <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>{new Date(m.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
