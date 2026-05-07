import { HarbourScene } from '../components/portal/HarbourScene';

export default function BookingRequestSent({ marina }) {
  return (
    <div className="p-shell" style={{ position: 'relative', overflow: 'hidden' }}>
      <HarbourScene opacity={0.35} />
      <nav style={{ maxWidth: 880, margin: '0 auto', padding: '0 32px', height: 56, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', position: 'relative', zIndex: 1 }}>
        <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)' }}>
          {marina?.name || 'DocksBase'}
        </span>
      </nav>
      <div className="p-shell-inner" style={{ maxWidth: 600, position: 'relative', zIndex: 1 }}>
        <div className="p-confirmed-box">
          <div className="p-confirmed-check">✓</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Request received</div>
          <div className="p-confirmed-id" style={{ fontSize: 16, letterSpacing: 1 }}>Pending review</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
          The harbour master will review your request and respond within 24 hours. You will receive a confirmation email with next steps once approved.
        </div>
      </div>
    </div>
  );
}
