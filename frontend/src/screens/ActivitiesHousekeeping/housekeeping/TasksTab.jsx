import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { taskStatusBadge, priorityBadge, fmtDT, today, Loading, Empty, Err, SecHdr, Field, inputStyle } from '../shared.jsx';

export default function TasksTab({ onSelectTask }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(today());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    unit_type: 'vessel', unit_label: '', source_type: 'manual',
    priority: 'normal', notes: '', target_ready_by: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (statusFilter) params.status = statusFilter;
    if (unitFilter) params.unit_type = unitFilter;
    if (dateFilter) params.date = dateFilter;
    api.get('/tasks/', { params })
      .then(r => setTasks(r.data.results ?? r.data))
      .catch(() => setError('Failed to load tasks.'))
      .finally(() => setLoading(false));
  }, [statusFilter, unitFilter, dateFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/tasks/', { ...form, target_ready_by: form.target_ready_by || null });
      setShowForm(false);
      setForm({ unit_type: 'vessel', unit_label: '', source_type: 'manual', priority: 'normal', notes: '', target_ready_by: '' });
      load();
    } catch {
      alert('Failed to create task.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SecHdr title="Housekeeping Tasks">
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : <><Ic n="plus" s={11} />New Task</>}
        </button>
      </SecHdr>

      {/* Filters */}
      <div className="filter-row">
        <select className="form-control form-control-sm" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="dirty">Dirty</option>
          <option value="in_progress">In Progress</option>
          <option value="ready_inspection">Ready for Inspection</option>
          <option value="clean">Clean</option>
          <option value="ready_guest">Ready for Guest</option>
        </select>
        <select className="form-control form-control-sm" style={{ width: 150 }} value={unitFilter} onChange={e => setUnitFilter(e.target.value)}>
          <option value="">All unit types</option>
          <option value="vessel">Vessel</option>
          <option value="accommodation">Accommodation</option>
          <option value="facility">Facility</option>
        </select>
        <input type="date" className="form-control form-control-sm" style={{ width: 160 }} value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
      </div>

      {/* New task form */}
      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>New Manual Task</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Unit type">
              <select style={inputStyle} value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))}>
                <option value="vessel">Vessel</option>
                <option value="accommodation">Accommodation</option>
                <option value="facility">Facility</option>
              </select>
            </Field>
            <Field label="Unit name" required>
              <input required style={inputStyle} value={form.unit_label} onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} placeholder="e.g. Sea Sprite" />
            </Field>
            <Field label="Priority">
              <select style={inputStyle} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Target ready by">
              <input type="datetime-local" style={inputStyle} value={form.target_ready_by} onChange={e => setForm(f => ({ ...f, target_ready_by: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Notes">
                <textarea style={{ ...inputStyle, height: 60, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes…" />
              </Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Create Task'}</button>
          </div>
        </form>
      )}

      {loading ? <Loading /> : error ? <Err msg={error} /> : tasks.length === 0 ? (
        <Empty title="No tasks found" subtitle="All clear — or adjust filters to see more." />
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assigned To</th>
                <th>Target Ready By</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => {
                const done = t.checklist_done ?? 0;
                const total = t.checklist_total ?? 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : null;
                // Delay alert: target within 2h and not ready_guest
                const isDelayed = t.target_ready_by && t.status !== 'ready_guest' &&
                  (new Date(t.target_ready_by) - Date.now()) < 2 * 60 * 60 * 1000 &&
                  new Date(t.target_ready_by) > Date.now();
                return (
                  <tr
                    key={t.id}
                    style={{ cursor: 'pointer', outline: isDelayed ? '2px solid #e67700' : undefined }}
                    onClick={() => onSelectTask(t)}
                  >
                    <td style={{ fontWeight: 600 }}>
                      {t.unit_label}
                      {isDelayed && <span style={{ marginLeft: 6, fontSize: 10, color: '#e67700', fontWeight: 700 }}><Ic n="alert-circle" s={10} /> Due soon</span>}
                    </td>
                    <td>
                      <span className="badge badge-gray" style={{ fontSize: 10 }}>{t.unit_type}</span>
                    </td>
                    <td>{taskStatusBadge(t.status)}</td>
                    <td>{priorityBadge(t.priority)}</td>
                    <td style={{ fontSize: 12 }}>{t.assigned_to_name ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{fmtDT(t.target_ready_by)}</td>
                    <td style={{ fontSize: 12 }}>
                      {pct !== null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.08)', borderRadius: 3, minWidth: 60 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: '#37b24d', borderRadius: 3, transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>{done}/{total}</span>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
