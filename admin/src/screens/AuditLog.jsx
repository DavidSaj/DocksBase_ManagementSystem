import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

const ACTION_LABELS = {
  suspend:               'Suspended account',
  reinstate:             'Reinstated account',
  convert_trial:         'Converted trial → paid',
  impersonate:           'Impersonated marina',
  impersonate_override:  'Impersonated (break-glass)',
  toggle_global_flag:    'Toggled feature flag',
  update_marina:         'Updated marina',
  grant_support_access:  'Granted support access',
  revoke_support_access: 'Revoked support access',
};

function ActionBadge({ action }) {
  const isDanger = action === 'suspend' || action === 'impersonate_override';
  const isWarn   = action === 'impersonate';
  const cls = isDanger ? 'badge-red' : isWarn ? 'badge-orange' : 'badge-gray';
  return <span className={`badge ${cls}`}>{ACTION_LABELS[action] || action}</span>;
}

export default function AuditLog() {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [marinaFilter, setMarinaFilter] = useState('');
  const [expandedId, setExpandedId]     = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (marinaFilter) params.marina = marinaFilter;
    api.get('admin/audit-logs/', { params })
      .then(r => setLogs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [marinaFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Audit Log</div>
        <div className="sec-hdr-sub">Last 200 platform admin actions, newest first.</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div className="search">
          <Ic n="filter" s={13} />
          <input
            placeholder="Filter by marina ID…"
            value={marinaFilter}
            onChange={e => setMarinaFilter(e.target.value)}
            style={{ width: 180 }}
          />
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
          <Ic n="refresh-cw" s={12} /> Refresh
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>No audit log entries.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Marina</th>
                <th style={{ textAlign: 'right' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <>
                  <tr
                    key={log.id}
                    style={{ cursor: Object.keys(log.detail || {}).length > 0 ? 'pointer' : 'default' }}
                    onClick={() => Object.keys(log.detail || {}).length > 0 && setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td style={{ fontSize: 12 }}>{log.admin_user_email || '—'}</td>
                    <td><ActionBadge action={log.action} /></td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{log.target_marina_name || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {Object.keys(log.detail || {}).length > 0 && (
                        <Ic n={expandedId === log.id ? 'chevron-up' : 'chevron-down'} s={12} c="rgba(0,0,0,0.35)" />
                      )}
                    </td>
                  </tr>
                  {expandedId === log.id && (
                    <tr key={`${log.id}-detail`}>
                      <td colSpan={5} style={{ background: '#f8f8f8', padding: '8px 12px' }}>
                        <pre style={{ margin: 0, fontSize: 11, color: 'rgba(0,0,0,0.6)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {JSON.stringify(log.detail, null, 2)}
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
    </div>
  );
}
