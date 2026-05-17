import { useState } from 'react';
import useMaintenanceTasks from '../../hooks/useMaintenanceTasks.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Icon from '../../components/Icon.jsx';

const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_COLOR = { urgent: 'var(--db-status-red)', high: 'var(--db-status-red)', medium: 'var(--db-gold-light)', low: 'var(--db-on-dark-faint)' };

const PINNED = { position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 20px 28px', background: 'var(--db-bezel)', borderTop: '1px solid rgba(255,255,255,0.06)' };

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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', zIndex: 100 }}>
      <div style={{ background: 'var(--db-bezel)', borderTop: '1px solid rgba(255,255,255,0.07)', borderRadius: '20px 20px 0 0', padding: '24px 20px 0' }}>
        <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>Complete Task</div>
        <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 20 }}>{selected.title}</div>
        <textarea value={completionNotes} onChange={e => setCompletionNotes(e.target.value)}
          placeholder="Add a completion note…"
          className="f-textarea"
          style={{ marginBottom: 14 }} />
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 52, background: 'var(--db-card-bg)', border: 'var(--db-card-border)', borderRadius: 'var(--db-radius-sm)', fontSize: 15, fontWeight: 600, color: 'var(--db-on-dark)', cursor: 'pointer', marginBottom: 20 }}>
          <Icon name="camera" size={18} color="var(--db-gold-light)" />
          {completionPhoto ? completionPhoto.name : 'Add Photo'}
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => setCompletionPhoto(e.target.files[0] || null)} />
        </label>
        <button className="f-btn-primary" style={{ width: '100%', marginBottom: 12 }} disabled={submitting} onClick={handleSubmitCompletion}>{submitting ? 'Submitting…' : 'Submit'}</button>
        <button style={{ width: '100%', height: 48, background: 'transparent', border: 'none', fontSize: 15, color: 'var(--db-on-dark-muted)', cursor: 'pointer', marginBottom: 16 }} onClick={() => setShowCompletion(false)}>Cancel</button>
      </div>
    </div>
  );

  if (selected) return (
    <div className="f-screen" style={{ paddingBottom: 100 }}>
      <div className="f-topbar">
        <button onClick={() => setSelectedId(null)} className="f-dw-back" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
          Back
        </button>
        <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>Task Detail</div>
        <span style={{ width: 50 }} />
      </div>
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 24, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 6, lineHeight: 1.3 }}>{selected.title}</div>
        {selected.asset_name && <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 12 }}>{selected.asset_name}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span className="f-pill f-pill--gold">{PRIORITY_LABEL[selected.priority] ?? selected.priority}</span>
          <span className="f-pill">{selected.status.replace('_', ' ')}</span>
        </div>
        {selected.description && <div className="f-card" style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--db-on-dark-soft)', lineHeight: 1.65 }}>{selected.description}</div>}
        {selected.due_date && <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 8 }}>Due: <b style={{ color: 'var(--db-on-dark)' }}>{selected.due_date}</b></div>}
        {selected.assigned_to && <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)' }}>Assigned: <b style={{ color: 'var(--db-on-dark)' }}>{selected.assigned_to}</b></div>}
      </div>
      <div style={PINNED}>
        {selected.status === 'pending'     && <button className="f-btn-primary" style={{ width: '100%' }} onClick={handleStart}>Start Task</button>}
        {selected.status === 'in_progress' && <button className="f-btn-primary" style={{ width: '100%' }} onClick={() => setShowCompletion(true)}>Mark Done</button>}
        {selected.status === 'blocked'     && <div style={{ textAlign: 'center', fontSize: 15, color: 'var(--db-on-dark-muted)', fontWeight: 600, padding: '18px 0' }}>Blocked — contact manager</div>}
      </div>
    </div>
  );

  return (
    <div className="f-screen">
      <div className="f-topbar">
        <div>
          <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--db-on-dark)' }}>{mineOnly ? 'My Tasks' : 'All Tasks'}</div>
          <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)', marginTop: 2 }}>{activeTasks.length} active</div>
        </div>
        {myName && (
          <button
            onClick={() => setMineOnly(v => !v)}
            className="f-btn-ghost"
            style={{ padding: '6px 14px', fontSize: 12 }}
          >
            {mineOnly ? 'Show all' : 'Mine only'}
          </button>
        )}
      </div>
      {loading ? (
        <div className="f-dw-loading">Loading…</div>
      ) : (
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
          {activeTasks.map(t => (
            <div key={t.id} onClick={() => setSelectedId(t.id)} className="f-card" style={{ cursor: 'pointer' }}>
              <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 17, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)', marginBottom: 8 }}>{[t.asset_name, t.assigned_to].filter(Boolean).join(' · ')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLOR[t.priority] ?? 'var(--db-on-dark-faint)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: PRIORITY_COLOR[t.priority] ?? 'var(--db-on-dark-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {PRIORITY_LABEL[t.priority] ?? t.priority}
                </span>
              </div>
            </div>
          ))}
          {activeTasks.length === 0 && (
            <div className="f-dw-loading" style={{ padding: 60 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <Icon name="check-circle" size={36} color="var(--db-on-dark-faint)" />
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
