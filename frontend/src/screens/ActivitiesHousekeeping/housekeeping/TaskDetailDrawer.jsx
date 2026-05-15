import { useState, useEffect, useCallback } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { taskStatusBadge, priorityBadge, fmtDT, Loading, Err, Field, inputStyle } from '../shared.jsx';

const NEXT_STATUS = {
  dirty:            { label: 'Mark In Progress',         next: 'in_progress' },
  in_progress:      { label: 'Ready for Inspection',     next: 'ready_inspection' },
  ready_inspection: { label: 'Mark Clean',               next: 'clean' },
  clean:            { label: 'Ready for Guest',          next: 'ready_guest' },
};

export default function TaskDetailDrawer({ taskId, onClose }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [escalateForm, setEscalateForm] = useState({ description: '', severity: 'medium' });
  const [showEscalate, setShowEscalate] = useState(false);

  const load = useCallback(() => {
    if (!taskId) return;
    setLoading(true);
    api.get(`/tasks/${taskId}/`)
      .then(r => setTask(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdvance() {
    if (!task || !NEXT_STATUS[task.status]) return;
    setAdvancing(true);
    try {
      await api.post(`/tasks/${task.id}/advance/`);
      load();
    } catch {
      alert('Failed to advance task status.');
    } finally {
      setAdvancing(false);
    }
  }

  async function toggleChecklist(itemId, isDone) {
    try {
      await api.patch(`/tasks/${task.id}/checklist/${itemId}/`, { is_done: !isDone });
      load();
    } catch {
      alert('Failed to update checklist.');
    }
  }

  async function handleEscalate(e) {
    e.preventDefault();
    setEscalating(true);
    try {
      await api.post(`/tasks/${task.id}/escalate-defect/`, escalateForm);
      setShowEscalate(false);
      setEscalateForm({ description: '', severity: 'medium' });
      alert('Defect escalated to maintenance. The Maintenance Manager has been notified.');
    } catch {
      alert('Failed to escalate defect.');
    } finally {
      setEscalating(false);
    }
  }

  if (loading) return <Loading />;
  if (!task) return <Err msg="Failed to load task details." />;

  const nextStep = NEXT_STATUS[task.status];
  const checklist = task.checklist ?? [];
  const photos = task.photos ?? [];

  return (
    <div>
      {/* Status header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {taskStatusBadge(task.status)}
        {priorityBadge(task.priority)}
        <span className="badge badge-gray" style={{ fontSize: 10 }}>{task.source_type?.replace(/_/g, ' ')}</span>
      </div>

      {/* Unit info */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{task.unit_label}</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>
          {task.unit_type}
          {task.target_ready_by && ` · Ready by ${fmtDT(task.target_ready_by)}`}
        </div>
        {task.assigned_to_name && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>Assigned to: {task.assigned_to_name}</div>}
        {task.supervisor_name && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 2 }}>Supervisor: {task.supervisor_name}</div>}
      </div>

      {/* Advance button */}
      {nextStep && (
        <button
          className="btn btn-primary btn-sm"
          style={{ width: '100%', marginBottom: 20, padding: '10px 0', fontSize: 13 }}
          onClick={handleAdvance}
          disabled={advancing}
        >
          {advancing ? 'Updating…' : nextStep.label}
        </button>
      )}

      {/* Checklist */}
      {checklist.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Checklist ({checklist.filter(c => c.is_done).length}/{checklist.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {checklist.map(item => (
              <label
                key={item.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}
              >
                <input
                  type="checkbox"
                  checked={item.is_done}
                  onChange={() => toggleChecklist(item.id, item.is_done)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, textDecoration: item.is_done ? 'line-through' : 'none', color: item.is_done ? 'rgba(0,0,0,0.35)' : undefined }}>
                  {item.checklist_item_text ?? item.text}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
            Photos ({photos.length})
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {photos.map(p => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img
                  src={p.image}
                  alt={p.caption || p.photo_type}
                  style={{ width: 100, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)' }}
                />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 9, padding: '2px 4px', borderRadius: '0 0 6px 6px', textAlign: 'center' }}>
                  {p.photo_type}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {task.notes && (
        <div style={{ marginBottom: 20, padding: '10px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 4 }}>NOTES</div>
          <div style={{ fontSize: 13 }}>{task.notes}</div>
        </div>
      )}

      {/* Escalate to maintenance */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 16 }}>
        {!showEscalate ? (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: '#c92a2a', borderColor: '#c92a2a' }}
            onClick={() => setShowEscalate(true)}
          >
            Escalate to Maintenance
          </button>
        ) : (
          <form onSubmit={handleEscalate}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#c92a2a', marginBottom: 10 }}>
              Escalate Defect — Maintenance Manager will be notified immediately
            </div>
            <Field label="Description" required>
              <textarea
                required
                style={{ ...inputStyle, height: 64, resize: 'vertical' }}
                value={escalateForm.description}
                onChange={e => setEscalateForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe the defect…"
              />
            </Field>
            <Field label="Severity">
              <select style={inputStyle} value={escalateForm.severity} onChange={e => setEscalateForm(f => ({ ...f, severity: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowEscalate(false)}>Cancel</button>
              <button type="submit" className="btn btn-sm" style={{ background: '#c92a2a', color: '#fff', border: 'none', cursor: 'pointer' }} disabled={escalating}>
                {escalating ? 'Escalating…' : 'Escalate Defect'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
