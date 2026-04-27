import { PLANS } from '../data/mock.js';

const FEATURES = {
  starter:      ['Marina map', 'Reservations', 'Vessel registry', 'Members', 'Billing & invoicing', 'Maintenance', 'Basic reports'],
  professional: ['Everything in Starter', 'Restaurant & F&B', 'Events & venue hire', 'Boatyard & haul-out', 'Documents & eSign', 'Boat sales', 'Full analytics', 'Staff & rota'],
  enterprise:   ['Everything in Professional', 'Multi-marina support', 'Group reporting', 'Custom integrations', 'Dedicated support', 'SLA guarantee', 'SSO / SAML', 'Custom roles'],
};

function PlanCard({ plan }) {
  const feats = FEATURES[plan.id] || [];
  return (
    <div className={`plan-card${plan.id === 'professional' ? ' current' : ''}`}>
      {plan.id === 'professional' && (
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Most popular</div>
      )}
      <div className="plan-card-name">{plan.name}</div>
      <div className="plan-card-price">€{plan.price}<span>/month</span></div>
      <div className="plan-card-desc">{plan.desc}</div>
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 12 }}>
        {feats.map(f => (
          <div key={f} className="plan-feature">
            <div className="plan-feature-check">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 12 4 9"/>
              </svg>
            </div>
            {f}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <div>
      <div className="sec-hdr" style={{ marginBottom: 20 }}>
        <div>
          <div className="sec-hdr-title" style={{ fontSize: 16, fontWeight: 700 }}>Platform settings</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>DocksBase SaaS configuration</div>
        </div>
      </div>

      {/* Plan tiers */}
      <div style={{ marginBottom: 28 }}>
        <div className="sec-hdr"><div className="sec-hdr-title">Subscription plans</div></div>
        <div className="grid-3">
          {PLANS.map(p => <PlanCard key={p.id} plan={p} />)}
        </div>
      </div>

      {/* Trial & billing config */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><span className="card-header-title">Trial configuration</span></div>
          <div className="card-body">
            {[
              ['Trial period',          '30 days'],
              ['Trial features',        'Full Professional access'],
              ['Trial reminder (days)', '7, 3, 1'],
              ['Post-trial grace',      '3 days'],
              ['Suspension trigger',    'Grace period expired'],
            ].map(([k, v]) => (
              <div key={k} className="detail-row">
                <span className="detail-key">{k}</span>
                <span className="detail-val">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-header-title">Billing & payments</span></div>
          <div className="card-body">
            {[
              ['Payment processor', 'Stripe'],
              ['Billing cycle',     'Monthly'],
              ['Invoice day',       '1st of month'],
              ['Payment terms',     'Net 7'],
              ['Overdue suspension','After 45 days'],
              ['Currency',          'EUR (€)'],
            ].map(([k, v]) => (
              <div key={k} className="detail-row">
                <span className="detail-key">{k}</span>
                <span className="detail-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Platform info */}
      <div className="card">
        <div className="card-header"><span className="card-header-title">Platform</span></div>
        <div className="card-body">
          <div className="grid-3">
            {[
              ['Frontend',   'React 19 · Vite · Vercel'],
              ['Backend',    'Supabase · PostgreSQL'],
              ['Auth',       'Supabase Auth · JWT'],
              ['Payments',   'Stripe'],
              ['Email',      'SendGrid'],
              ['SMS',        'Twilio'],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: '12px 0', borderBottom: 'var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.75)' }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
