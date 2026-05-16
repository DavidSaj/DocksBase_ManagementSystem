import { useState, useEffect } from 'react';
import api from '../../api.js';

const EVENT_LABELS = {
  mfa_enrolled:           'MFA enabled',
  mfa_disabled:           'MFA disabled',
  mfa_failed:             'MFA verification failed',
  mfa_succeeded:          'MFA verified',
  backup_code_used:       'Backup code used',
  ip_allowlist_added:     'IP allowlist entry added',
  ip_allowlist_removed:   'IP allowlist entry removed',
  ip_blocked:             'IP blocked',
  password_changed:       'Password changed',
  email_reverified:       'Email re-verified',
  api_key_created:        'API key created',
  api_key_revoked:        'API key revoked',
  api_key_deleted:        'API key deleted',
};

function formatTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditLogModal({ onClose }) {
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { fetchPage(page); }, [page]);

  async function fetchPage(p) {
    setLoading(true);
    try {
      const { data } = await api.get(`/security/audit/?page=${p}`);
      const results = Array.isArray(data) ? data : data.results ?? [];
      setEvents(results);
      if (!Array.isArray(data)) {
        setHasNext(!!data.next);
        setHasPrev(!!data.previous);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  function toggleExpand(id) {
    setExpanded(prev => prev === id ? null : id);
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose?.()}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 720, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Security Audit Log</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.4)', lineHeight: 1 }}>×</button>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>Loading…</div>
          ) : events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>No events recorded yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Time', 'Event', 'Actor', 'IP', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px 10px 0', color: 'rgba(0,0,0,0.4)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <>
                    <tr key={ev.id} style={{ borderBottom: expanded === ev.id ? 'none' : '1px solid rgba(0,0,0,0.05)', cursor: ev.payload ? 'pointer' : 'default' }}
                      onClick={() => ev.payload && toggleExpand(ev.id)}
                    >
                      <td style={{ padding: '9px 8px 9px 0', whiteSpace: 'nowrap', color: 'rgba(0,0,0,0.55)' }}>{formatTs(ev.created_at)}</td>
                      <td style={{ padding: '9px 8px', fontWeight: 500 }}>{EVENT_LABELS[ev.event_type] || ev.event_type}</td>
                      <td style={{ padding: '9px 8px', color: 'rgba(0,0,0,0.65)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.actor_email || '—'}
                      </td>
                      <td style={{ padding: '9px 8px', fontFamily: 'monospace', color: 'rgba(0,0,0,0.5)' }}>{ev.ip_address || '—'}</td>
                      <td style={{ padding: '9px 0', textAlign: 'right' }}>
                        {ev.payload && (
                          <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', userSelect: 'none' }}>
                            {expanded === ev.id ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                    </tr>
                    {expanded === ev.id && ev.payload && (
                      <tr key={`${ev.id}-payload`}>
                        <td colSpan={5} style={{ padding: '0 0 10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                          <pre style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--bg)', borderRadius: 6, padding: '10px 12px', margin: 0, overflow: 'auto', maxHeight: 200, color: 'rgba(0,0,0,0.65)' }}>
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, flexShrink: 0, borderTop: '1px solid rgba(0,0,0,0.07)', paddingTop: 14 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!hasPrev || loading}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </button>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>Page {page}</span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!hasNext || loading}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
