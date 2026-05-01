import { useState } from 'react';
import useOnboarding from '../../hooks/useOnboarding.js';
import StripeGateModal from './StripeGateModal.jsx';

const CheckFilled = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="8" fill="#38a860"/>
    <polyline points="4,8 7,11 12,5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const CheckEmpty = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5"/>
  </svg>
);

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

export default function SetupGuide({ setScreen }) {
  const { onboarding, loading, markStep, allDone } = useOnboarding();
  const [stripeModalOpen, setStripeModalOpen] = useState(false);

  if (loading || !onboarding || allDone) return null;

  const steps = [
    {
      key: 'draw_map',
      label: 'Draw your marina map',
      action: () => { markStep('draw_map'); setScreen?.('map'); },
      manual: true,
    },
    {
      key: 'set_pricing',
      label: 'Set your pricing',
      action: () => { markStep('set_pricing'); setScreen?.('billing'); },
      manual: true,
    },
    {
      key: 'connect_bank',
      label: 'Connect bank account',
      action: () => setStripeModalOpen(true),
      manual: false,
    },
    {
      key: 'invite_staff',
      label: 'Invite your first team member',
      action: () => setScreen?.('staff'),
      manual: false,
    },
  ];

  const completed = steps.filter(s => onboarding[s.key]).length;

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header" style={{ alignItems: 'center' }}>
          <div>
            <div className="card-header-title">Get started with DocksBase</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{completed} of 4 complete</div>
          </div>
          <div style={{ flex: 1, marginLeft: 16, height: 4, background: 'rgba(0,0,0,0.08)', borderRadius: 2 }}>
            <div style={{
              height: '100%',
              borderRadius: 2,
              background: 'var(--navy)',
              width: `${(completed / 4) * 100}%`,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
        <div className="card-body" style={{ padding: '4px 0' }}>
          {steps.map(step => {
            const done = !!onboarding[step.key];
            return (
              <button
                key={step.key}
                type="button"
                onClick={done ? undefined : step.action}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: 'var(--border)',
                  cursor: done ? 'default' : 'pointer',
                  textAlign: 'left',
                  opacity: done ? 0.45 : 1,
                }}
              >
                {done ? <CheckFilled /> : <CheckEmpty />}
                <span style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: done ? 'line-through' : 'none',
                  color: 'rgba(0,0,0,0.75)',
                }}>
                  {step.label}
                </span>
                {!done && <Chevron />}
              </button>
            );
          })}
        </div>
      </div>

      <StripeGateModal open={stripeModalOpen} onClose={() => setStripeModalOpen(false)} />
    </>
  );
}
