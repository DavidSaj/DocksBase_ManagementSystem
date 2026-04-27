import { MARINAS, PLANS } from '../data/mock.js';
import Ic from '../components/ui/Icon.jsx';

function PlanBadge({ plan }) {
  const colors = { starter: 'badge-gray', professional: 'badge-blue', enterprise: 'badge-gold' };
  const labels = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' };
  return <span className={`badge ${colors[plan] || 'badge-gray'}`}>{labels[plan] || plan}</span>;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date('2026-04-27')) / 86400000);
}

const paid = MARINAS.filter(m => !m.trial && m.status !== 'suspended');
const trials = MARINAS.filter(m => m.trial);
const suspended = MARINAS.filter(m => m.status === 'suspended');

export default function Subscriptions() {
  return (
    <div>
      <div className="grid-3" style={{ marginBottom: 20 }}>
        {PLANS.map(p => {
          const count = paid.filter(m => m.plan === p.id).length;
          const rev   = paid.filter(m => m.plan === p.id).reduce((s, m) => s + m.mrr, 0);
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
        {/* Paid subscriptions */}
        <div>
          <div className="sec-hdr"><div className="sec-hdr-title">Active subscriptions ({paid.length})</div></div>
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
                {paid.map(m => {
                  const days = daysUntil(m.nextRenewal);
                  const urgent = days !== null && days <= 14;
                  return (
                    <tr key={m.id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="tbl-name">{m.name}</div>
                        <div className="tbl-sub">{m.location}</div>
                      </td>
                      <td><PlanBadge plan={m.plan} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>€{m.mrr}</td>
                      <td>
                        <span style={{ fontSize: 12, color: urgent ? 'var(--orange)' : 'rgba(0,0,0,0.65)' }}>
                          {m.nextRenewal}
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
          <div className="sec-hdr"><div className="sec-hdr-title">Trial accounts ({trials.length})</div></div>
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
                {trials.map(m => {
                  const days = daysUntil(m.trialEnds);
                  return (
                    <tr key={m.id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="tbl-name">{m.name}</div>
                        <div className="tbl-sub">{m.location}</div>
                      </td>
                      <td><PlanBadge plan={m.plan} /></td>
                      <td>
                        <span style={{ fontSize: 12, color: days <= 14 ? 'var(--orange)' : 'rgba(0,0,0,0.65)' }}>
                          {m.trialEnds}
                        </span>
                        <div style={{ fontSize: 10, color: days <= 14 ? 'var(--orange)' : 'rgba(0,0,0,0.35)' }}>
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
                        <td style={{ fontSize: 11, color: 'var(--red)' }}>{m.suspendReason}</td>
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
