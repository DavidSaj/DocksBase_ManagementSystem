import { useState, useEffect } from 'react';
import api from '../api.js';

const PLANS = [
  { id: 'starter',      name: 'Starter',      price: 149 },
  { id: 'professional', name: 'Professional',  price: 349 },
  { id: 'enterprise',   name: 'Enterprise',    price: 899 },
];

function PlanBadge({ plan }) {
  const colors = { starter: 'badge-gray', professional: 'badge-blue', enterprise: 'badge-gold' };
  const labels = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
  return <span className={`badge ${colors[plan] || 'badge-gray'}`}>{labels[plan] || plan}</span>;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

export default function Subscriptions() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('admin/subscriptions/')
      .then(r => setData(r.data))
      .catch(e => setError(e.message || 'Failed to load subscriptions'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.38)' }}>Loading…</div>;
  if (error)   return <div style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>{error}</div>;

  const { plan_summary = [], active = [], trial = [], suspended = [] } = data;

  return (
    <div>
      <div className="grid-3" style={{ marginBottom: 20 }}>
        {PLANS.map(p => {
          const summary = plan_summary.find(s => s.plan === p.id) || {};
          const count = summary.count ?? 0;
          const rev   = summary.revenue ?? 0;
          return (
            <div key={p.id} className="card stat-card">
              <div className="stat-label">{p.name} plan</div>
              <div className="stat-val">{count}</div>
              <div className="stat-sub">active accounts · €{rev}/mo</div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>€{p.price}/mo per marina</div>
            </div>
          );
        })}
      </div>

      <div className="grid-2">
        {/* Active subscriptions */}
        <div>
          <div className="sec-hdr"><div className="sec-hdr-title">Active subscriptions ({active.length})</div></div>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Marina</th>
                  <th>Plan</th>
                  <th style={{ textAlign: 'right' }}>MRR</th>
                  <th>Next renewal</th>
                </tr>
              </thead>
              <tbody>
                {active.map(m => {
                  const days = daysUntil(m.next_renewal);
                  const urgent = days !== null && days <= 14;
                  return (
                    <tr key={m.id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="tbl-name">{m.name}</div>
                        <div className="tbl-sub">{m.timezone}</div>
                      </td>
                      <td><PlanBadge plan={m.plan} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>€{m.mrr}</td>
                      <td>
                        <span style={{ fontSize: 12, color: urgent ? 'var(--orange)' : 'rgba(0,0,0,0.65)' }}>
                          {m.next_renewal}
                        </span>
                        {urgent && <div style={{ fontSize: 10, color: 'var(--orange)' }}>{days} days</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          {/* Trials */}
          <div className="sec-hdr"><div className="sec-hdr-title">Trial accounts ({trial.length})</div></div>
          <div className="card" style={{ marginBottom: 16 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Marina</th>
                  <th>Plan</th>
                  <th>Trial ends</th>
                </tr>
              </thead>
              <tbody>
                {trial.map(m => {
                  const days = daysUntil(m.trial_ends);
                  return (
                    <tr key={m.id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="tbl-name">{m.name}</div>
                        <div className="tbl-sub">{m.timezone}</div>
                      </td>
                      <td><PlanBadge plan={m.plan} /></td>
                      <td>
                        <span style={{ fontSize: 12, color: days !== null && days <= 14 ? 'var(--orange)' : 'rgba(0,0,0,0.65)' }}>
                          {m.trial_ends}
                        </span>
                        <div style={{ fontSize: 10, color: days !== null && days <= 14 ? 'var(--orange)' : 'rgba(0,0,0,0.35)' }}>
                          {days} days left
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Suspended */}
          {suspended.length > 0 && (
            <>
              <div className="sec-hdr"><div className="sec-hdr-title">Suspended ({suspended.length})</div></div>
              <div className="card">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Marina</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suspended.map(m => (
                      <tr key={m.id} style={{ cursor: 'default' }}>
                        <td>
                          <div className="tbl-name">{m.name}</div>
                          <div className="tbl-sub">{m.plan} plan</div>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--red)' }}>{m.suspend_reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
