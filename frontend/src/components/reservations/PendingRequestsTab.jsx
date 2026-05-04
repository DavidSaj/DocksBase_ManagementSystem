import { useState, useEffect } from 'react';
import api from '../../api.js';
import ApproveModal from './ApproveModal.jsx';

function timeSince(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PendingRequestsTab({ onApproved }) {
  const [bookings, setBookings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [approving, setApproving] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get('/bookings/', { params: { status: 'pending_approval' } })
      .then(r => {
        const items = r.data.results ?? r.data;
        setBookings([...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
      });

  useEffect(() => { load(); }, []);

  const handleReject = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/${rejectTarget.id}/reject/`, { reason: rejectReason });
      setRejectTarget(null);
      setRejectReason('');
      setSelected(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const cell = { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid rgba(0,0,0,0.06)' };

  if (bookings.length === 0) {
    return <div style={{ padding: 32, color: 'rgba(0,0,0,0.4)', textAlign: 'center' }}>No pending requests.</div>;
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
          {['Guest', 'Dates', 'Dimensions', 'Submitted'].map(h => (
            <div key={h} style={{ ...cell, fontWeight: 600, fontSize: 11, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>{h}</div>
          ))}
          {bookings.map(b => (
            <div key={b.id} style={{ display: 'contents', cursor: 'pointer' }} onClick={() => setSelected(b)}>
              <div style={{ ...cell, background: selected?.id === b.id ? 'rgba(37,99,235,0.06)' : 'transparent' }}>{b.guest_name || '—'}</div>
              <div style={{ ...cell, background: selected?.id === b.id ? 'rgba(37,99,235,0.06)' : 'transparent' }}>{b.check_in} – {b.check_out}</div>
              <div style={{ ...cell, background: selected?.id === b.id ? 'rgba(37,99,235,0.06)' : 'transparent' }}>{b.boat_loa}m × {b.boat_beam}m × {b.boat_draft}m</div>
              <div style={{ ...cell, background: selected?.id === b.id ? 'rgba(37,99,235,0.06)' : 'transparent' }}>{timeSince(b.created_at)}</div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div style={{ width: 320, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: 20, flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>{selected.guest_name}</div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', marginBottom: 4 }}>{selected.guest_email}</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{selected.check_in} – {selected.check_out}</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            LOA {selected.boat_loa}m · Beam {selected.boat_beam}m · Draft {selected.boat_draft}m
          </div>
          <button
            onClick={() => setApproving(true)}
            style={{ width: '100%', padding: '10px 0', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}
          >
            Approve…
          </button>
          {rejectTarget?.id === selected.id ? (
            <div>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason for rejection…"
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 13, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 4, marginBottom: 8, resize: 'vertical' }}
              />
              <button
                onClick={handleReject}
                disabled={busy || !rejectReason.trim()}
                style={{ width: '100%', padding: '8px 0', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
              >
                {busy ? 'Sending…' : 'Send Rejection'}
              </button>
              <button
                onClick={() => setRejectTarget(null)}
                style={{ width: '100%', padding: '6px 0', marginTop: 6, background: 'none', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setRejectTarget(selected)}
              style={{ width: '100%', padding: '8px 0', background: 'none', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
            >
              Reject
            </button>
          )}
        </div>
      )}

      {approving && (
        <ApproveModal
          booking={selected}
          onClose={() => setApproving(false)}
          onApproved={() => { setApproving(false); setSelected(null); load(); onApproved?.(); }}
        />
      )}
    </div>
  );
}
