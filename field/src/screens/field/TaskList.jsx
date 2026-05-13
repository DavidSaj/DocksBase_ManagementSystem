import { useState } from 'react';
import useMaintenanceTasks from '../../hooks/useMaintenanceTasks.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Icon from '../../components/Icon.jsx';

const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_COLOR = { urgent: '#c0392b', high: '#c0392b', medium: '#e67e22', low: 'rgba(0,0,0,0.35)' };

const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: 'Jost, system-ui, sans-serif' };
const PINNED = { position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 20px 28px', background: '#fff', borderTop: '1px solid rgba(0,0,0,0.1)' };

export default function TaskList() {
  const { user } = useAuth();
  const [mineOnly, setMineOnly] = useState(true);

  const myName = [user?.first_name, user?.last_name].filter(Boolean).join(' ');
  const assignedTo = mineOnly && myName ? myName : undefined;

  const { tasks, loading, updateTask, completeTask } = useMaintenanceTasks({ assignedTo });
  const [selectedId, setSelectedId]           = useState(null);
  const [showCompletion, setShowCompletion]   = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [completionPhoto, setCompletionPhoto] = useState(null);
  const [submitting, setSubmitting]           = useState(false);

  const activeTasks = tasks
    .filter(t => t.status !== 'completed')
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));

  const selected = tasks.find(t => t.id === selectedId);

  async function handleStart() { await updateTask(selected.id, { status: 'in_progress' }); }

  async function handleSubmitCompletion() {
    setSubmitting(true);
    try {
      await completeTask(selected.id, completionNotes, completionPhoto);
      setShowCompletion(false); setSelectedId(null);
      setCompletionNotes(''); setCompletionPhoto(null);
    } finally { setSubmitting(false); }
  }

  if (showCompletion && selected) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px 0' }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Complete Task</div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>{selected.title}</div>
        <textarea value={completionNotes} onChange={e => setCompletionNotes(e.target.value)}
          placeholder="Add a completion note…"
          style={{ width: '100%', minHeight: 100, padding: 14, fontSize: 15, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', resize: 'none', boxSizing: 'border-box', marginBottom: 14 }} />
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 52, background: '#f4f3f0', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 20 }}>
          <Icon name="camera" size={18} color="#0c1f3d" />
          {completionPhoto ? completionPhoto.name : 'Add Photo'}
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => setCompletionPhoto(e.target.files[0] || null)} />
        </label>
        <button style={{ ...ACTION_BTN, marginBottom: 12 }} disabled={submitting} onClick={handleSubmitCompletion}>{submitting ? 'Submitting…' : 'Submit'}</button>
        <button style={{ width: '100%', height: 48, background: 'transparent', border: 'none', fontSize: 15, color: 'rgba(0,0,0,0.5)', cursor: 'pointer', marginBottom: 16 }} onClick={() => setShowCompletion(false)}>Cancel</button>
      </div>
    </div>
  );

  if (selected) return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0', paddingBottom: 100 }}>
      <div style={{ background: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <button onClick={() => setSelectedId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow-left" size={22} color="#0c1f3d" />
        </button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Task Detail</div>
      </div>
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{selected.title}</div>
        {selected.asset_name && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 12 }}>{selected.asset_name}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ padding: '4px 12px', borderRadius: 20, background: '#0c1f3d', color: '#fff', fontSize: 12, fontWeight: 700 }}>{PRIORITY_LABEL[selected.priority] ?? selected.priority}</span>
          <span style={{ padding: '4px 12px', borderRadius: 20, background: '#e8ecf0', color: 'rgba(0,0,0,0.6)', fontSize: 12 }}>{selected.status.replace('_', ' ')}</span>
        </div>
        {selected.description && <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.65)', lineHeight: 1.65, background: '#fff', borderRadius: 12, padding: 16, marginBottom: 14 }}>{selected.description}</div>}
        {selected.due_date && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 8 }}>Due: <b>{selected.due_date}</b></div>}
        {selected.assigned_to && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Assigned: <b>{selected.assigned_to}</b></div>}
      </div>
      <div style={PINNED}>
        {selected.status === 'pending'     && <button style={ACTION_BTN} onClick={handleStart}>Start Task</button>}
        {selected.status === 'in_progress' && <button style={ACTION_BTN} onClick={() => setShowCompletion(true)}>Mark Done</button>}
        {selected.status === 'blocked'     && <div style={{ textAlign: 'center', fontSize: 15, color: 'rgba(0,0,0,0.4)', fontWeight: 600, padding: '18px 0' }}>Blocked — contact manager</div>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={{ background: '#0c1f3d', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{mineOnly ? 'My Tasks' : 'All Tasks'}</div>
            <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>{activeTasks.length} active</div>
          </div>
          {myName && (
            <button
              onClick={() => setMineOnly(v => !v)}
              style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 20, color: '#fff', fontSize: 12, fontWeight: 600, padding: '5px 14px', cursor: 'pointer' }}
            >
              {mineOnly ? 'Show all' : 'Mine only'}
            </button>
          )}
        </div>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeTasks.map(t => (
            <div key={t.id} onClick={() => setSelectedId(t.id)}
              style={{ background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>{[t.asset_name, t.assigned_to].filter(Boolean).join(' · ')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLOR[t.priority] ?? 'rgba(0,0,0,0.3)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: PRIORITY_COLOR[t.priority] ?? 'rgba(0,0,0,0.4)' }}>
                  {PRIORITY_LABEL[t.priority] ?? t.priority}
                </span>
              </div>
            </div>
          ))}
          {activeTasks.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'rgba(0,0,0,0.35)' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <Icon name="check-circle" size={36} color="rgba(0,0,0,0.2)" />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{mineOnly ? 'All done!' : 'No tasks.'}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{mineOnly ? 'No tasks assigned to you.' : 'No active tasks for this marina.'}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
