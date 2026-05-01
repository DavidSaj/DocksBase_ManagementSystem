import { useState, useEffect } from 'react';
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

export default function Overview() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    api.get('admin/overview/')
      .then(r => setData(r.data))
      .catch(() => setError('Could not load overview data.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">{error}</div></div>;

  const { mrr, arr, active_marinas, trial_marinas, total_berths, gmv, alerts, recent_signups } = data;
  const { overdue_payments, trials_ending_soon, suspended } = alerts;

  return (
    <div>
      {/* Alerts */}
      {(overdue_payments.length > 0 || suspended.length > 0 || trials_ending_soon.length > 0) && (
        <div style={{ marginBottom: 20 }}>
          {suspended.map(m => (
            <div key={m.id} className="alert-row danger">
              <Ic n="alert-tri" s={14} c="#c0392b" />
              <div style={{ flex: 1 }}>
                <div className="alert-row-text"><strong>{m.name}</strong> — account suspended</div>
                <div className="alert-row-sub">{m.suspend_reason}</div>
              </div>
              <span className="badge badge-red">Suspended</span>
            </div>
          ))}
          {overdue_payments.map(p => (
            <div key={p.id} className="alert-row warn">
              <Ic n="alert-tri" s={14} c="#b04000" />
              <div style={{ flex: 1 }}>
                <div className="alert-row-text"><strong>{p.marina_name}</strong> — payment overdue</div>
                <div className="alert-row-sub">€{p.amount}</div>
              </div>
              <span className="badge badge-orange">Overdue</span>
            </div>
          ))}
          {trials_ending_soon.map(t => {
            const days = Math.ceil((new Date(t.trial_ends) - new Date()) / 86400000);
            return (
              <div key={t.id} className="alert-row warn">
                <Ic n="alert-tri" s={14} c="#b04000" />
                <div style={{ flex: 1 }}>
                  <div className="alert-row-text"><strong>{t.name}</strong> — trial ends in {days} days</div>
                  <div className="alert-row-sub">{t.timezone} · on {t.plan} plan</div>
                </div>
                <span className="badge badge-teal">Trial</span>
              </div>
            );
          })}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Monthly Recurring Revenue', val: `€${Number(mrr).toLocaleString()}`,       sub: `€${Math.round(arr/1000)}k ARR`,             icon: 'dollar' },
          { label: 'Active Marinas',             val: active_marinas,                           sub: `${active_marinas + trial_marinas} total`,   icon: 'anchor' },
          { label: 'Trial Accounts',             val: trial_marinas,                            sub: `${trials_ending_soon.length} ending ≤14 days`, icon: 'users' },
          { label: 'Total Berths Managed',       val: Number(total_berths).toLocaleString(),    sub: 'across active accounts',                     icon: 'globe' },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div className="stat-label">{k.label}</div>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.4)' }}>
                <Ic n={k.icon} s={13} />
              </div>
            </div>
            <div className="stat-val">{k.val}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent signups */}
      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Recent signups</span>
        </div>
        <table className="tbl">
          <tbody>
            {recent_signups.map(m => (
              <tr key={m.id} style={{ cursor: 'default' }}>
                <td>
                  <div className="tbl-name">{m.name}</div>
                  <div className="tbl-sub">{m.timezone}</div>
                </td>
                <td><PlanBadge plan={m.plan} /></td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ marginBottom: 4 }}><StatusBadge status={m.status} /></div>
                  <div className="tbl-sub">{new Date(m.created_at).toLocaleDateString()}</div>
                </td>
              </tr>
            ))}
            {recent_signups.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No signups yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
