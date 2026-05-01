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

function StatusBadge({ s }) {
  const map = { paid: 'badge-green', due: 'badge-blue', overdue: 'badge-red' };
  return <span className={`badge ${map[s] || 'badge-gray'}`}>{s}</span>;
}

export default function Finance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('admin/finance/')
      .then(r => setData(r.data))
      .catch(e => setError(e.message || 'Failed to load finance data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.38)' }}>Loading…</div>;
  if (error)   return <div style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>{error}</div>;

  const {
    mrr = 0,
    arr = 0,
    avg_revenue_per_account = 0,
    revenue_by_plan = [],
    revenue_by_marina = [],
    payments = [],
  } = data;

  const totalMrr = revenue_by_marina.reduce((s, m) => s + (m.mrr || 0), 0);

  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Current MRR',           val: `€${mrr.toLocaleString()}`,                    sub: 'monthly recurring revenue' },
          { label: 'ARR (annualised)',       val: `€${Math.round(arr / 1000)}k`,                 sub: 'based on current MRR' },
          { label: 'Avg revenue / account', val: `€${Math.round(avg_revenue_per_account)}`,      sub: 'per active account' },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div className="stat-label">{k.label}</div>
            <div className="stat-val">{k.val}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid-a" style={{ marginBottom: 16 }}>
        {/* Revenue by plan */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Revenue by plan tier</span>
          </div>
          <div className="card-body">
            {PLANS.map(p => {
              const row = revenue_by_plan.find(r => r.plan === p.id) || {};
              const rev = row.revenue ?? 0;
              const pct = mrr > 0 ? (rev / mrr) * 100 : 0;
              return (
                <div key={p.id} className="plan-bar-row">
                  <div className="plan-bar-label"><PlanBadge plan={p.id} /></div>
                  <div className="plan-bar-track">
                    <div className="plan-bar-fill" style={{
                      width: `${pct}%`,
                      background: p.id === 'enterprise' ? 'var(--gold)' : p.id === 'professional' ? 'var(--blue)' : 'var(--teal2)',
                    }} />
                  </div>
                  <div className="plan-bar-val">€{rev}</div>
                  <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', width: 36, flexShrink: 0 }}>{Math.round(pct)}%</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Revenue per marina */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Revenue by marina</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Marina</th>
                <th>Plan</th>
                <th style={{ textAlign: 'right' }}>MRR</th>
              </tr>
            </thead>
            <tbody>
              {[...revenue_by_marina].sort((a, b) => b.mrr - a.mrr).map((m, i) => (
                <tr key={i} style={{ cursor: 'default' }}>
                  <td>
                    <div className="tbl-name" style={{ fontSize: 12 }}>{m.name}</div>
                  </td>
                  <td><PlanBadge plan={m.plan} /></td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>€{m.mrr}</td>
                </tr>
              ))}
              <tr style={{ cursor: 'default', background: 'var(--bg)' }}>
                <td colSpan={2} style={{ fontWeight: 600, fontSize: 12 }}>Total MRR</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--teal2)' }}>€{totalMrr}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Payments table */}
      <div className="sec-hdr"><div className="sec-hdr-title">Recent payments</div></div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Payment ID</th>
              <th>Marina</th>
              <th>Period</th>
              <th>Method</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', fontFamily: 'monospace' }}>{p.id}</td>
                <td><div className="tbl-name">{p.marina_name}</div></td>
                <td style={{ color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>{p.period_start}</td>
                <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{p.method}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>€{parseFloat(p.amount).toFixed(2)}</td>
                <td><StatusBadge s={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
