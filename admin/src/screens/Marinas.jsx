import { useState } from 'react';
import { MARINAS } from '../data/mock.js';
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

function DetailPanel({ marina, onClose }) {
  if (!marina) return (
    <div className="detail-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'rgba(0,0,0,0.28)', gap: 8 }}>
      <Ic n="anchor" s={28} c="rgba(0,0,0,0.15)" />
      <div style={{ fontSize: 12 }}>Select a marina to view details</div>
    </div>
  );

  const planLabel = { starter: 'Starter — €149/mo', professional: 'Professional — €349/mo', enterprise: 'Enterprise — €899/mo' };

  return (
    <div className="detail-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="detail-panel-title">{marina.name}</div>
          <div className="detail-panel-sub">{marina.location}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
          <Ic n="x" s={12} />
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <StatusBadge status={marina.status} />
        {marina.trial && <span style={{ marginLeft: 6, fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Trial ends {marina.trialEnds}</span>}
        {marina.suspendReason && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--red)', background: '#fff0f0', padding: '4px 8px', borderRadius: 4 }}>{marina.suspendReason}</div>}
      </div>

      {[
        ['Marina ID',      marina.id],
        ['Plan',           planLabel[marina.plan] || marina.plan],
        ['Berths',         marina.berths],
        ['Active bookings',marina.activeBookings],
        ['Staff users',    marina.users],
        ['MRR',            marina.mrr > 0 ? `€${marina.mrr}` : '—'],
        ['Next renewal',   marina.nextRenewal || '—'],
        ['Admin contact',  marina.admin],
        ['Email',          marina.email],
        ['Joined',         marina.joined],
        ['Last active',    marina.lastActive],
      ].map(([k, v]) => (
        <div key={k} className="detail-row">
          <span className="detail-key">{k}</span>
          <span className="detail-val">{v}</span>
        </div>
      ))}

      <div className="detail-actions">
        {marina.status === 'active' && (
          <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Ic n="mail" s={12} /> Send message
          </button>
        )}
        {marina.status !== 'suspended' ? (
          <button className="btn btn-danger btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Ic n="lock" s={12} /> Suspend account
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Ic n="check" s={12} /> Reinstate account
          </button>
        )}
        {marina.status === 'trial' && (
          <button className="btn btn-primary btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Ic n="tag" s={12} /> Convert to paid
          </button>
        )}
      </div>
    </div>
  );
}

export default function Marinas() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery]   = useState('');
  const [selected, setSelected] = useState(null);

  const filters = ['all', 'active', 'trial', 'suspended'];

  const visible = MARINAS.filter(m => {
    if (filter !== 'all' && m.status !== filter) return false;
    if (query && !m.name.toLowerCase().includes(query.toLowerCase()) && !m.location.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Marinas <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({MARINAS.length})</span></div>
        <button className="btn btn-primary btn-sm"><Ic n="plus" s={12} /> Add marina</button>
      </div>

      <div className="grid-b" style={{ alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
            <div className="search">
              <Ic n="search" s={13} />
              <input placeholder="Search marinas…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div className="filter-bar" style={{ margin: 0 }}>
              {filters.map(f => (
                <div key={f} className={`filter-chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? `All (${MARINAS.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${MARINAS.filter(m => m.status === f).length})`}
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
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(m => (
                  <tr key={m.id} className={selected?.id === m.id ? 'selected' : ''} onClick={() => setSelected(selected?.id === m.id ? null : m)}>
                    <td>
                      <div className="tbl-name">{m.name}</div>
                      <div className="tbl-sub">{m.location}</div>
                    </td>
                    <td><PlanBadge plan={m.plan} /></td>
                    <td>
                      <StatusBadge status={m.status} />
                      {m.trial && <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>→ {m.trialEnds}</div>}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.berths}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {m.mrr > 0 ? <span style={{ fontWeight: 600 }}>€{m.mrr}</span> : <span style={{ color: 'rgba(0,0,0,0.28)' }}>—</span>}
                    </td>
                    <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>{m.lastActive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && (
              <div className="empty"><div className="empty-title">No marinas match this filter.</div></div>
            )}
          </div>
        </div>

        <DetailPanel marina={selected} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
