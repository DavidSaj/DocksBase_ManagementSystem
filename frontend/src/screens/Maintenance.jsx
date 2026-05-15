import { useState } from 'react';
import Ic from '../components/ui/Icon.jsx';
import ScreenInfo from '../components/ui/ScreenInfo.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';
import useTasks from '../hooks/useTasks.js';
import useIncidents from '../hooks/useIncidents.js';
import useAssets from '../hooks/useAssets.js';
import useDefects from '../hooks/useDefects.js';
import useMaintenanceTasks from '../hooks/useMaintenanceTasks.js';
import useVessels from '../hooks/useVessels.js';

const SEV_BADGE    = { low: 'badge-gray', medium: 'badge-orange', high: 'badge-red', critical: 'badge-red' };
const STATUS_BADGE = { open: 'badge-gold', acknowledged: 'badge-blue', in_progress: 'badge-teal', resolved: 'badge-green' };
const MT_PRI_BADGE = { low: 'badge-gray', medium: 'badge-orange', high: 'badge-red', urgent: 'badge-red' };
const ASSET_STATUS_BADGE = {
  ok:            ['badge-green',  'OK'],
  due_service:   ['badge-orange', 'Due Service'],
  under_repair:  ['badge-red',    'Under Repair'],
  decommissioned:['badge-gray',   'Decommissioned'],
};

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Maintenance() {
  const [tab, setTab] = useState('tasks');

  const { tasks,                   loading: loadingTasks, createTask,  updateTask             } = useTasks();
  const { incidents,               loading: loadingInc,   createIncident, updateIncident      } = useIncidents();
  const { assets,                  loading: loadingAssets, createAsset                        } = useAssets();
  const { defects,                 loading: loadingDef,   createDefect, updateDefect, raiseTask } = useDefects();
  const { tasks: mTasks, fetchTasks: refetchMT, loading: loadingMT, createTask: createMT, updateTask: updateMT } = useMaintenanceTasks();
  const { vessels } = useVessels();

  // Staff Tasks modal
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskForm, setTaskForm] = useState({ text: '', location: '', priority: 'medium', assigned_to: '' });

  // Maintenance Tasks modal
  const [showAddMT, setShowAddMT] = useState(false);
  const [mtForm, setMtForm] = useState({ title: '', asset: '', description: '', priority: 'medium', assigned_to: '', due_date: '' });

  // Incidents modal + inline note
  const [showAddInc, setShowAddInc] = useState(false);
  const [incForm, setIncForm] = useState({ vessel: '', occurred_at: '', severity: 'low', description: '', reporter: '' });
  const [noteTargetId, setNoteTargetId] = useState(null);
  const [noteText, setNoteText] = useState('');

  // Asset modal
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [assetForm, setAssetForm] = useState({ name: '', category: '', location: '', make: '', model: '', serial: '', purchased: '', cost: '' });

  // Defect modal
  const [showAddDefect, setShowAddDefect] = useState(false);
  const [defectForm, setDefectForm] = useState({ asset: '', location: '', severity: 'low', description: '', reporter: '' });
  const [raisingTaskId, setRaisingTaskId] = useState(null);

  const TABS = [
    ['tasks',     'Staff Tasks'],
    ['kanban',    'Maintenance Tasks'],
    ['incidents', 'Incidents'],
    ['assets',    'Asset Register'],
    ['defects',   'Defect Log'],
  ];

  const pColors = { high: 'var(--red)', medium: 'var(--orange)', low: 'rgba(0,0,0,0.25)' };

  const KANBAN_COLS = [
    { key: 'pending',     label: 'Pending' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'blocked',     label: 'Blocked' },
    { key: 'completed',   label: 'Completed' },
  ];

  function kanbanActions(t) {
    if (t.status === 'pending')     return [{ label: 'Start',    next: 'in_progress' }];
    if (t.status === 'in_progress') return [{ label: 'Block',    next: 'blocked'     }, { label: 'Complete', next: 'completed' }];
    if (t.status === 'blocked')     return [{ label: 'Resume',   next: 'in_progress' }];
    return [];
  }

  async function submitTask() {
    if (!taskForm.text.trim()) return;
    await createTask(taskForm);
    setTaskForm({ text: '', location: '', priority: 'medium', assigned_to: '' });
    setShowAddTask(false);
  }

  async function submitMT() {
    if (!mtForm.title.trim()) return;
    await createMT({ ...mtForm, asset: mtForm.asset || null, due_date: mtForm.due_date || null });
    setMtForm({ title: '', asset: '', description: '', priority: 'medium', assigned_to: '', due_date: '' });
    setShowAddMT(false);
  }

  async function submitIncident() {
    if (!incForm.description.trim() || !incForm.occurred_at) return;
    await createIncident({ ...incForm, vessel: incForm.vessel || null });
    setIncForm({ vessel: '', occurred_at: '', severity: 'low', description: '', reporter: '' });
    setShowAddInc(false);
  }

  async function saveNote(id) {
    await updateIncident(id, { notes: noteText });
    setNoteTargetId(null);
    setNoteText('');
  }

  async function submitAsset() {
    if (!assetForm.name.trim()) return;
    await createAsset({ ...assetForm, cost: assetForm.cost || null, purchased: assetForm.purchased || null });
    setAssetForm({ name: '', category: '', location: '', make: '', model: '', serial: '', purchased: '', cost: '' });
    setShowAddAsset(false);
  }

  async function submitDefect() {
    if (!defectForm.description.trim()) return;
    await createDefect({ ...defectForm, asset: defectForm.asset || null });
    setDefectForm({ asset: '', location: '', severity: 'low', description: '', reporter: '' });
    setShowAddDefect(false);
  }

  async function handleRaiseTask(id) {
    setRaisingTaskId(id);
    try {
      await raiseTask(id);
      await refetchMT();
    } finally {
      setRaisingTaskId(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>Maintenance</span>
        <ScreenInfo title="Maintenance" body={SCREEN_INFO.maintenance} />
      </div>
      <div className="tabs">
        {TABS.map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {/* ===== STAFF TASKS ===== */}
      {tab === 'tasks' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <div className="sec-hdr">
              <div className="sec-hdr-title">Today's Tasks</div>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddTask(true)}><Ic n="plus" s={11} />Add Task</button>
            </div>
            {loadingTasks ? <div className="loading">Loading…</div> : (
              <div className="card" style={{ padding: '4px 0' }}>
                {tasks.map(t => (
                  <div key={t.id} className="task-item" style={{ padding: '10px 18px' }}>
                    <div className={`task-check${t.done ? ' done' : ''}`} onClick={() => updateTask(t.id, { done: !t.done })}>
                      {t.done && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="2,6 5,9 10,3"/></svg>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className={`task-text${t.done ? ' done' : ''}`}>{t.text}</div>
                      <div className="task-meta">{t.location}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: pColors[t.priority] }} />
                      <div className="task-assign">{t.assigned_to}</div>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && <div style={{ padding: '16px 18px', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No tasks yet.</div>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Task Summary</div>
              {[
                ['Total tasks',   tasks.length,                                               'rgba(0,0,0,0.7)'],
                ['Completed',     tasks.filter(t => t.done).length,                           'var(--green)'],
                ['Open',          tasks.filter(t => !t.done).length,                          'var(--orange)'],
                ['High priority', tasks.filter(t => t.priority === 'high' && !t.done).length, 'var(--red)'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'rgba(0,0,0,0.5)' }}>{l}</span>
                  <span style={{ fontWeight: 700, color: c }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>By Assignment</div>
              {Array.from(new Set(tasks.filter(t => !t.done && t.assigned_to).map(t => t.assigned_to))).map(name => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: 'var(--border)' }}>
                  <span style={{ color: 'rgba(0,0,0,0.6)' }}>{name}</span>
                  <span style={{ fontWeight: 700 }}>{tasks.filter(t => t.assigned_to === name && !t.done).length} open</span>
                </div>
              ))}
              {tasks.filter(t => !t.done && t.assigned_to).length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No open assigned tasks.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== MAINTENANCE TASKS (KANBAN) ===== */}
      {tab === 'kanban' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Maintenance Tasks</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddMT(true)}><Ic n="plus" s={11} />New Task</button>
          </div>
          {loadingMT ? <div className="loading">Loading…</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'start' }}>
              {KANBAN_COLS.map(col => (
                <div key={col.key}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    {col.label} <span style={{ fontWeight: 400 }}>({mTasks.filter(t => t.status === col.key).length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {mTasks.filter(t => t.status === col.key).map(t => (
                      <div key={t.id} className="card" style={{ padding: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{t.title}</div>
                        {t.asset_name && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{t.asset_name}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                          <span className={`badge ${MT_PRI_BADGE[t.priority] ?? 'badge-gray'}`}>{t.priority}</span>
                          {t.assigned_to && <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>→ {t.assigned_to}</span>}
                        </div>
                        {t.due_date && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 8 }}>Due {t.due_date}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {kanbanActions(t).map(action => (
                            <button key={action.next} className="btn btn-primary btn-sm" onClick={() => updateMT(t.id, { status: action.next })}>
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {mTasks.filter(t => t.status === col.key).length === 0 && (
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)', padding: '12px 0' }}>Empty</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== INCIDENTS ===== */}
      {tab === 'incidents' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Incident Reports</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddInc(true)}><Ic n="plus" s={11} />Log Incident</button>
          </div>
          {loadingInc ? <div className="loading">Loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {incidents.map(inc => (
                <div key={inc.id} className="card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>INC-{inc.id}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>
                        {inc.occurred_at ? new Date(inc.occurred_at).toLocaleDateString() : ''} · Reported by {inc.reporter}
                      </div>
                    </div>
                    <span className={`badge ${SEV_BADGE[inc.severity] ?? 'badge-gray'}`}>{inc.severity}</span>
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 10 }}>
                    {inc.vessel_name && <><b>Vessel:</b> {inc.vessel_name} &nbsp;·&nbsp;</>}
                    {inc.berth_name && <><b>Berth:</b> {inc.berth_name}</>}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
                    {inc.description}
                  </div>
                  {inc.notes && (
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', background: '#fffbf0', borderRadius: 6, padding: '8px 12px', marginBottom: 10, borderLeft: '3px solid var(--orange)' }}>
                      <b>Note:</b> {inc.notes}
                    </div>
                  )}
                  {noteTargetId === inc.id ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <textarea
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        placeholder="Add a note…"
                        style={{ flex: 1, padding: 8, fontSize: 12, borderRadius: 6, border: 'var(--border)', resize: 'vertical', minHeight: 60 }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => saveNote(inc.id)}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setNoteTargetId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setNoteTargetId(inc.id); setNoteText(inc.notes || ''); }}>
                      {inc.notes ? 'Edit Note' : 'Add Note'}
                    </button>
                      {!inc.resolved
                        ? <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => updateIncident(inc.id, { resolved: true })}>Mark Resolved</button>
                        : <span className="badge badge-green" style={{ marginLeft: 'auto' }}>Resolved</span>
                      }
                    </div>
                  )}
                </div>
              ))}
              {incidents.length === 0 && <div className="empty"><div className="empty-title">No incidents recorded.</div></div>}
            </div>
          )}
        </div>
      )}

      {/* ===== ASSET REGISTER ===== */}
      {tab === 'assets' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Asset Register</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-orange">{assets.filter(a => a.status === 'due_service').length} Due Service</span>
              <span className="badge badge-red">{assets.filter(a => a.status === 'under_repair').length} Under Repair</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddAsset(true)}><Ic n="plus" s={11} />Add Asset</button>
            </div>
          </div>
          {loadingAssets ? <div className="loading">Loading…</div> : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead>
                  <tr><th>Asset</th><th>Category</th><th>Location</th><th>Make / Model</th><th>Status</th><th>Last Service</th><th>Next Due</th><th>Maint. Cost</th></tr>
                </thead>
                <tbody>
                  {assets.map(a => {
                    const [stBadge, stLabel] = ASSET_STATUS_BADGE[a.status] ?? ['badge-gray', a.status];
                    return (
                      <tr key={a.id}>
                        <td><div className="tbl-name">{a.name}</div><div className="tbl-sub">{a.serial}</div></td>
                        <td><span className="badge badge-navy">{a.category}</span></td>
                        <td style={{ fontSize: 12 }}>{a.location}</td>
                        <td style={{ fontSize: 12 }}>{a.make} {a.model}</td>
                        <td><span className={`badge ${stBadge}`}>{stLabel}</span></td>
                        <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{a.last_service}</td>
                        <td style={{ fontSize: 12, fontWeight: 600, color: a.status === 'due_service' ? 'var(--orange)' : 'rgba(0,0,0,0.6)' }}>{a.next_service}</td>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>${a.total_maint_cost}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {assets.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No assets registered.</div>}
            </div>
          )}
        </div>
      )}

      {/* ===== DEFECT LOG ===== */}
      {tab === 'defects' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Defect Log</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-red">{defects.filter(d => d.severity === 'high').length} High</span>
              <span className="badge badge-orange">{defects.filter(d => d.severity === 'medium').length} Medium</span>
              <span className="badge badge-teal">{defects.filter(d => d.status === 'in_progress').length} In Progress</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddDefect(true)}><Ic n="plus" s={11} />Log Defect</button>
            </div>
          </div>
          {loadingDef ? <div className="loading">Loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {defects.map(d => (
                <div key={d.id} className="defect-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)' }}>DEF-{d.id}</span>
                        <span className={`badge ${SEV_BADGE[d.severity] ?? 'badge-gray'}`}>{d.severity}</span>
                        <span className={`badge ${STATUS_BADGE[d.status] ?? 'badge-gray'}`}>{d.status.replace('_', ' ')}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{d.asset_name || 'No asset'}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                        {d.location}{d.location && ' · '}{d.reported_at ? new Date(d.reported_at).toLocaleDateString() : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', textAlign: 'right', marginLeft: 16, flexShrink: 0 }}>
                      {d.assigned_to
                        ? <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.7)' }}>→ {d.assigned_to}</span>
                        : <span>Unassigned</span>
                      }
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', lineHeight: 1.65, background: 'var(--bg)', borderRadius: 6, padding: '9px 12px', marginBottom: 12 }}>{d.description}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>Reported by <b style={{ color: 'rgba(0,0,0,0.7)' }}>{d.reporter}</b></div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {d.status === 'open'         && <button className="btn btn-primary btn-sm" onClick={() => updateDefect(d.id, { status: 'acknowledged' })}>Acknowledge</button>}
                    {d.status === 'acknowledged' && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleRaiseTask(d.id)}
                        disabled={raisingTaskId === d.id}
                      >
                        {raisingTaskId === d.id ? 'Raising…' : 'Raise Maintenance Task'}
                      </button>
                    )}
                    {d.status === 'in_progress'  && <button className="btn btn-primary btn-sm" onClick={() => updateDefect(d.id, { status: 'resolved' })}>Mark Resolved</button>}
                  </div>
                </div>
              ))}
              {defects.length === 0 && <div className="empty"><div className="empty-title">No defects logged.</div></div>}
            </div>
          )}
        </div>
      )}

      {/* ===== MODALS ===== */}

      {showAddTask && (
        <Modal title="Add Task" onClose={() => setShowAddTask(false)}>
          <div className="modal-body">
            <label className="field-label">Task description *</label>
            <input className="input" value={taskForm.text} onChange={e => setTaskForm(f => ({ ...f, text: e.target.value }))} placeholder="e.g. Inspect dock lines" />
            <label className="field-label">Location</label>
            <input className="input" value={taskForm.location} onChange={e => setTaskForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Pontoon B" />
            <label className="field-label">Priority</label>
            <select className="input" value={taskForm.priority} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Assigned to</label>
            <input className="input" value={taskForm.assigned_to} onChange={e => setTaskForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="e.g. Dock Team A" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddTask(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitTask}>Add Task</button>
          </div>
        </Modal>
      )}

      {showAddMT && (
        <Modal title="New Maintenance Task" onClose={() => setShowAddMT(false)}>
          <div className="modal-body">
            <label className="field-label">Title *</label>
            <input className="input" value={mtForm.title} onChange={e => setMtForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Repaint fuel pontoon" />
            <label className="field-label">Asset</label>
            <select className="input" value={mtForm.asset} onChange={e => setMtForm(f => ({ ...f, asset: e.target.value }))}>
              <option value="">— None —</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="field-label">Description</label>
            <textarea className="input" value={mtForm.description} onChange={e => setMtForm(f => ({ ...f, description: e.target.value }))} placeholder="Details…" style={{ minHeight: 80 }} />
            <label className="field-label">Priority</label>
            <select className="input" value={mtForm.priority} onChange={e => setMtForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Assigned to</label>
            <input className="input" value={mtForm.assigned_to} onChange={e => setMtForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="e.g. Yard Team 1" />
            <label className="field-label">Due date</label>
            <input type="date" className="input" value={mtForm.due_date} onChange={e => setMtForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddMT(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitMT}>Create Task</button>
          </div>
        </Modal>
      )}

      {showAddInc && (
        <Modal title="Log Incident" onClose={() => setShowAddInc(false)}>
          <div className="modal-body">
            <label className="field-label">Vessel</label>
            <select className="input" value={incForm.vessel} onChange={e => setIncForm(f => ({ ...f, vessel: e.target.value }))}>
              <option value="">— None —</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <label className="field-label">Date & Time *</label>
            <input type="datetime-local" className="input" value={incForm.occurred_at} onChange={e => setIncForm(f => ({ ...f, occurred_at: e.target.value }))} />
            <label className="field-label">Severity</label>
            <select className="input" value={incForm.severity} onChange={e => setIncForm(f => ({ ...f, severity: e.target.value }))}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Description *</label>
            <textarea className="input" value={incForm.description} onChange={e => setIncForm(f => ({ ...f, description: e.target.value }))} placeholder="What happened?" style={{ minHeight: 80 }} />
            <label className="field-label">Reporter</label>
            <input className="input" value={incForm.reporter} onChange={e => setIncForm(f => ({ ...f, reporter: e.target.value }))} placeholder="Name" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddInc(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitIncident}>Log Incident</button>
          </div>
        </Modal>
      )}

      {showAddAsset && (
        <Modal title="Add Asset" onClose={() => setShowAddAsset(false)}>
          <div className="modal-body">
            <label className="field-label">Name *</label>
            <input className="input" value={assetForm.name} onChange={e => setAssetForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Travelift 50T" />
            <label className="field-label">Category</label>
            <input className="input" value={assetForm.category} onChange={e => setAssetForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Crane" />
            <label className="field-label">Location</label>
            <input className="input" value={assetForm.location} onChange={e => setAssetForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Bay A" />
            <label className="field-label">Make</label>
            <input className="input" value={assetForm.make} onChange={e => setAssetForm(f => ({ ...f, make: e.target.value }))} />
            <label className="field-label">Model</label>
            <input className="input" value={assetForm.model} onChange={e => setAssetForm(f => ({ ...f, model: e.target.value }))} />
            <label className="field-label">Serial</label>
            <input className="input" value={assetForm.serial} onChange={e => setAssetForm(f => ({ ...f, serial: e.target.value }))} />
            <label className="field-label">Purchase date</label>
            <input type="date" className="input" value={assetForm.purchased} onChange={e => setAssetForm(f => ({ ...f, purchased: e.target.value }))} />
            <label className="field-label">Cost</label>
            <input type="number" className="input" value={assetForm.cost} onChange={e => setAssetForm(f => ({ ...f, cost: e.target.value }))} placeholder="0.00" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddAsset(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitAsset}>Add Asset</button>
          </div>
        </Modal>
      )}

      {showAddDefect && (
        <Modal title="Log Defect" onClose={() => setShowAddDefect(false)}>
          <div className="modal-body">
            <label className="field-label">Asset</label>
            <select className="input" value={defectForm.asset} onChange={e => setDefectForm(f => ({ ...f, asset: e.target.value }))}>
              <option value="">— None —</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="field-label">Location</label>
            <input className="input" value={defectForm.location} onChange={e => setDefectForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Pontoon A, Berth 7" />
            <label className="field-label">Severity</label>
            <select className="input" value={defectForm.severity} onChange={e => setDefectForm(f => ({ ...f, severity: e.target.value }))}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Description *</label>
            <textarea className="input" value={defectForm.description} onChange={e => setDefectForm(f => ({ ...f, description: e.target.value }))} placeholder="What is defective?" style={{ minHeight: 80 }} />
            <label className="field-label">Reporter</label>
            <input className="input" value={defectForm.reporter} onChange={e => setDefectForm(f => ({ ...f, reporter: e.target.value }))} placeholder="Name" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddDefect(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitDefect}>Log Defect</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
