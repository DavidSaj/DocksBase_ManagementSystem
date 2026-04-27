import { Link } from 'react-router-dom';

export default function StepConfirmation({ bookingId, slip, search }) {
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;
  const total = (slip?.pricePerNight || 0) * nights;

  return (
    <div>
      <div className="confirmation-box">
        <div className="confirmation-check">✓</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Booking confirmed</div>
        <div className="confirmation-id">{bookingId}</div>
        <div className="confirmation-label">Your booking reference</div>
      </div>

      <div className="summary-card">
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 16 }}>Booking summary</div>
        {[
          ['Berth',     `Slip ${slip?.id} · Pier ${slip?.pier}`],
          ['Arrival',   search?.arrival   || '—'],
          ['Departure', search?.departure || '—'],
          ['Nights',    nights],
          ['Total',     `€${total}`],
        ].map(([k, v]) => (
          <div key={k} className="detail-row">
            <span className="detail-key">{k}</span>
            <span className="detail-val" style={k === 'Total' ? { color: 'var(--gold)', fontSize: 14 } : {}}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: '16px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
        Your booking is now confirmed and visible to the marina team. Please have your booking reference ready on arrival. The harbor master will assign you a dock assistant on check-in.
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button className="btn-outline" onClick={() => alert('Calendar export coming soon')}>Add to calendar</button>
        <Link to="/" className="btn-gold">Back to home</Link>
      </div>
    </div>
  );
}
