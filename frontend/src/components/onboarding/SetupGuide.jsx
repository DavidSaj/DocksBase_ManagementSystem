import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Ic from '../ui/Icon.jsx';
import useOnboarding from '../../hooks/useOnboarding.js';
import StripeGateModal from './StripeGateModal.jsx';

const STEPS = [
  {
    key:    'add_berths',
    icon:   'anchor',
    label:  'Add piers & berths',
    desc:   'Define your marina structure — create piers first, then add individual berths to each.',
    screen: 'infrastructure',
    cta:    'Go to Infrastructure',
    manual: true,
  },
  {
    key:    'draw_map',
    icon:   'map',
    label:  'Draw your marina map',
    desc:   'Place berths on a visual canvas so staff can see the layout at a glance.',
    screen: 'map',
    cta:    'Open Map Editor',
    manual: true,
  },
  {
    key:    'set_pricing',
    icon:   'dollar',
    label:  'Set up pricing',
    desc:   'Add rate cards and service fees before taking your first booking.',
    screen: 'billing',
    cta:    'Go to Billing',
    manual: true,
  },
  {
    key:    'add_member',
    icon:   'users',
    label:  'Add your first member',
    desc:   'Register a boater so you can assign berths and raise invoices.',
    screen: 'members',
    cta:    'Go to Members',
    manual: true,
  },
  {
    key:    'connect_bank',
    icon:   'shield',
    label:  'Connect bank account',
    desc:   'Link Stripe so online payments are paid directly into your account.',
    screen: null,
    cta:    'Connect via Stripe',
    manual: false,
    stripe: true,
  },
  {
    key:    'invite_staff',
    icon:   'user-check',
    label:  'Invite a team member',
    desc:   'Give your harbour master or office staff access to DocksBase.',
    screen: 'staff',
    cta:    'Go to Staff',
    manual: false,
  },
];

const TOTAL = STEPS.length;

// Checkmark for completed steps
function CheckDone() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <polyline points="2.5,7.5 6,11 12.5,4" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function StepRow({ step, done, active, onAction, onActivate }) {
  return (
    <div
      style={{
        padding: '0 0',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        transition: 'background 0.15s',
      }}
    >
      <div
        onClick={done ? undefined : onActivate}
        style={{
          display: 'flex', alignItems: 'center', gap: 13,
          padding: '13px 20px',
          cursor: done ? 'default' : 'pointer',
          background: active ? 'rgba(12,31,61,0.035)' : 'transparent',
          borderLeft: `2.5px solid ${active ? 'var(--navy)' : 'transparent'}`,
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        {/* Icon badge */}
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: done
            ? 'rgba(26,140,46,0.09)'
            : active
              ? 'var(--navy)'
              : 'rgba(0,0,0,0.05)',
          transition: 'background 0.2s',
        }}>
          {done
            ? <CheckDone />
            : <Ic n={step.icon} s={15} c={active ? '#fff' : 'rgba(0,0,0,0.45)'} />
          }
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: done ? 400 : 500,
            color: done ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.82)',
            textDecoration: done ? 'line-through' : 'none',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {step.label}
          </div>
        </div>

        {!done && !active && (
          <Ic n="chevron" s={13} c="rgba(0,0,0,0.2)" />
        )}
      </div>

      {/* Expanded content for active step */}
      <AnimatePresence initial={false}>
        {active && !done && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 20px 16px 65px' }}>
              <div style={{
                fontSize: 12, color: 'rgba(0,0,0,0.48)', lineHeight: 1.55, marginBottom: 12,
              }}>
                {step.desc}
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={onAction}
                style={{ fontSize: 12 }}
              >
                {step.cta}
                <Ic n="chevron" s={11} c="#fff" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SetupGuide({ setScreen }) {
  const { onboarding, loading, markStep, allDone } = useOnboarding();
  const [stripeOpen, setStripeOpen] = useState(false);
  const [open, setOpen]             = useState(true);
  const [activeKey, setActiveKey]   = useState(null);

  if (loading || !onboarding || allDone) return null;

  const completed = STEPS.filter(s => onboarding[s.key]).length;
  const pct       = Math.round((completed / TOTAL) * 100);

  // First incomplete step, unless user manually activated another
  const firstIncomplete = STEPS.find(s => !onboarding[s.key])?.key ?? null;
  const resolvedActive  = activeKey && !onboarding[activeKey] ? activeKey : firstIncomplete;

  function handleAction(step) {
    if (step.stripe) { setStripeOpen(true); return; }
    if (step.manual) markStep(step.key);
    if (step.screen) setScreen?.(step.screen);
    // advance to next
    setActiveKey(null);
  }

  function handleActivate(step) {
    setActiveKey(prev => (prev === step.key ? null : step.key));
  }

  return (
    <>
      {/* Floating trigger when closed */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(true)}
            style={{
              position: 'fixed', bottom: 24, right: 24, zIndex: 300,
              background: 'var(--navy)', color: '#fff',
              border: 'none', borderRadius: 24,
              padding: '9px 16px 9px 12px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <Ic n="check-circle" s={14} c="rgba(255,255,255,0.7)" />
            Setup guide
            <span style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: 12, padding: '1px 7px', fontSize: 11,
            }}>
              {completed}/{TOTAL}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Main panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 340, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320, opacity: { duration: 0.15 } }}
            style={{
              position: 'fixed',
              top: 68, right: 20,
              width: 300,
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 4px 24px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',
              border: '1px solid rgba(0,0,0,0.08)',
              zIndex: 200,
              overflow: 'hidden',
              maxHeight: 'calc(100vh - 88px)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid rgba(0,0,0,0.07)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.85)', letterSpacing: '-0.2px' }}>
                    Setup guide
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                    {completed === TOTAL ? 'All done!' : `${completed} of ${TOTAL} steps complete`}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(0,0,0,0.3)', padding: 4, borderRadius: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'color 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'rgba(0,0,0,0.6)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(0,0,0,0.3)'}
                  title="Minimise"
                >
                  <Ic n="x" s={15} />
                </button>
              </div>

              {/* Progress bar */}
              <div style={{ height: 4, background: 'rgba(0,0,0,0.07)', borderRadius: 2 }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: pct === 100 ? 'var(--green)' : 'var(--navy)',
                  width: pct + '%',
                  transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                }} />
              </div>
            </div>

            {/* Step list */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {STEPS.map(step => (
                <StepRow
                  key={step.key}
                  step={step}
                  done={!!onboarding[step.key]}
                  active={resolvedActive === step.key}
                  onAction={() => handleAction(step)}
                  onActivate={() => handleActivate(step)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <StripeGateModal open={stripeOpen} onClose={() => setStripeOpen(false)} />
    </>
  );
}
