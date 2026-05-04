export default function BookingRequestSent({ marina }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 40, maxWidth: 480, width: '100%', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚓</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 22 }}>Request received!</h2>
        <p style={{ color: 'rgba(0,0,0,0.55)', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          Thank you for your request at <strong>{marina?.name || 'the marina'}</strong>.
          The harbour master will review it within 24 hours and send you a payment link by email.
        </p>
      </div>
    </div>
  );
}
