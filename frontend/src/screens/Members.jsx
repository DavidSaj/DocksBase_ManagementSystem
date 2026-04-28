import { useState } from 'react';
import useMembers from '../hooks/useMembers.js';
import useSegments from '../hooks/useSegments.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';

function fmt(m) {
  const vessel = m.vessels?.[0]?.name ?? m.vessel ?? '—';
  return {
    ...m,
    vessel,
    type:      m.member_type      ?? m.type      ?? '—',
    insurance: m.insurance_status ?? m.insurance ?? '—',
    docs:      m.docs_status      ?? m.docs      ?? '—',
    joined:    m.joined_at        ?? m.joined    ?? '—',
  };
}

export default function Members() {
  const [tab, setTab] = useState('members');
  const [sel, setSel] = useState(null);

  const { members: raw, loading } = useMembers();
  const members = raw.map(fmt);
  const { segments, loading: segsLoading } = useSegments();

  return (
    <div>
      <div className="tabs">
        {[['members','Members & Owners'],['docs','Document Vault'],['comms','Communications'],['segments','Segments']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'members' && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 280px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div className="search"><Ic n="search" s={13} /><input placeholder="Search owner or vessel…" /></div>
              <button className="btn btn-primary"><Ic n="plus" s={12} />Add Member</button>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Owner</th><th>Vessel</th><th>Type</th><th>Insurance</th><th>Documents</th><th>Member Since</th></tr></thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                  ) : members.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No members found.</td></tr>
                  ) : members.map(m => (
                    <tr key={m.id} style={{ cursor: 'pointer', background: sel?.id === m.id ? '#f5f8ff' : '' }} onClick={() => setSel(m)}>
                      <td><div className="tbl-name">{m.name}</div><div className="tbl-sub">{m.email}</div></td>
                      <td style={{ fontWeight: 500 }}>{m.vessel}</td>
                      <td><StatusBadge s={m.type} /></td>
                      <td><span style={{ fontSize: 11, fontWeight: 600, color: m.insurance === 'EXPIRED' || m.insurance === 'expired' ? 'var(--red)' : 'var(--green)' }}>{m.insurance === 'EXPIRED' || m.insurance === 'expired' ? '⚠ Expired' : '✓ ' + m.insurance}</span></td>
                      <td><StatusBadge s={m.docs} /></td>
                      <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.38)' }}>{m.joined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {sel && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div className="detail-title">{sel.name}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
              </div>
              <div className="detail-sub">{sel.vessel} · {sel.type}</div>
              {[['Email',sel.email],['Phone',sel.phone],['Insurance',sel.insurance],['Documents',sel.docs],['Member Since',sel.joined]].map(([k,v]) => (
                <div key={k} className="detail-row">
                  <div className="detail-key">{k}</div>
                  <div className="detail-val" style={{ color: k==='Insurance' && (v==='EXPIRED'||v==='expired') ? 'var(--red)' : undefined }}>{v}</div>
                </div>
              ))}
              <div className="detail-actions">
                <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Send Message</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>View Documents</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Edit Profile</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header"><div className="card-header-title">Document Vault</div></div>
          <table className="tbl">
            <thead><tr><th>Owner</th><th>Vessel</th><th>Registration</th><th>Insurance</th><th>Slip Lease</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
              ) : members.map(m => (
                <tr key={m.id}>
                  <td className="tbl-name">{m.name}</td>
                  <td>{m.vessel}</td>
                  <td>{m.docs==='complete' ? <span style={{color:'var(--green)',fontSize:11,fontWeight:600}}>✓ On file</span> : <span style={{color:'var(--orange)',fontSize:11,fontWeight:600}}>⚠ Missing</span>}</td>
                  <td>{m.insurance==='EXPIRED'||m.insurance==='expired' ? <span style={{color:'var(--red)',fontSize:11,fontWeight:600}}>✗ Expired</span> : m.docs==='missing' ? <span style={{color:'var(--orange)',fontSize:11,fontWeight:600}}>⚠ Pending</span> : <span style={{color:'var(--green)',fontSize:11,fontWeight:600}}>✓ Valid</span>}</td>
                  <td>{m.type==='Seasonal'||m.type==='seasonal' ? <span style={{color:'var(--green)',fontSize:11,fontWeight:600}}>✓ Signed</span> : <span style={{color:'rgba(0,0,0,0.3)',fontSize:11}}>—</span>}</td>
                  <td><button className="btn btn-ghost btn-sm">Request Upload</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'comms' && (
        <div className="card" style={{ padding: 24, maxWidth: 600 }}>
          <div className="card-header-title" style={{ marginBottom: 16 }}>Send Blast Message</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Recipients', el: <select><option>All berth holders ({members.length})</option><option>Seasonal only</option><option>Transient only</option><option>Custom selection</option></select> },
              { label: 'Channel',    el: <select><option>Email</option><option>SMS</option><option>Email + SMS</option></select> },
              { label: 'Subject',    el: <input type="text" placeholder="e.g. Storm Warning — Secure Your Lines" /> },
              { label: 'Message',    el: <textarea rows={5} placeholder="Type your message to all berth holders…" style={{ resize: 'vertical' }} /> },
            ].map(({ label, el }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
                {el}
              </div>
            ))}
            <button className="btn btn-primary" style={{ justifyContent: 'center', padding: '9px' }}>Send Message</button>
          </div>
        </div>
      )}

      {tab === 'segments' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Member Segments</div>
            <button className="btn btn-primary btn-sm"><Ic n="plus" s={11}/>New Segment</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {segsLoading ? (
              <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
            ) : segments.map(seg => (
              <div key={seg.id} className="card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{seg.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', fontFamily: 'monospace', letterSpacing: '0.2px' }}>{seg.description}</div>
                </div>
                <div style={{ display: 'flex', align: 'center', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', lineHeight: 1 }}>{seg.count}</div>
                    <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>members</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
                    <button className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }}>Send Message</button>
                    <button className="btn btn-ghost btn-sm" style={{ whiteSpace: 'nowrap' }}>View Members</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 20, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Build a Segment</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <select style={{ flex: 1 }}><option>Member Type</option><option>Insurance Status</option><option>Document Status</option><option>Tags</option><option>Member Since</option></select>
                <select style={{ flex: 1 }}><option>is</option><option>is not</option><option>contains</option><option>expires within</option></select>
                <input type="text" placeholder="Value…" style={{ flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" placeholder="Segment name…" style={{ flex: 1 }} />
                <button className="btn btn-primary">Save Segment</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
