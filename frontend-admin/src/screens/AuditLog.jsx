import { useEffect, useState } from 'react';
import api from '../api.js';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [marinaId, setMarinaId] = useState('');
  const [marinas, setMarinas] = useState([]);

  useEffect(() => {
    api.get('/admin/marinas/').then(r => setMarinas(r.data));
  }, []);

  useEffect(() => {
    const params = marinaId ? { marina: marinaId } : {};
    api.get('/admin/audit-logs/', { params }).then(r => setLogs(r.data));
  }, [marinaId]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Audit Log</h2>
        <select value={marinaId} onChange={e => setMarinaId(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}>
          <option value="">All marinas</option>
          {marinas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
              {['Time', 'Admin', 'Action', 'Marina', 'Detail'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: '#666', fontSize: 12, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log, i) => {
              const isOverride = log.action === 'impersonate_override';
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', background: isOverride ? '#fffbeb' : 'transparent' }}>
                  <td style={{ padding: '10px 14px', color: '#999', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px' }}>{log.admin_user_email || log.admin_user || '—'}</td>
                  <td style={{ padding: '10px 14px', fontWeight: isOverride ? 700 : 400, color: isOverride ? '#d97706' : 'inherit' }}>{log.action}</td>
                  <td style={{ padding: '10px 14px' }}>{log.target_marina_name || log.target_marina || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#999', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {typeof log.detail === 'object' ? JSON.stringify(log.detail) : log.detail}
                  </td>
                </tr>
              );
            })}
            {!logs.length && <tr><td colSpan={5} style={{ padding: 24, color: '#999', textAlign: 'center' }}>No audit log entries</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
