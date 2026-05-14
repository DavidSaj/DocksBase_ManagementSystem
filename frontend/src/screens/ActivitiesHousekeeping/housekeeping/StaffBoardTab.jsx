import { useCallback, useEffect, useState } from 'react';
import api from '../../../api.js';
import { SecHdr, Empty, Loading, Err, taskStatusBadge, priorityBadge } from '../shared.jsx';

const STATUSES = [
  ['dirty',            'Dirty'],
  ['in_progress',      'In Progress'],
  ['ready_inspection', 'Ready for Inspection'],
  ['clean',            'Clean'],
  ['ready_guest',      'Ready for Guest'],
];

export default function StaffBoardTab() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/tasks/')
      .then(r => setTasks(r.data.results ?? r.data))
      .catch(() => setError('Failed to load tasks.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(task, newStatus) {
    const prev = task.status;
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    try {
      await api.patch(`/tasks/${task.id}/`, { status: newStatus });
    } catch {
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: prev } : t));
      alert('Failed to update status.');
    }
  }

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;

  // Group by assigned_to_name (or "Unassigned")
  const groups = new Map();
  for (const t of tasks) {
    const key = t.assigned_to_name ?? (t.assigned_to ? `Staff #${t.assigned_to}` : 'Unassigned');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  if (groups.size === 0) {
    return (
      <div>
        <SecHdr title="Staff Board" />
        <Empty title="No tasks" subtitle="Tasks will appear here grouped by assignee." />
      </div>
    );
  }

  return (
    <div>
      <SecHdr title="Staff Board" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {[...groups.entries()].map(([assignee, list]) => (
          <div key={assignee} className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {assignee}{' '}
              <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>· {list.length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {STATUSES.map(([key, label]) => {
                const items = list.filter(t => t.status === key);
                return (
                  <div key={key} style={{ background: 'rgba(0,0,0,0.02)', borderRadius: 6, padding: 8, minHeight: 80 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {label}
                    </div>
                    {items.map(t => (
                      <div key={t.id} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 4, padding: 6, marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{t.unit_label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          {t.priority && priorityBadge(t.priority)}
                        </div>
                        <select
                          value={t.status}
                          onChange={e => changeStatus(t, e.target.value)}
                          style={{ width: '100%', marginTop: 6, fontSize: 11, padding: '2px 4px', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 4 }}
                        >
                          {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </div>
                    ))}
                    {items.length === 0 && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.25)' }}>—</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
