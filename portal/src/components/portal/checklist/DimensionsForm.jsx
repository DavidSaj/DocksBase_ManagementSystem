import { useState } from 'react';
import api from '../../../api';

const INPUT = {
  width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 10,
  border: '1.5px solid rgba(0,0,0,0.15)', boxSizing: 'border-box', marginBottom: 12,
};
const BTN = {
  width: '100%', height: 52, borderRadius: 12, background: '#1a2d4a',
  color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer',
};

export default function DimensionsForm({ booking, onUpdate }) {
  const [loa, setLoa]     = useState(booking.boat_loa   ?? '');
  const [beam, setBeam]   = useState(booking.boat_beam  ?? '');
  const [draft, setDraft] = useState(booking.boat_draft ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api.patch(`/portal/checkin/bookings/${booking.id}/dimensions/`, {
        boat_loa: loa, boat_beam: beam, boat_draft: draft,
      });
      onUpdate();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input style={INPUT} type="number" step="0.01" min="0" placeholder="Length Overall (m)" value={loa} onChange={e => setLoa(e.target.value)} required />
      <input style={INPUT} type="number" step="0.01" min="0" placeholder="Beam (m)" value={beam} onChange={e => setBeam(e.target.value)} required />
      <input style={INPUT} type="number" step="0.01" min="0" placeholder="Draft (m)" value={draft} onChange={e => setDraft(e.target.value)} required />
      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <button type="submit" style={BTN} disabled={saving}>{saving ? 'Saving…' : 'Save Dimensions'}</button>
    </form>
  );
}
