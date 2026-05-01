import { useState, useEffect } from 'react';
import api from '../api.js';

const PLANS = [
  { id: 'starter',      name: 'Starter',      price: 149 },
  { id: 'professional', name: 'Professional',  price: 349 },
  { id: 'enterprise',   name: 'Enterprise',    price: 899 },
];

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

function FeatureFlags() {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState({});

  useEffect(() => {
    api.get('admin/feature-flags/')
      .then(r => setFlags(r.data))
      .catch(e => setError(e.message || 'Failed to load feature flags'))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(flag) {
    setToggling(t => ({ ...t, [flag.name]: true }));
    try {
      const { data } = await api.patch(`admin/feature-flags/${flag.name}/`, { enabled: !flag.enabled });
      setFlags(prev => prev.map(f => f.name === flag.name ? { ...f, enabled: data.enabled } : f));
    } catch (e) {
      // silently leave state unchanged on error
    } finally {
      setToggling(t => ({ ...t, [flag.name]: false }));
    }
  }

  if (loading) return <div style={{ padding: 16, color: 'rgba(0,0,0,0.38)', fontSize: 12 }}>Loading feature flags…</div>;
  if (error)   return <div style={{ padding: 16, color: 'var(--red)', fontSize: 12 }}>{error}</div>;

  return (
    <>
      {flags.map(flag => (
        <div key={flag.name} className="detail-row" style={{ alignItems: 'center' }}>
          <span className="detail-key" style={{ fontFamily: 'monospace', fontSize: 12 }}>{flag.name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`badge ${flag.enabled ? 'badge-green' : 'badge-gray'}`}>
              {flag.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              className="btn-sm"
              onClick={() => handleToggle(flag)}
              disabled={!!toggling[flag.name]}
              style={{ fontSize: 11, opacity: toggling[flag.name] ? 0.5 : 1 }}
            >
              {toggling[flag.name] ? '…' : flag.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        </div>
      ))}
    </>
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
      <div className="card" style={{ marginBottom: 24 }}>
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

      {/* Feature flags */}
      <div className="sec-hdr"><div className="sec-hdr-title">Feature flags</div></div>
      <div className="card">
        <div className="card-body">
          <FeatureFlags />
        </div>
      </div>
    </div>
  );
}
