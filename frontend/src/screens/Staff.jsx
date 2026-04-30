import { useState } from 'react';
import Ic from '../components/ui/Icon.jsx';
import useStaff from '../hooks/useStaff.js';
import useShifts from '../hooks/useShifts.js';
import useCertifications from '../hooks/useCertifications.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function fmtWeekLabel(weekStart) {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function shiftClass(dept) {
  if (!dept) return 'shift-pill shift-dock';
  if (dept.includes('Dock'))   return 'shift-pill shift-dock';
  if (dept.includes('Yard'))   return 'shift-pill shift-yard';
  if (dept.includes('Fuel'))   return 'shift-pill shift-fuel';
  if (dept.includes('Office')) return 'shift-pill shift-office';
  if (dept.includes('Mgmt'))   return 'shift-pill shift-mgmt';
  if (dept.includes('Maint'))  return 'shift-pill shift-maint';
  return 'shift-pill shift-dock';
}

const CERT_STATUS_CLASS = { valid: 'badge-green', due_soon: 'badge-orange', expired: 'badge-red' };
const CONTRACT_CLASS = { full_time: 'badge-teal', seasonal: 'badge-gold' };
const CONTRACT_LABEL = { full_time: 'Full Time', part_time: 'Part Time', seasonal: 'Seasonal', contractor: 'Contractor' };

function InviteModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'staff' });
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); onClose(); } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-hdr"><span className="modal-title">Invite Staff</span><button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button></div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">Full Name<input className="input" value={form.name} onChange={set('name')} required/></label>
          <label className="field-label">Email<input className="input" type="email" value={form.email} onChange={set('email')} required/></label>
          <label className="field-label">Role
            <select className="input" value={form.role} onChange={set('role')}>
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending…' : 'Send Invite'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditStaffModal({ staff, onClose, onSave }) {
  const [form, setForm] = useState({
    name: staff.name, role: staff.role, department: staff.department || '',
    email: staff.email, phone: staff.phone || '',
    contract: staff.contract, start_date: staff.start_date || '',
  });
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try { await onSave(staff.id, form); onClose(); } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-hdr"><span className="modal-title">Edit Profile</span><button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button></div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">Full Name<input className="input" value={form.name} onChange={set('name')} required/></label>
          <label className="field-label">Role<input className="input" value={form.role} onChange={set('role')}/></label>
          <label className="field-label">Department<input className="input" value={form.department} onChange={set('department')}/></label>
          <label className="field-label">Email<input className="input" type="email" value={form.email} onChange={set('email')}/></label>
          <label className="field-label">Phone<input className="input" value={form.phone} onChange={set('phone')}/></label>
          <label className="field-label">Start Date<input className="input" type="date" value={form.start_date} onChange={set('start_date')}/></label>
          <label className="field-label">Contract
            <select className="input" value={form.contract} onChange={set('contract')}>
              <option value="full_time">Full Time</option>
              <option value="part_time">Part Time</option>
              <option value="seasonal">Seasonal</option>
              <option value="contractor">Contractor</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CertModal({ staffList, certToEdit, onClose, onSave }) {
  const [form, setForm] = useState({
    staff_member: certToEdit?.staff_member ?? '',
    name: certToEdit?.name ?? '',
    issuing_body: certToEdit?.issuing_body ?? '',
    issued: certToEdit?.issued ?? '',
    expires: certToEdit?.expires ?? '',
  });
  const [pdfFile, setPdfFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v !== '') fd.append(k, v); });
      if (pdfFile) fd.append('pdf_file', pdfFile);
      await onSave(certToEdit?.id ?? null, fd);
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-hdr"><span className="modal-title">{certToEdit ? 'Edit Certification' : 'Add Certification'}</span><button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button></div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!certToEdit && (
            <label className="field-label">Staff Member
              <select className="input" value={form.staff_member} onChange={set('staff_member')} required>
                <option value="">Select…</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <label className="field-label">Certification Name<input className="input" value={form.name} onChange={set('name')} required/></label>
          <label className="field-label">Issuing Body<input className="input" value={form.issuing_body} onChange={set('issuing_body')}/></label>
          <label className="field-label">Issued<input className="input" type="date" value={form.issued} onChange={set('issued')}/></label>
          <label className="field-label">Expires<input className="input" type="date" value={form.expires} onChange={set('expires')}/></label>
          <label className="field-label">
            {certToEdit?.pdf_file ? 'Replace PDF' : 'Upload PDF'}
            {certToEdit?.pdf_file && <a href={certToEdit.pdf_file} target="_blank" rel="noreferrer" style={{ fontSize: 11, marginLeft: 8, color: 'var(--blue)' }}>View current</a>}
            <input type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0] || null)} style={{ marginTop: 4 }}/>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddShiftModal({ staffList, weekStart, onClose, onSave, prefill }) {
  const [form, setForm] = useState({
    staff_member: prefill?.staffId ?? '',
    week_start: weekStart,
    day: prefill?.day ?? 'mon',
    start_time: '',
    end_time: '',
    department: 'Dock',
    is_off: false,
  });
  const [saving, setSaving] = useState(false);
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (form.is_off) { payload.start_time = null; payload.end_time = null; }
      await onSave(payload);
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-hdr"><span className="modal-title">Add Shift</span><button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button></div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">Staff Member
            <select className="input" value={form.staff_member} onChange={set('staff_member')} required>
              <option value="">Select…</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field-label">Day
            <select className="input" value={form.day} onChange={set('day')}>
              {DAY_KEYS.map((d, i) => <option key={d} value={d}>{DAYS[i]}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={form.is_off} onChange={set('is_off')}/> Day Off
          </label>
          {!form.is_off && <>
            <label className="field-label">Start Time<input className="input" type="time" value={form.start_time} onChange={set('start_time')} required/></label>
            <label className="field-label">End Time<input className="input" type="time" value={form.end_time} onChange={set('end_time')} required/></label>
            <label className="field-label">Department<input className="input" value={form.department} onChange={set('department')}/></label>
          </>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add Shift'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Staff() {
  const [tab, setTab] = useState('directory');
  const [sel, setSel] = useState(null);
  const [search, setSearch] = useState('');
  const [weekStart, setWeekStart] = useState(getMondayOf(new Date()));
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [certModal, setCertModal] = useState(null);
  const [addShiftOpen, setAddShiftOpen] = useState(false);
  const [popoverCell, setPopoverCell] = useState(null);
  const [deactivateId, setDeactivateId] = useState(null);

  const { staff, loading: staffLoading, inviteStaff, updateStaff, deactivateStaff } = useStaff();
  const { shifts, createShift } = useShifts(weekStart);
  const { certs, createCert, updateCert } = useCertifications();

  function prevWeek() {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().split('T')[0]);
  }
  function nextWeek() {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().split('T')[0]);
  }

  const filtered = staff.filter(s => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || (s.role || '').toLowerCase().includes(q);
  });

  const shiftMap = {};
  shifts.forEach(s => { shiftMap[`${s.staff_member}-${s.day}`] = s; });

  const certCount = {};
  certs.forEach(c => { certCount[c.staff_member] = (certCount[c.staff_member] || 0) + 1; });

  const selCerts = sel ? certs.filter(c => c.staff_member === sel.id) : [];

  async function handleCertSave(id, formData) {
    if (id) await updateCert(id, formData);
    else await createCert(formData);
  }

  async function handleDeactivate(id) {
    await deactivateStaff(id);
    setDeactivateId(null);
    if (sel?.id === id) setSel(prev => ({ ...prev, is_active: false }));
  }

  return (
    <div>
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onSave={inviteStaff}/>}
      {editOpen && sel && <EditStaffModal staff={sel} onClose={() => setEditOpen(false)} onSave={async (id, payload) => { const updated = await updateStaff(id, payload); setSel(updated); }}/>}
      {certModal && <CertModal staffList={staff} certToEdit={certModal === 'create' ? null : certModal} onClose={() => setCertModal(null)} onSave={handleCertSave}/>}
      {addShiftOpen && <AddShiftModal staffList={staff} weekStart={weekStart} prefill={null} onClose={() => setAddShiftOpen(false)} onSave={createShift}/>}
      {popoverCell && <AddShiftModal staffList={staff} weekStart={weekStart} prefill={popoverCell} onClose={() => setPopoverCell(null)} onSave={createShift}/>}
      {deactivateId && (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 360 }}>
            <div className="modal-hdr"><span className="modal-title">Deactivate Staff Member</span></div>
            <p style={{ fontSize: 13, margin: '12px 0' }}>This will prevent the staff member from logging in. Are you sure?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeactivateId(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--red)' }} onClick={() => handleDeactivate(deactivateId)}>Deactivate</button>
            </div>
          </div>
        </div>
      )}

      <div className="tabs">
        {[['directory','Directory'],['rota','Weekly Rota'],['certifications','Certifications']].map(([v,l]) => (
          <div key={v} className={`tab${tab===v?' active':''}`} onClick={() => { setTab(v); setSel(null); }}>{l}</div>
        ))}
      </div>

      {tab === 'directory' && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 280px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div className="search"><Ic n="search" s={13}/><input placeholder="Search staff…" value={search} onChange={e => setSearch(e.target.value)}/></div>
              <button className="btn btn-primary" onClick={() => setInviteOpen(true)}><Ic n="plus" s={12}/>Invite Staff</button>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Contact</th><th>Contract</th><th>Certs</th></tr></thead>
                <tbody>
                  {staffLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</td></tr>}
                  {filtered.map(s => (
                    <tr key={s.id} style={{ cursor: 'pointer', background: sel?.id===s.id?'#f5f8ff':'', opacity: s.is_active ? 1 : 0.45 }} onClick={() => setSel(s)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="avatar" style={{ background: 'var(--navy)', color: '#fff', width: 28, height: 28, fontSize: 10 }}>{s.initials}</div>
                          <div className="tbl-name">{s.name}</div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{s.role}</td>
                      <td>{s.department && <span className="badge badge-gray">{s.department}</span>}</td>
                      <td><div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{s.phone}</div></td>
                      <td><span className={`badge ${CONTRACT_CLASS[s.contract] || 'badge-gray'}`}>{CONTRACT_LABEL[s.contract] || s.contract}</span></td>
                      <td style={{ fontSize: 12 }}>{certCount[s.id] || 0} certs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {sel && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div className="avatar" style={{ background: 'var(--navy)', color: '#fff', width: 36, height: 36, fontSize: 12 }}>{sel.initials}</div>
                  <div className="detail-title" style={{ marginBottom: 0 }}>{sel.name}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12}/></button>
              </div>
              <div className="detail-sub" style={{ marginTop: 6 }}>{sel.role}{sel.department ? ` · ${sel.department}` : ''}</div>
              {[['Email', sel.email], ['Phone', sel.phone], ['Start Date', sel.start_date], ['Contract', CONTRACT_LABEL[sel.contract] || sel.contract]].map(([k,v]) => v ? (
                <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
              ) : null)}
              <div style={{ marginTop: 14, fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Certifications
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => setCertModal('create')}>+ Add</button>
              </div>
              {selCerts.length === 0 && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '4px 0' }}>No certifications</div>}
              {selCerts.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: 'var(--border)', fontSize: 12, cursor: 'pointer' }} onClick={() => setCertModal(c)}>
                  <span className={`badge ${CERT_STATUS_CLASS[c.status] || 'badge-gray'}`} style={{ fontSize: 9 }}>{c.status}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  {c.pdf_file && <a href={c.pdf_file} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 11 }} onClick={e => e.stopPropagation()}>PDF</a>}
                </div>
              ))}
              <div className="detail-actions">
                <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => setEditOpen(true)}>Edit Profile</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={() => { setTab('rota'); setSel(null); }}>View Rota</button>
                {sel.is_active && <button className="btn btn-ghost" style={{ justifyContent: 'center', color: 'var(--red)' }} onClick={() => setDeactivateId(sel.id)}>Deactivate Account</button>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'rota' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Week of {fmtWeekLabel(weekStart)}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={prevWeek}>← Previous</button>
              <button className="btn btn-ghost btn-sm" onClick={nextWeek}>Next →</button>
              <button className="btn btn-primary btn-sm" onClick={() => setAddShiftOpen(true)}><Ic n="plus" s={11}/>Add Shift</button>
            </div>
          </div>
          <div className="rota-wrap">
            <div className="rota-grid" style={{ gridTemplateColumns: `140px repeat(${DAYS.length}, 1fr)` }}>
              <div className="rota-hdr">Staff Member</div>
              {DAYS.map(d => <div key={d} className="rota-hdr">{d}</div>)}
              {staff.filter(s => s.is_active).map(s => (
                <>
                  <div key={s.id + '-name'} className="rota-name-cell">
                    <div className="avatar" style={{ background: 'var(--navy)', color: '#fff', width: 26, height: 26, fontSize: 10 }}>{s.initials}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.8)', lineHeight: 1.3 }}>{s.name}<br/><span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.38)', fontSize: 10 }}>{s.role}</span></div>
                  </div>
                  {DAY_KEYS.map((dayKey) => {
                    const shift = shiftMap[`${s.id}-${dayKey}`];
                    const isOff = shift?.is_off;
                    const isEmpty = !shift;
                    return (
                      <div key={s.id + '-' + dayKey} className="rota-cell"
                        style={{ cursor: isEmpty ? 'pointer' : 'default' }}
                        onClick={() => isEmpty ? setPopoverCell({ staffId: s.id, day: dayKey }) : null}
                      >
                        {isEmpty ? <span style={{ color: 'rgba(0,0,0,0.18)', fontSize: 11 }}>+</span>
                          : isOff ? <span className="shift-off">Off</span>
                          : <span className={shiftClass(shift.department)}>{shift.department || 'Shift'}</span>}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            {[['Dock','#dbeeff','#0050a0'],['Yard','#e4f5e9','#1a6020'],['Fuel','#fff5e0','#a04000'],['Office','#f0efed','#5a5550'],['Mgmt','#eee8f7','#4a2a8a'],['Maintenance','#fde8e8','#a01c1c']].map(([l,bg,c]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(0,0,0,0.5)' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: bg, border: `1px solid ${c}30` }}/>{l}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'certifications' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Certification Register</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {certs.filter(c => c.status === 'expired').length > 0 && <span className="badge badge-red">{certs.filter(c => c.status === 'expired').length} Expired</span>}
              {certs.filter(c => c.status === 'due_soon').length > 0 && <span className="badge badge-orange">{certs.filter(c => c.status === 'due_soon').length} Due Soon</span>}
              <button className="btn btn-ghost btn-sm">Export</button>
              <button className="btn btn-primary btn-sm" onClick={() => setCertModal('create')}><Ic n="plus" s={11}/>Add Cert</button>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Staff Member</th><th>Certification</th><th>Issuing Body</th><th>Issued</th><th>Expiry</th><th>Status</th><th>PDF</th></tr></thead>
              <tbody>
                {certs.map(c => {
                  const member = staff.find(s => s.id === c.staff_member);
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setCertModal(c)}>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><div className="avatar" style={{ background: 'var(--navy)', color: '#fff', width: 22, height: 22, fontSize: 9 }}>{member?.initials}</div><span style={{ fontSize: 12, fontWeight: 500 }}>{member?.name}</span></div></td>
                      <td className="tbl-name">{c.name}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{c.issuing_body}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{c.issued}</td>
                      <td style={{ fontSize: 12, fontWeight: 600, color: c.status==='expired'?'var(--red)':c.status==='due_soon'?'var(--orange)':'var(--green)' }}>{c.expires || '—'}</td>
                      <td><span className={`badge ${CERT_STATUS_CLASS[c.status] || 'badge-gray'}`}>{c.status === 'due_soon' ? 'Due Soon' : c.status ? c.status.charAt(0).toUpperCase() + c.status.slice(1) : '—'}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        {c.pdf_file ? <a href={c.pdf_file} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 12 }}><Ic n="file-text" s={13}/></a> : <span style={{ color: 'rgba(0,0,0,0.2)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
