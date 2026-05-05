const HDR = { background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' };
const CARD = { background: '#fff', borderRadius: 14, padding: 24, margin: '16px 16px 0', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', textAlign: 'center' };

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const arrival = new Date(dateStr);
  return Math.ceil((arrival - today) / 86400000);
}

export default function CountdownView({ booking }) {
  const days = daysUntil(booking.check_in);
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>You're all set!</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Pre-arrival checklist complete</div>
      </div>
      <div style={CARD}>
        <div style={{ fontSize: 60, fontWeight: 800, color: '#1a2d4a', lineHeight: 1 }}>{days}</div>
        <div style={{ fontSize: 16, color: 'rgba(0,0,0,0.5)', marginTop: 6 }}>
          {days === 1 ? 'day until arrival' : 'days until arrival'}
        </div>
        <div style={{ marginTop: 20, fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>
          Arriving {booking.check_in} · Departing {booking.check_out}
        </div>
      </div>
      <div style={{ margin: '12px 16px', background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your Berth</div>
        {booking.berth_code
          ? <div style={{ fontSize: 20, fontWeight: 700 }}>{booking.berth_pier} · {booking.berth_code}</div>
          : <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.4)' }}>Berth will be assigned before arrival</div>
        }
      </div>
    </div>
  );
}
