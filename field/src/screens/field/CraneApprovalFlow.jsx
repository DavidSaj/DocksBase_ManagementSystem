import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };

const SERVICE_LABEL = { launch: 'Launch', haul_out: 'Haul-out', both: 'Launch & Haul-out' };

export default function CraneApprovalFlow({ onBack }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(null);

  useEffect(() => {
    api.get('/portal/crane-requests/staff/', { params: { status: 'requested' } })
      .then(r => setRequests(r.data.results ?? r.data))
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(id, newStatus) {
    setActing(id);
    try {
      await api.patch(`/portal/crane-requests/${id}/staff-update/`, { status: newStatus });
      setRequests(prev => prev.filter(r => r.id !== id));
    } finally {
      setActing(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Crane Requests</span>
        {requests.length > 0 && (
          <span style={{ marginLeft: 'auto', background: '#d4b07a', color: '#1a2d4a', borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
            {requests.length}
          </span>
        )}
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏗️</div>
          <div style={{ fontSize: 15 }}>No pending crane requests.</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map(r => (
            <div key={r.id} style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{r.member_name}</div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 2 }}>{SERVICE_LABEL[r.service_type] || r.service_type}</div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: r.notes ? 8 : 12 }}>{r.requested_date}</div>
              {r.notes && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', marginBottom: 12 }}>{r.notes}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button disabled={acting === r.id} onClick={() => handleAction(r.id, 'approved')}
                  style={{ flex: 1, height: 44, borderRadius: 10, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ✅ Approve
                </button>
                <button disabled={acting === r.id} onClick={() => handleAction(r.id, 'rejected')}
                  style={{ flex: 1, height: 44, borderRadius: 10, background: '#f4f6f8', color: '#c0392b', border: '1.5px solid rgba(192,57,43,0.3)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
