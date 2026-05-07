export default function BookingConfirmed({ marina, bookingId, cancelled }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{cancelled ? '❌' : '✅'}</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          {cancelled ? 'Payment cancelled' : 'Booking confirmed!'}
        </div>
        <div style={{ fontSize: 15, color: 'rgba(0,0,0,0.5)', marginBottom: 24 }}>
          {cancelled
            ? 'Your payment was not completed. Your spot has not been reserved.'
            : `Your berth at ${marina?.name ?? 'the marina'} is booked. Check your email for details and your check-in link.`}
        </div>
        {cancelled && (
          <a
            href={window.location.pathname.replace('/cancelled', '')}
            style={{ fontSize: 14, color: 'var(--teal, #0d9488)', textDecoration: 'underline' }}
          >
            Try again
          </a>
        )}
      </div>
    </div>
  );
}
