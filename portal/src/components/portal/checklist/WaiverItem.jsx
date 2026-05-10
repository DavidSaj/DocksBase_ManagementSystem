// portal/src/components/portal/checklist/WaiverItem.jsx
import { useState } from 'react';
import api from '../../../api';

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
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        The marina requires a signed waiver before arrival. Tap below to open the waiver in a new tab. Return here once you have signed.
      </p>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button className="p-btn p-btn--primary" disabled={loading} onClick={handleSign}>
        <svg style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 6, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        {loading ? 'Loading waiver…' : 'Sign Waiver'}
      </button>
      <button
        style={{ display: 'block', width: '100%', marginTop: 10, height: 44, background: 'transparent', border: 'none', fontSize: 14, color: 'rgba(0,0,0,0.4)', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}
        onClick={onUpdate}
      >
        I've already signed — refresh
      </button>
    </div>
  );
}
