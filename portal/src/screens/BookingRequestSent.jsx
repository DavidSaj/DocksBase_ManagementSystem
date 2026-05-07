export default function BookingRequestSent({ marina }) {
  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
        {marina && <span className="p-nav-marina">— {marina.name}</span>}
      </nav>
      <div className="p-shell" style={{ maxWidth: 560 }}>
        <div className="p-confirmed-box">
          <div className="p-confirmed-check">✓</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Request received</div>
          <div className="p-confirmed-id" style={{ fontSize: 16, letterSpacing: 1 }}>Pending review</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
          The harbour master will review your request and respond within 24 hours. You will receive a confirmation email with next steps once approved.
        </div>
      </div>
    </>
  );
}
