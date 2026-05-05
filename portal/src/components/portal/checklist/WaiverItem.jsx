import { useState } from 'react';
import api from '../../../api';

const BTN = {
  width: '100%', height: 52, borderRadius: 12, background: '#1a2d4a',
  color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer',
};

export default function WaiverItem({ booking, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function handleSign() {
    setLoading(true); setError(null);
    try {
      const res = await api.post(`/portal/checkin/bookings/${booking.id}/waiver/`);
      window.open(res.data.sign_url, '_blank', 'noopener,noreferrer');
      setTimeout(onUpdate, 3000);
    } catch {
      setError('Could not load the waiver. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        The marina requires a signed waiver before arrival. Tap below to open the waiver in a new tab. Return here once you have signed.
      </div>
      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <button style={BTN} disabled={loading} onClick={handleSign}>
        {loading ? 'Loading waiver…' : '📝 Sign Waiver'}
      </button>
      <button
        style={{ width: '100%', marginTop: 10, height: 44, background: 'transparent', border: 'none', fontSize: 14, color: 'rgba(0,0,0,0.4)', cursor: 'pointer' }}
        onClick={onUpdate}
      >
        I've already signed — refresh
      </button>
    </div>
  );
}
