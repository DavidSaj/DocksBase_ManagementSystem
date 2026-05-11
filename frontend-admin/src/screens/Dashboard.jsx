import { useEffect, useState } from 'react';
import api from '../api.js';

function StatTile({ label, value, sub }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '20px 24px', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function AlertRow({ label, items, color }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {items.map((m, i) => (
        <div key={i} style={{ fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
          {m.name} {m.trial_ends ? `— expires ${m.trial_ends}` : ''} {m.suspend_reason ? `— ${m.suspend_reason}` : ''}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/overview/')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load overview data.'));
  }, []);

  if (error) return <div style={{ color: '#dc2626' }}>{error}</div>;
  if (!data) return <div style={{ color: '#999' }}>Loading…</div>;

  const fmt = n => n != null ? `€${Number(n).toLocaleString()}` : '—';

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Platform Overview</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <StatTile label="MRR" value={fmt(data.mrr)} />
        <StatTile label="ARR" value={fmt(data.arr)} />
        <StatTile label="Active Marinas" value={data.active_marinas} />
        <StatTile label="Trial Marinas" value={data.trial_marinas} />
        <StatTile label="Total Berths" value={data.total_berths?.toLocaleString()} />
        <StatTile label="GMV" value={fmt(data.gmv)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Alerts</h3>
          <AlertRow label="Trials Ending Soon" items={data.alerts?.trials_ending_soon} color="#d97706" />
          <AlertRow label="Overdue Payments" items={data.alerts?.overdue_payments?.map(p => ({ name: p.marina_name || p.marina, trial_ends: null }))} color="#dc2626" />
          <AlertRow label="Suspended" items={data.alerts?.suspended} color="#6b7280" />
          {!data.alerts?.trials_ending_soon?.length && !data.alerts?.overdue_payments?.length && !data.alerts?.suspended?.length && (
            <div style={{ color: '#999', fontSize: 13 }}>No active alerts</div>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Recent Signups</h3>
          {data.recent_signups?.map((m, i) => (
            <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between' }}>
              <span>{m.name}</span>
              <span style={{ color: '#999' }}>{m.created_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
