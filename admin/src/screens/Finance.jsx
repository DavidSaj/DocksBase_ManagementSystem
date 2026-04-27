import { MARINAS, PAYMENTS, MRR_HISTORY, PLANS } from '../data/mock.js';

const active = MARINAS.filter(m => m.status === 'active');
const mrr    = active.reduce((s, m) => s + m.mrr, 0);
const arr    = mrr * 12;

const ytdMonths = 4;
const ytd = MRR_HISTORY.slice(-ytdMonths).reduce((s, h) => s + h.mrr, 0);

function PlanBadge({ plan }) {
  const colors = { starter: 'badge-gray', professional: 'badge-blue', enterprise: 'badge-gold' };
  const labels = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
  return <span className={`badge ${colors[plan] || 'badge-gray'}`}>{labels[plan] || plan}</span>;
}

function StatusBadge({ s }) {
  const map = { paid: 'badge-green', due: 'badge-blue', overdue: 'badge-red' };
  return <span className={`badge ${map[s] || 'badge-gray'}`}>{s}</span>;
}

const maxMrr = Math.max(...MRR_HISTORY.map(h => h.mrr));

export default function Finance() {
  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {[
          { label: 'Current MRR',       val: `€${mrr.toLocaleString()}`,  sub: `+12% vs last month` },
          { label: 'ARR (annualised)',   val: `€${Math.round(arr/1000)}k`, sub: `based on current MRR` },
          { label: 'Revenue YTD',        val: `€${ytd.toLocaleString()}`,  sub: `Jan – Apr 2026` },
          { label: 'Avg revenue / account', val: `€${Math.round(mrr / active.length)}`, sub: `${active.length} active accounts` },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div className="stat-label">{k.label}</div>
            <div className="stat-val">{k.val}</div>
            <div className="stat-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid-a" style={{ marginBottom: 16 }}>
        {/* MRR chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Monthly recurring revenue</span>
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Nov 2025 – Apr 2026</span>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120, marginBottom: 12 }}>
              {MRR_HISTORY.map((h, i) => {
                const pct = h.mrr / maxMrr;
                const isCurrent = i === MRR_HISTORY.length - 1;
                return (
                  <div key={h.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ fontSize: 10, color: isCurrent ? 'var(--teal2)' : 'rgba(0,0,0,0.35)', fontWeight: 600 }}>
                      €{(h.mrr/1000).toFixed(1)}k
                    </div>
                    <div style={{
                      width: '100%', borderRadius: '3px 3px 0 0',
                      height: `${pct * 80}px`,
                      background: isCurrent ? 'var(--teal2)' : 'var(--navy2)',
                      opacity: isCurrent ? 1 : 0.55,
                    }} />
                    <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', fontWeight: 500 }}>{h.month}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ paddingTop: 14, borderTop: 'var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 12 }}>Revenue by plan tier</div>
              {PLANS.map(p => {
                const rev = active.filter(m => m.plan === p.id).reduce((s, m) => s + m.mrr, 0);
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
              {[...active].sort((a, b) => b.mrr - a.mrr).map(m => (
                <tr key={m.id} style={{ cursor: 'default' }}>
                  <td>
                    <div className="tbl-name" style={{ fontSize: 12 }}>{m.name}</div>
                  </td>
                  <td><PlanBadge plan={m.plan} /></td>
                  <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>€{m.mrr}</td>
                </tr>
              ))}
              <tr style={{ cursor: 'default', background: 'var(--bg)' }}>
                <td colSpan={2} style={{ fontWeight: 600, fontSize: 12 }}>Total MRR</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--teal2)' }}>€{mrr}</td>
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
              <th>Date</th>
              <th>Method</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {PAYMENTS.map(p => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', fontFamily: 'monospace' }}>{p.id}</td>
                <td><div className="tbl-name">{p.name}</div></td>
                <td style={{ color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>{p.date}</td>
                <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{p.method}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>€{p.amount}</td>
                <td><StatusBadge s={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
