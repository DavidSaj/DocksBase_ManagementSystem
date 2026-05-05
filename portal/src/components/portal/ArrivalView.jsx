import { useState } from 'react';
import api from '../../api';

const PULSE_STYLE = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
`;

export default function ArrivalView({ booking, onCheckedIn }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function handleArrive() {
    setLoading(true); setError(null);
    try {
      await api.post(`/portal/checkin/bookings/${booking.id}/self-checkin/`);
      onCheckedIn();
    } catch {
      setError('Check-in failed. Please try again or contact the harbour master.');
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', flexDirection: 'column' }}>
      <style>{PULSE_STYLE}</style>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Welcome!</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Ready to check in</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
        {booking.berth_code && (
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Your Berth</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#1a2d4a' }}>{booking.berth_pier} · {booking.berth_code}</div>
          </div>
        )}
        {error && (
          <div style={{ color: '#c0392b', fontSize: 14, marginBottom: 20, textAlign: 'center' }}>{error}</div>
        )}
        <button
          onClick={handleArrive}
          disabled={loading}
          style={{
            width: '100%', maxWidth: 400, height: 80, borderRadius: 16,
            background: loading ? '#888' : '#1a2d4a', color: '#fff', border: 'none',
            fontSize: 18, fontWeight: 800, cursor: loading ? 'wait' : 'pointer',
            animation: loading ? 'none' : 'pulse 2s ease-in-out infinite',
            letterSpacing: 0.5,
          }}
        >
          {loading ? 'Checking you in…' : 'I Have Arrived — Self Check-In'}
        </button>
      </div>
    </div>
  );
}
