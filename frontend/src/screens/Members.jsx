import { useState, useEffect } from 'react';
import useMembers from '../hooks/useMembers.js';
import useMemberDocuments from '../hooks/useMemberDocuments.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import api, { sendMagicLink } from '../api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

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

function BerthContractModal({ member, onClose }) {
  const [berths, setBerths] = useState([]);
  const [berthId, setBerthId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [annualRate, setAnnualRate] = useState('');
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/berths/').then(r => {
      setBerths(r.data?.results ?? r.data ?? []);
    }).catch(() => setBerths([]));
  }, []);

  async function handleGenerate(e) {
    e.preventDefault();
    if (!berthId || !startDate || !endDate || !annualRate) {
      setErr('All fields except Notes are required.');
      return;
    }
    setGenerating(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        berth_id: berthId,
        start_date: startDate,
        end_date: endDate,
        annual_rate: annualRate,
        ...(notes ? { notes } : {}),
      });
      const response = await api.get(
        `/members/${member.id}/berth-agreement-pdf/?${params.toString()}`,
        { responseType: 'blob' }
      );
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const year = startDate.slice(0, 4);
      a.download = `berth-agreement-${member.name.replace(/\s+/g, '-')}-${year}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (ex) {
      const detail = ex?.response?.data?.detail ?? ex?.message ?? 'PDF generation failed.';
      setErr(detail);
      setGenerating(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 500, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Download Berth Contract</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 18 }}>{member.name}</div>
        <form onSubmit={handleGenerate}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Berth</label>
              <select required value={berthId} onChange={e => setBerthId(e.target.value)}>
                <option value="">Select berth…</option>
                {berths.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.code}{b.pier_name ? ` — ${b.pier_name}` : ''}{b.length_m ? ` (${b.length_m}m)` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Start Date</label>
                <input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>End Date</label>
                <input required type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Annual Rate (&euro;)</label>
              <input required type="number" min="0" step="0.01" placeholder="e.g. 3500.00" value={annualRate} onChange={e => setAnnualRate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Notes (optional)</label>
              <textarea rows={3} placeholder="Any additional terms or remarks…" value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'vertical' }} />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={generating}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={generating}>
              {generating ? 'Generating…' : 'Generate PDF'}
            </button>
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
  const [showContractModal, setShowContractModal] = useState(false);

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

  const selId = sel?.id ?? null;
  useEffect(() => {
    if (!selId) { setFinancialSnap(null); return; }
    let cancelled = false;
    setSnapLoading(true);
    setFinancialSnap(null);
    api.get(`/billing/accounts/${selId}/`)
      .then(r => { if (!cancelled) setFinancialSnap(r.data); })
      .catch(() => { if (!cancelled) setFinancialSnap(null); })
      .finally(() => { if (!cancelled) setSnapLoading(false); });
    return () => { cancelled = true; };
  }, [selId]);

  async function recordPayment() {
    if (!payAmount || Number(payAmount) <= 0 || !sel?.id) return;
    setPayLoading(true);
    setPayError(null);
    try {
      await api.post(`/billing/accounts/${sel.id}/payments/`, {
        amount: payAmount,
        method: payMethod,
        notes: payNotes,
      });
      setShowPayModal(false);
      try {
        const r = await api.get(`/billing/accounts/${sel.id}/`);
        setFinancialSnap(r.data);
      } catch {
        setFinancialSnap(null);
      }
    } catch (ex) {
      setPayError(ex?.response?.data?.detail ?? 'Payment failed. Please try again.');
    } finally {
      setPayLoading(false);
    }
  }

  const { members: raw, loading, createMember } = useMembers();
  const members = raw.map(fmt);
  const { memberDocs, loading: docsLoading, uploadDoc, updateDoc } = useMemberDocuments();

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle="Your marina's members, owners, and document vault."
        infoBody={SCREEN_INFO.members}
      />
      <div className="tabs">
        {[['members','Members & Owners'],['docs','Document Vault'],['compliance','Compliance']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'members' && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 280px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div className="search"><Ic n="search" s={13} /><input placeholder="Search owner or vessel…" /></div>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Ic n="plus" s={12} />Add Member</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setScreen('communications')}>Communications →</button>
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
                          const remaining = Number(inv.total ?? 0) - Number(inv.amount_paid_so_far ?? 0);
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
                        onClick={() => { localStorage.setItem('billing_open_member', String(sel.id)); setScreen?.('billing'); }}
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
                  onClick={() => setShowContractModal(true)}
                >
                  Download Contract
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifyContent: 'center' }}
                  onClick={() => {
                    if (!sel?.id) return;
                    localStorage.setItem('documents_pending_recipient', String(sel.id));
                    setScreen?.('documents');
                  }}
                  disabled={!sel?.email}
                  title={sel?.email ? 'Upload a document and send it to this member for e-signature' : 'Member has no email address'}
                >
                  Upload &amp; send for signature
                </button>
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

      {tab === 'compliance' && (() => {
        const total      = members.length;
        const docOk      = members.filter(m => m.docs === 'complete').length;
        const docMissing = members.filter(m => m.docs === 'missing').length;
        const docPending = members.filter(m => m.docs === 'pending').length;
        const needsAction = members.filter(m => m.docs !== 'complete');
        const pct = total > 0 ? Math.round((docOk / total) * 100) : 0;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* KPI row */}
            <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
              {[
                { label: 'Docs Complete',   val: `${docOk}/${total}`, sub: 'Signed & verified' },
                { label: 'Docs Missing',    val: docMissing,          sub: docMissing > 0 ? 'Require immediate action' : 'None missing' },
                { label: 'Docs Pending',    val: docPending,          sub: docPending > 0 ? 'Awaiting review' : 'None pending' },
                { label: 'Fully Compliant', val: `${docOk}/${total}`, sub: `${pct}% compliance rate` },
              ].map(k => (
                <div key={k.label} className="kpi-card">
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-val" style={{ color: (k.label === 'Docs Missing' || k.label === 'Docs Pending') && k.val > 0 ? 'var(--orange)' : undefined }}>{k.val}</div>
                  <div className="kpi-sub">{k.sub}</div>
                </div>
              ))}
            </div>

            <div className="grid-2" style={{ alignItems: 'start' }}>
              {/* Bar chart */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Document Compliance Overview</div>
                {loading ? (
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {[
                      { label: 'Documents Complete', val: docOk, color: 'var(--green)' },
                    ].map(({ label, val, color }) => {
                      const barPct = total > 0 ? Math.round((val / total) * 100) : 0;
                      return (
                        <div key={label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                            <span style={{ color: 'rgba(0,0,0,0.6)' }}>{label}</span>
                            <span style={{ fontWeight: 600 }}>{val}/{total}</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 4, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${barPct}%`, background: color, borderRadius: 4, transition: 'width 0.3s' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 8 }}>Insurance tracked in Vessels → Insurance Tracker</div>
              </div>

              {/* Members requiring action */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                  Members Requiring Action
                  {needsAction.length > 0 && <span className="badge badge-orange" style={{ marginLeft: 8 }}>{needsAction.length}</span>}
                </div>
                {loading ? (
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
                ) : needsAction.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>All members have complete documents.</div>
                ) : needsAction.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 1 }}>{m.vessel}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {m.docs === 'missing' && <span className="badge badge-orange">Docs Missing</span>}
                      {m.docs === 'pending' && <span className="badge badge-gold">Docs Pending</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {showAdd && (
        <NewMemberModal
          onClose={() => setShowAdd(false)}
          onCreate={async (payload) => { await createMember(payload); setShowAdd(false); }}
        />
      )}

      {showContractModal && sel && (
        <BerthContractModal
          member={sel}
          onClose={() => setShowContractModal(false)}
        />
      )}

      {showPayModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setShowPayModal(false)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Record Payment</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>{sel?.name}</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>AMOUNT (€)</div>
              <input
                type="number" step="0.01" min="0.01" autoFocus
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '8px 10px', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>PAYMENT METHOD</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[['cash','Cash'],['external_card','Card'],['bank_transfer','Bank Transfer']].map(([v,l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setPayMethod(v)}
                    style={{
                      padding: '10px 4px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: payMethod === v ? '2px solid var(--navy)' : '1px solid rgba(0,0,0,0.15)',
                      background: payMethod === v ? 'var(--navy)' : '#fff',
                      color: payMethod === v ? '#fff' : 'rgba(0,0,0,0.6)',
                    }}
                  >{l}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>NOTES (optional)</div>
              <input
                placeholder="e.g. Cash received at desk"
                value={payNotes}
                onChange={e => setPayNotes(e.target.value)}
                style={{ width: '100%', border: 'var(--border)', borderRadius: 5, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>

            {payError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{payError}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setShowPayModal(false)}
                disabled={payLoading}
              >Cancel</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={recordPayment}
                disabled={!payAmount || payLoading}
              >{payLoading ? 'Recording…' : 'Record Payment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
