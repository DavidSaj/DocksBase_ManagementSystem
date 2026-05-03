import { useState, useEffect } from 'react';
import useMembers from '../hooks/useMembers.js';
import useSegments from '../hooks/useSegments.js';
import useMemberDocuments from '../hooks/useMemberDocuments.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import api, { sendMagicLink } from '../api.js';

function NewMemberModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [memberType, setMemberType] = useState('seasonal');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await onCreate({ name, email, phone, member_type: memberType });
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? ex?.message ?? 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 480, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Add Member</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Full Name</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+353 87 000 0000" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Member Type</label>
              <select value={memberType} onChange={e => setMemberType(e.target.value)}>
                <option value="seasonal">Seasonal</option>
                <option value="transient">Transient</option>
                <option value="visitor">Visitor</option>
                <option value="staff">Staff</option>
              </select>
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Add Member'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

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

function UploadDocModal({ members, onClose, onUpload }) {
  const [selectedMember, setSelectedMember] = useState('');
  const [docType, setDocType] = useState('insurance');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) { setErr('Please select a file.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('member', selectedMember);
      fd.append('doc_type', docType);
      fd.append('file', file);
      await onUpload(fd);
      onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? ex?.message ?? 'Upload failed');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 420, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Upload Document</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Member</label>
              <select required value={selectedMember} onChange={e => setSelectedMember(e.target.value)}>
                <option value="">Select member…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Document Type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)}>
                <option value="insurance">Insurance</option>
                <option value="registration">Registration</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>File</label>
              <input type="file" required onChange={e => setFile(e.target.files[0])} />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Members({ setScreen }) {
  const [tab, setTab] = useState('members');
  const [sel, setSel] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showUploadDoc, setShowUploadDoc] = useState(false);
  const [linkSent, setLinkSent]       = useState(false);
  const [linkSending, setLinkSending] = useState(false);
  const [financialSnap, setFinancialSnap] = useState(null);
  const [snapLoading, setSnapLoading]     = useState(false);
  const [showPayModal, setShowPayModal]   = useState(false);
  const [payAmount, setPayAmount]         = useState('');
  const [payMethod, setPayMethod]         = useState('cash');
  const [payNotes, setPayNotes]           = useState('');
  const [payLoading, setPayLoading]       = useState(false);
  const [payError, setPayError]           = useState(null);

  async function handleSendPortalLink() {
    if (!sel?.id) return;
    setLinkSending(true);
    try {
      await sendMagicLink(sel.id);
      setLinkSent(true);
      setTimeout(() => setLinkSent(false), 3000);
    } catch {
      // silently ignore
    } finally {
      setLinkSending(false);
    }
  }

  useEffect(() => {
    if (!sel?.id) { setFinancialSnap(null); return; }
    setSnapLoading(true);
    setFinancialSnap(null);
    api.get(`/billing/accounts/${sel.id}/`)
      .then(r => setFinancialSnap(r.data))
      .catch(() => setFinancialSnap(null))
      .finally(() => setSnapLoading(false));
  }, [sel?.id]);

  const { members: raw, loading, createMember } = useMembers();
  const members = raw.map(fmt);
  const { segments, loading: segsLoading } = useSegments();
  const { memberDocs, loading: docsLoading, uploadDoc, updateDoc } = useMemberDocuments();

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
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Ic n="plus" s={12} />Add Member</button>
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
                    <tr key={m.id} style={{ cursor: 'pointer', background: sel?.id === m.id ? '#f5f8ff' : '' }} onClick={() => { setSel(m); setLinkSent(false); }}>
                      <td><div className="tbl-name">{m.name}</div><div className="tbl-sub">{m.email}</div></td>
                      <td style={{ fontWeight: 500 }}>{m.vessel}</td>
                      <td><StatusBadge s={m.type} /></td>
                      <td><span style={{ fontSize: 11, fontWeight: 600, color: m.insurance === 'expired' ? 'var(--red)' : 'var(--green)' }}>{m.insurance === 'expired' ? '⚠ Expired' : '✓ ' + m.insurance}</span></td>
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

              {/* Financial Snapshot */}
              {snapLoading && (
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>Loading balance…</div>
              )}
              {financialSnap && (() => {
                const outstanding = Number(financialSnap.summary.total_outstanding);
                const anyOverdue  = financialSnap.open_invoices.some(
                  inv => inv.due_date && new Date(inv.due_date) < new Date()
                );
                const balColor = outstanding === 0 ? 'var(--green)' : anyOverdue ? 'var(--red)' : 'var(--navy)';
                const sortedInv = [...financialSnap.open_invoices].sort((a, b) =>
                  (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : 1
                );
                return (
                  <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 14px', margin: '8px 0 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Outstanding Balance</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: balColor, marginBottom: 8 }}>
                      €{outstanding.toFixed(2)}
                      {outstanding === 0 && <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 8 }}>✓ Settled</span>}
                    </div>
                    {sortedInv.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        {sortedInv.slice(0, 3).map(inv => {
                          const isOverdue = inv.due_date && new Date(inv.due_date) < new Date();
                          const remaining = Number(inv.total) - Number(inv.amount_paid_so_far);
                          return (
                            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: 'var(--border)' }}>
                              <span style={{ color: isOverdue ? 'var(--red)' : 'rgba(0,0,0,0.55)' }}>
                                {inv.invoice_number}
                                {isOverdue && <span className="badge badge-red" style={{ marginLeft: 5, fontSize: 9 }}>OVERDUE</span>}
                              </span>
                              <span style={{ fontWeight: 600 }}>€{remaining.toFixed(2)}</span>
                            </div>
                          );
                        })}
                        {sortedInv.length > 3 && (
                          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 4 }}>…and {sortedInv.length - 3} more</div>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ flex: 1, justifyContent: 'center' }}
                        disabled={sortedInv.length === 0}
                        onClick={() => { setPayAmount(''); setPayMethod('cash'); setPayNotes(''); setPayError(null); setShowPayModal(true); }}
                      >
                        Record Payment
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ flex: 1, justifyContent: 'center' }}
                        onClick={() => { localStorage.setItem('billing_open_member', String(sel.id)); setScreen('billing'); }}
                      >
                        View Full Ledger →
                      </button>
                    </div>
                  </div>
                );
              })()}

              {[['Email',sel.email],['Phone',sel.phone],['Insurance',sel.insurance],['Documents',sel.docs],['Member Since',sel.joined]].map(([k,v]) => (
                <div key={k} className="detail-row">
                  <div className="detail-key">{k}</div>
                  <div className="detail-val" style={{ color: k==='Insurance' && v==='expired' ? 'var(--red)' : undefined }}>{v}</div>
                </div>
              ))}
              <div className="detail-actions">
                <button className="btn btn-primary" style={{ justifyContent: 'center' }}>Send Message</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>View Documents</button>
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Edit Profile</button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifyContent: 'center' }}
                  onClick={handleSendPortalLink}
                  disabled={linkSending || !sel?.email}
                  title={sel?.email ? undefined : 'Member has no email address'}
                >
                  {linkSent ? 'Link sent' : linkSending ? 'Sending…' : 'Send portal link'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Document Vault</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowUploadDoc(true)}><Ic n="plus" s={11} />Upload Document</button>
          </div>
          {showUploadDoc && (
            <UploadDocModal
              members={members}
              onClose={() => setShowUploadDoc(false)}
              onUpload={uploadDoc}
            />
          )}
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Member</th><th>Type</th><th>Expiry</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead>
              <tbody>
                {docsLoading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : memberDocs.map(d => (
                  <tr key={d.id}>
                    <td className="tbl-name">{d.member_name}</td>
                    <td style={{ fontSize: 12 }}>{d.doc_type}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{d.expiry_date || '—'}</td>
                    <td>
                      <span className={`badge ${
                        d.status === 'verified'      ? 'badge-green' :
                        d.status === 'due_soon'      ? 'badge-gold'  :
                        d.status === 'expired'       ? 'badge-red'   : 'badge-gray'
                      }`}>{d.status.replace('_', ' ')}</span>
                    </td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>{d.notes || '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {d.file && <a className="btn btn-ghost btn-sm" href={d.file} target="_blank" rel="noreferrer">View</a>}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const expiry = prompt('Set expiry date (YYYY-MM-DD):', d.expiry_date || '');
                          if (expiry) updateDoc(d.id, { expiry_date: expiry, status: 'verified' });
                        }}
                      >
                        Set Expiry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', lineHeight: 1 }}>{seg.count ?? '—'}</div>
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

      {showAdd && (
        <NewMemberModal
          onClose={() => setShowAdd(false)}
          onCreate={async (payload) => { await createMember(payload); setShowAdd(false); }}
        />
      )}
    </div>
  );
}
