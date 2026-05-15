import { useState, useEffect } from 'react';
import api from '../../../api.js';
import { taskStatusBadge, fmtDT, Loading, Empty, Err, SecHdr } from '../shared.jsx';

export default function LogTab() {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/tasks/', { params: { status: 'ready_guest' } })
      .then(r => setLog(r.data.results ?? r.data))
      .catch(() => setError('Failed to load log.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  if (log.length === 0) return <Empty title="No log entries" subtitle="Completed housekeeping tasks will appear here." />;

  return (
    <div>
      <SecHdr title="Housekeeping Log" />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Status</th>
              <th>Source</th>
              <th>Assigned To</th>
              <th>Completed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {log.map(entry => (
              <tr key={entry.id}>
                <td style={{ fontWeight: 600 }}>{entry.unit_label}</td>
                <td>{taskStatusBadge(entry.status)}</td>
                <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{entry.source_type?.replace('_', ' ')}</td>
                <td style={{ fontSize: 12 }}>{entry.assigned_to_name ?? '—'}</td>
                <td style={{ fontSize: 12 }}>{fmtDT(entry.completed_at)}</td>
                <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
