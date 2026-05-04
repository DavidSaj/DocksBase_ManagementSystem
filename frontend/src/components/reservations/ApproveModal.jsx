import { useState, useEffect } from 'react';
import api from '../../api.js';

export default function ApproveModal({ booking, onClose, onApproved }) {
  const [berths, setBerths] = useState([]);
  const [selectedBerth, setSelectedBerth] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nights = Math.round(
    (new Date(booking.check_out) - new Date(booking.check_in)) / 86_400_000
  );

  useEffect(() => {
    api.get('/berths/', { params: { capable_for: booking.id } })
      .then(r => setBerths(r.data.results ?? r.data))
      .catch(() => setError('Could not load berths.'));
  }, [booking.id]);

  useEffect(() => {
    if (!selectedBerth) { setPreview(null); return; }
    const berth_cost = parseFloat(selectedBerth.pricing_tier_unit_price || 0) * nights;
    setPreview({ berth_cost, total: berth_cost });
  }, [selectedBerth, nights]);

  const handleConfirm = async () => {
    if (!selectedBerth) return;
    setBusy(true);
    setError('');
    try {
      const resp = await api.post(`/bookings/${booking.id}/approve/`, { berth_id: selectedBerth.id });
      onApproved(resp.data.checkout_url);
    } catch (e) {
      setError(e.response?.data?.detail || 'Approval failed. Please try again.');
      setBusy(false);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const modal = { background: '#fff', borderRadius: 12, padding: 28, width: 420, maxHeight: '90vh', overflowY: 'auto' };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Approve Booking</div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>
          {booking.guest_name} · {booking.check_in} – {booking.check_out} ({nights} night{nights !== 1 ? 's' : ''})
        </div>
        <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 6, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase' }}>
          Select Berth
        </label>
        <select
          value={selectedBerth?.id || ''}
          onChange={e => setSelectedBerth(berths.find(b => b.id === +e.target.value) || null)}
          style={{ width: '100%', padding: '9px 10px', fontSize: 14, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6, marginBottom: 16 }}
        >
          <option value="">— choose a berth —</option>
          {berths.map(b => (
            <option key={b.id} value={b.id}>
              {b.code}{b.pier_code ? ` (${b.pier_code})` : ''} — {b.length_m}m × {b.max_beam_m}m
            </option>
          ))}
        </select>
        {preview && (
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Berth ({nights} night{nights !== 1 ? 's' : ''})</span>
              <span>€{preview.berth_cost.toFixed(2)}</span>
            </div>
          </div>
        )}
        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '10px 0', background: 'none', border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedBerth || busy}
            style={{ flex: 2, padding: '10px 0', background: selectedBerth ? '#1d4ed8' : '#94a3b8', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: selectedBerth ? 'pointer' : 'not-allowed', fontSize: 14 }}
          >
            {busy ? 'Processing…' : 'Confirm & Send Payment Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
