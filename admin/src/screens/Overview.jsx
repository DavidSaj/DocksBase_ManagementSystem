import { MARINAS, PAYMENTS, MRR_HISTORY, PLANS } from '../data/mock.js';
import Ic from '../components/ui/Icon.jsx';

const active    = MARINAS.filter(m => m.status === 'active');
const trials    = MARINAS.filter(m => m.status === 'trial');
const suspended = MARINAS.filter(m => m.status === 'suspended');
const mrr       = active.reduce((s, m) => s + m.mrr, 0);
const arr       = mrr * 12;

const overdue   = PAYMENTS.filter(p => p.status === 'overdue');
const trialsEndingSoon = trials.filter(t => {
  const days = Math.ceil((new Date(t.trialEnds) - new Date('2026-04-27')) / 86400000);
  return days <= 14;
});

const recentSignups = [...MARINAS].sort((a, b) => new Date(b.joined) - new Date(a.joined)).slice(0, 5);

const planBreakdown = PLANS.map(p => ({
  ...p,
  count: active.filter(m => m.plan === p.id).length,
  revenue: active.filter(m => m.plan === p.id).reduce((s, m) => s + m.mrr, 0),
}));

const maxMrr = Math.max(...MRR_HISTORY.map(h => h.mrr));

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
  return (
    <div>
      {/* Alerts */}
      {(overdue.length > 0 || suspended.length > 0) && (
        <div style={{ marginBottom: 20 }}>
          {suspended.map(m => (
            <div key={m.id} className="alert-row danger">
              <Ic n="alert-tri" s={14} c="#c0392b" />
              <div style={{ flex: 1 }}>
                <div className="alert-row-text"><strong>{m.name}</strong> — account suspended</div>
                <div className="alert-row-sub">{m.suspendReason}</div>
              </div>
              <span className="badge badge-red">Suspended</span>
            </div>
          ))}
          {overdue.map(p => (
            <div key={p.id} className="alert-row warn">
              <Ic n="alert-tri" s={14} c="#b04000" />
              <div style={{ flex: 1 }}>
                <div className="alert-row-text"><strong>{p.name}</strong> — payment overdue</div>
                <div className="alert-row-sub">{p.id} · €{p.amount}</div>
              </div>
              <span className="badge badge-orange">Overdue</span>
            </div>
          ))}
          {trialsEndingSoon.map(t => {
            const days = Math.ceil((new Date(t.trialEnds) - new Date('2026-04-27')) / 86400000);
            return (
              <div key={t.id} className="alert-row warn">
                <Ic n="alert-tri" s={14} c="#b04000" />
                <div style={{ flex: 1 }}>
                  <div className="alert-row-text"><strong>{t.name}</strong> — trial ends in {days} days</div>
                  <div className="alert-row-sub">{t.location} · on {t.plan} plan</div>
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
          { label: 'Monthly Recurring Revenue', val: `€${mrr.toLocaleString()}`, sub: `€${Math.round(arr/1000)}k ARR`, trend: '+12%', up: true, icon: 'dollar' },
          { label: 'Active Marinas',             val: active.length,             sub: `${MARINAS.length} total`,      trend: '+2 this month', up: true, icon: 'anchor' },
          { label: 'Trial Accounts',             val: trials.length,             sub: `${trialsEndingSoon.length} ending ≤14 days`, trend: null, up: null, icon: 'users' },
          { label: 'Total Berths Managed',       val: active.reduce((s, m) => s + m.berths, 0).toLocaleString(), sub: 'across active accounts', trend: null, up: null, icon: 'globe' },
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
            {k.trend && <div className={`stat-trend ${k.up ? 'up' : 'dn'}`}>{k.trend}</div>}
          </div>
        ))}
      </div>

      <div className="grid-a">
        {/* MRR history chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">MRR growth</span>
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Last 6 months</span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100, marginBottom: 8 }}>
              {MRR_HISTORY.map((h, i) => {
                const pct = h.mrr / maxMrr;
                const isCurrent = i === MRR_HISTORY.length - 1;
                return (
                  <div key={h.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ fontSize: 9, color: isCurrent ? 'var(--teal2)' : 'rgba(0,0,0,0.3)', fontWeight: 600 }}>
                      €{(h.mrr/1000).toFixed(1)}k
                    </div>
                    <div style={{
                      width: '100%', borderRadius: '3px 3px 0 0',
                      height: `${pct * 72}px`,
                      background: isCurrent ? 'var(--teal2)' : 'var(--navy2)',
                      opacity: isCurrent ? 1 : 0.6,
                    }} />
                    <div style={{ fontSize: 9, color: 'rgba(0,0,0,0.38)' }}>{h.month}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ borderTop: 'var(--border)', paddingTop: 14, marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 10 }}>Revenue by plan</div>
              {planBreakdown.map(p => (
                <div key={p.id} className="plan-bar-row">
                  <div className="plan-bar-label"><PlanBadge plan={p.id} /></div>
                  <div className="plan-bar-track">
                    <div className="plan-bar-fill" style={{
                      width: `${(p.revenue / mrr) * 100}%`,
                      background: p.id === 'enterprise' ? 'var(--gold)' : p.id === 'professional' ? 'var(--blue)' : 'var(--teal2)',
                    }} />
                  </div>
                  <div className="plan-bar-val">€{p.revenue}</div>
                  <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', width: 50, flexShrink: 0 }}>{p.count} marina{p.count !== 1 ? 's' : ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent signups */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Recent signups</span>
          </div>
          <table className="tbl">
            <tbody>
              {recentSignups.map(m => (
                <tr key={m.id} style={{ cursor: 'default' }}>
                  <td>
                    <div className="tbl-name">{m.name}</div>
                    <div className="tbl-sub">{m.location}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ marginBottom: 4 }}><StatusBadge status={m.status} /></div>
                    <div className="tbl-sub">{m.joined}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
