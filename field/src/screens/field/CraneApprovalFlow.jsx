import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

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
    <div className="f-screen">
      <div className="f-topbar">
        <button className="f-dw-back" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
          Back
        </button>
        <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>Crane Requests</span>
        {requests.length > 0 ? (
          <span className="f-pill f-pill--gold">{requests.length}</span>
        ) : <span style={{ width: 50 }} />}
      </div>
      {loading ? (
        <div className="f-dw-loading">Loading…</div>
      ) : requests.length === 0 ? (
        <div className="f-dw-loading" style={{ padding: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="crane" size={36} color="var(--db-on-dark-faint)" />
          </div>
          <div style={{ fontSize: 15 }}>No pending crane requests.</div>
        </div>
      ) : (
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
          {requests.map(r => (
            <div key={r.id} className="f-card">
              <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 2 }}>{r.member_name}</div>
              <div style={{ fontSize: 13, color: 'var(--db-gold-light)', marginBottom: 2, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>{SERVICE_LABEL[r.service_type] || r.service_type}</div>
              <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: r.notes ? 8 : 12 }}>{r.requested_date}</div>
              {r.notes && <div style={{ fontSize: 13, color: 'var(--db-on-dark-soft)', marginBottom: 12 }}>{r.notes}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button disabled={acting === r.id} onClick={() => handleAction(r.id, 'approved')} className="f-btn-primary" style={{ flex: 1 }}>
                  Approve
                </button>
                <button disabled={acting === r.id} onClick={() => handleAction(r.id, 'rejected')}
                  style={{ flex: 1, height: 48, borderRadius: 'var(--db-radius-sm)', background: 'rgba(224,85,85,0.12)', color: 'var(--db-status-red)', border: '1px solid rgba(224,85,85,0.3)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--db-font-sans)' }}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
