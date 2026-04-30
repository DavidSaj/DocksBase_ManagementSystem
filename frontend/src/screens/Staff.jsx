import { useState } from 'react';
import { STAFF, ROTA, CERTIFICATIONS } from '../data/mock.js';
import Ic from '../components/ui/Icon.jsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function shiftClass(shift) {
  if (!shift || shift === 'Off') return 'shift-off';
  if (shift.includes('Dock'))   return 'shift-pill shift-dock';
  if (shift.includes('Yard'))   return 'shift-pill shift-yard';
  if (shift.includes('Fuel'))   return 'shift-pill shift-fuel';
  if (shift.includes('Office')) return 'shift-pill shift-office';
  if (shift.includes('Mgmt'))   return 'shift-pill shift-mgmt';
  if (shift.includes('Maint'))  return 'shift-pill shift-maint';
  return 'shift-pill shift-dock';
}

export default function Staff() {
  const [tab, setTab]   = useState('directory');
  const [sel, setSel]   = useState(null);

  return (
    <div>
      <div className="tabs">
        {[['directory','Directory'],['rota','Weekly Rota'],['certifications','Certifications']].map(([v,l]) => (
          <div key={v} className={`tab${tab===v?' active':''}`} onClick={() => { setTab(v); setSel(null); }}>{l}</div>
        ))}
      </div>

      {tab === 'directory' && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 280px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div className="search"><Ic n="search" s={13}/><input placeholder="Search staff…" /></div>
              <button className="btn btn-primary"><Ic n="plus" s={12}/>Invite Staff</button>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Contact</th><th>Contract</th><th>Certs</th></tr></thead>
                <tbody>
                  {STAFF.map(s => (
                    <tr key={s.id} style={{ cursor: 'pointer', background: sel?.id===s.id?'#f5f8ff':'' }} onClick={() => setSel(s)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="avatar" style={{ background: 'var(--navy)', color: '#fff', width: 28, height: 28, fontSize: 10 }}>{s.initials}</div>
                          <div className="tbl-name">{s.name}</div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>{s.role}</td>
                      <td><span className="badge badge-gray">{s.dept}</span></td>
                      <td><div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{s.phone}</div></td>
                      <td><span className={`badge ${s.contract==='Full-time'?'badge-teal':s.contract==='Seasonal'?'badge-gold':'badge-gray'}`}>{s.contract}</span></td>
                      <td style={{ fontSize: 12 }}>{s.certs.length} certs</td>
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
              <div className="detail-sub" style={{ marginTop: 6 }}>{sel.role} · {sel.dept}</div>
              {[['Email',sel.email],['Phone',sel.phone],['Start Date',sel.start],['Contract',sel.contract]].map(([k,v]) => (
                <div key={k} className="detail-row"><div className="detail-key">{k}</div><div className="detail-val">{v}</div></div>
              ))}
              <div style={{ marginTop: 14, fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Certifications</div>
              {sel.certs.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                  <Ic n="check" s={11} c="var(--green)"/>
                  {c}
                </div>
              ))}
              <div className="detail-actions">
                <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Edit Profile</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>View Rota</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Deactivate Account</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'rota' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Week of 28 Apr – 4 May 2026</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm">← Previous</button>
              <button className="btn btn-ghost btn-sm">Next →</button>
              <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>Add Shift</button>
            </div>
          </div>
          <div className="rota-wrap">
            <div className="rota-grid" style={{ gridTemplateColumns: `140px repeat(${DAYS.length}, 1fr)` }}>
              <div className="rota-hdr">Staff Member</div>
              {DAYS.map(d => <div key={d} className="rota-hdr">{d}</div>)}
              {ROTA.map(row => {
                const staff = STAFF.find(s => s.id === row.staffId);
                return staff ? (
                  <>
                    <div key={row.staffId + '-name'} className="rota-name-cell">
                      <div className="avatar" style={{ background: 'var(--navy)', color: '#fff', width: 26, height: 26, fontSize: 10 }}>{staff.initials}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.8)', lineHeight: 1.3 }}>{staff.name}<br/><span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.38)', fontSize: 10 }}>{staff.role}</span></div>
                    </div>
                    {DAYS.map(d => {
                      const shift = row.shifts[d];
                      const isOff = !shift || shift === 'Off';
                      return (
                        <div key={row.staffId + '-' + d} className="rota-cell">
                          {isOff
                            ? <span className="shift-off">Off</span>
                            : <span className={shiftClass(shift)}>{shift}</span>
                          }
                        </div>
                      );
                    })}
                  </>
                ) : null;
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            {[['Dock','#dbeeff','#0050a0'],['Yard','#e4f5e9','#1a6020'],['Fuel','#fff5e0','#a04000'],['Office','#f0efed','#5a5550'],['Mgmt','#eee8f7','#4a2a8a'],['Maintenance','#fde8e8','#a01c1c']].map(([l,bg,c]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(0,0,0,0.5)' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: bg, border: `1px solid ${c}30` }}/>
                {l}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'certifications' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Certification Register</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-red">{CERTIFICATIONS.filter(c=>c.status==='expired').length} Expired</span>
              <span className="badge badge-orange">{CERTIFICATIONS.filter(c=>c.status==='due-soon').length} Due Soon</span>
              <button className="btn btn-ghost btn-sm">Export</button>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Staff Member</th><th>Certification</th><th>Issuing Body</th><th>Issued</th><th>Expiry</th><th>Status</th></tr></thead>
              <tbody>
                {CERTIFICATIONS.map((c, i) => {
                  const staff = STAFF.find(s => s.id === c.staffId);
                  return (
                    <tr key={i}>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><div className="avatar" style={{ background: 'var(--navy)', color: '#fff', width: 22, height: 22, fontSize: 9 }}>{staff?.initials}</div><span style={{ fontSize: 12, fontWeight: 500 }}>{staff?.name}</span></div></td>
                      <td className="tbl-name">{c.cert}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{c.body}</td>
                      <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{c.issued}</td>
                      <td style={{ fontSize: 12, fontWeight: 600, color: c.status==='expired'?'var(--red)':c.status==='due-soon'?'var(--orange)':'var(--green)' }}>{c.expiry}</td>
                      <td><span className={`badge ${c.status==='expired'?'badge-red':c.status==='due-soon'?'badge-orange':'badge-green'}`}>{c.status === 'due-soon' ? 'Due Soon' : c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span></td>
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
