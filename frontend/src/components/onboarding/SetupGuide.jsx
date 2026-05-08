import { useState } from 'react';
import useOnboarding from '../../hooks/useOnboarding.js';
import StripeGateModal from './StripeGateModal.jsx';

const STEPS = [
  {
    key: 'add_berths',
    icon: '⚓',
    label: 'Add your piers & berths',
    desc: 'Define the physical layout — piers first, then individual berths.',
    screen: 'infrastructure',
    manual: true,
  },
  {
    key: 'draw_map',
    icon: '🗺',
    label: 'Draw your marina map',
    desc: 'Place berths visually so managers see the marina at a glance.',
    screen: 'map',
    manual: true,
  },
  {
    key: 'set_pricing',
    icon: '💶',
    label: 'Set up pricing',
    desc: 'Add rate cards and fees before taking your first booking.',
    screen: 'billing',
    manual: true,
  },
  {
    key: 'add_member',
    icon: '👤',
    label: 'Add your first member',
    desc: 'Register a boater so you can assign berths and raise invoices.',
    screen: 'members',
    manual: true,
  },
  {
    key: 'connect_bank',
    icon: '🏦',
    label: 'Connect bank account',
    desc: 'Link Stripe so online payments go straight to your account.',
    screen: null,
    manual: false,
    stripe: true,
  },
  {
    key: 'invite_staff',
    icon: '🧑‍✈',
    label: 'Invite a team member',
    desc: 'Give your harbour master or office staff access to DocksBase.',
    screen: 'staff',
    manual: false,
  },
];

const TOTAL = STEPS.length;

function CheckDone() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="9" fill="#1a8c2e"/>
      <polyline points="4.5,9 7.5,12 13.5,6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function CheckTodo({ active }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="8" stroke={active ? 'var(--navy)' : 'rgba(0,0,0,0.18)'} strokeWidth="1.8"/>
      {active && <circle cx="9" cy="9" r="3.5" fill="var(--navy)"/>}
    </svg>
  );
}

export default function SetupGuide({ setScreen }) {
  const { onboarding, loading, markStep, allDone } = useOnboarding();
  const [stripeOpen, setStripeOpen]   = useState(false);
  const [collapsed, setCollapsed]     = useState(false);
  const [dismissed, setDismissed]     = useState(() => localStorage.getItem('setup_guide_dismissed') === '1');

  if (loading || !onboarding || allDone) return null;
  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 300,
          background: 'var(--navy)', color: '#fff',
          border: 'none', borderRadius: 24, padding: '9px 18px',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <span style={{ fontSize: 15 }}>🚀</span> Get Started
      </button>
    );
  }

  const completed  = STEPS.filter(s => onboarding[s.key]).length;
  const pct        = Math.round((completed / TOTAL) * 100);
  const nextIdx    = STEPS.findIndex(s => !onboarding[s.key]);

  function handleStep(step) {
    if (onboarding[step.key]) return;
    if (step.stripe) { setStripeOpen(true); return; }
    if (step.manual) markStep(step.key);
    if (step.screen) setScreen?.(step.screen);
  }

  function dismiss() {
    localStorage.setItem('setup_guide_dismissed', '1');
    setDismissed(true);
  }

  return (
    <>
      <div style={{
        position: 'fixed',
        top: 68,
        right: 20,
        width: 300,
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.07)',
        zIndex: 200,
        overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.08)',
      }}>
        {/* Header */}
        <div style={{
          background: 'var(--navy)',
          padding: collapsed ? '14px 16px' : '16px 16px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 10 }}>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '-0.2px' }}>
                🚀 Get started with DocksBase
              </div>
              {!collapsed && (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 }}>
                  {completed} of {TOTAL} steps complete
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setCollapsed(c => !c)}
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title={collapsed ? 'Expand' : 'Collapse'}
              >
                {collapsed ? '▲' : '▼'}
              </button>
              <button
                onClick={dismiss}
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: 'rgba(255,255,255,0.7)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="Dismiss"
              >
                ×
              </button>
            </div>
          </div>

          {!collapsed && (
            <div style={{ height: 5, background: 'rgba(255,255,255,0.15)', borderRadius: 3 }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: pct === 100 ? 'var(--green)' : 'var(--gold)',
                width: pct + '%',
                transition: 'width 0.4s ease',
              }} />
            </div>
          )}
        </div>

        {/* Steps */}
        {!collapsed && (
          <div style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
            {STEPS.map((step, idx) => {
              const done   = !!onboarding[step.key];
              const active = idx === nextIdx;
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => handleStep(step)}
                  disabled={done}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    width: '100%', padding: '12px 16px',
                    background: active ? 'rgba(12,31,61,0.04)' : 'transparent',
                    border: 'none', borderBottom: '1px solid rgba(0,0,0,0.06)',
                    cursor: done ? 'default' : 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!done) e.currentTarget.style.background = 'rgba(12,31,61,0.06)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = active ? 'rgba(12,31,61,0.04)' : 'transparent'; }}
                >
                  <div style={{ flexShrink: 0, marginTop: 1 }}>
                    {done ? <CheckDone /> : <CheckTodo active={active} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 600,
                      color: done ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.85)',
                      textDecoration: done ? 'line-through' : 'none',
                      marginBottom: done ? 0 : 2,
                    }}>
                      <span style={{ marginRight: 5 }}>{step.icon}</span>
                      {step.label}
                    </div>
                    {!done && (
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.42)', lineHeight: 1.4 }}>
                        {step.desc}
                      </div>
                    )}
                  </div>
                  {!done && (
                    <div style={{ flexShrink: 0, color: 'rgba(0,0,0,0.25)', fontSize: 14, marginTop: 1 }}>›</div>
                  )}
                </button>
              );
            })}

            <div style={{ padding: '10px 16px', fontSize: 11, color: 'rgba(0,0,0,0.3)', textAlign: 'center' }}>
              You can dismiss this guide at any time
            </div>
          </div>
        )}
      </div>

      <StripeGateModal open={stripeOpen} onClose={() => setStripeOpen(false)} />
    </>
  );
}
