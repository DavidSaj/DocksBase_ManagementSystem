export default function BookingConfirmed({ marina, bookingId, cancelled }) {
  const slug = window.location.pathname.split('/').filter(Boolean)[0] ?? '';

  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
        {marina && <span className="p-nav-marina">— {marina.name}</span>}
      </nav>
      <div className="p-shell" style={{ maxWidth: 560 }}>
        <div className="p-confirmed-box">
          <div className="p-confirmed-check">{cancelled ? '✕' : '✓'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {cancelled ? 'Payment cancelled' : 'Booking confirmed'}
          </div>
          {!cancelled && bookingId && (
            <div className="p-confirmed-id">#{bookingId}</div>
          )}
        </div>

        {cancelled ? (
          <>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, textAlign: 'center' }}>
              Your payment was not completed and no charge was made.
            </p>
            <div style={{ textAlign: 'center' }}>
              <a href={`/${slug}`} className="p-btn-gold">Try again</a>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
              Your booking is confirmed and visible to the marina team. Your berth details and arrival information will be available in your client portal.
            </div>
          </>
        )}
      </div>
    </>
  );
}
