import { useState } from 'react';
import useDocTemplates from '../hooks/useDocTemplates.js';
import useEnvelopes from '../hooks/useEnvelopes.js';
import useMembers from '../hooks/useMembers.js';
import Ic from '../components/ui/Icon.jsx';

function UploadTemplateModal({ onClose, onUpload }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) { setErr('Please select a PDF file.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('category', category);
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
      <div className="card" style={{ width: 460, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Upload Template</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Template Name</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Seasonal Berth Lease" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="lease">Lease</option>
                <option value="insurance">Insurance</option>
                <option value="waiver">Waiver</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PDF File</label>
              <input type="file" accept=".pdf" required onChange={e => setFile(e.target.files[0])} />
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

function SendEnvelopeModal({ template, members, onClose, onSend }) {
  const [recipientId, setRecipientId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await onSend({ template: template.id, recipient: recipientId || null, expires_at: expiresAt || null });
      onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? ex?.message ?? 'Send failed');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 420, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Send Contract</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 18 }}>{template.name}</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recipient</label>
              <select required value={recipientId} onChange={e => setRecipientId(e.target.value)}>
                <option value="">Select member…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Expiry Date (optional)</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const stMap = {
  completed: 'badge-green',
  pending:   'badge-gold',
  expired:   'badge-red',
};

export default function Documents() {
  const { templates, loading: tplLoading, uploadTemplate, prepareTemplate } = useDocTemplates();
  const { envelopes, loading: envLoading, sendEnvelope, getDownloadUrl } = useEnvelopes();
  const { members } = useMembers();
  const [tab, setTab] = useState('templates');
  const [envFilter, setEnvFilter] = useState('all');
  const [selEnv, setSelEnv] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(null);
  const [preparing, setPreparing] = useState(null);

  const filteredEnv = envFilter === 'all' ? envelopes : envelopes.filter(e => e.status === envFilter);

  async function handlePrepare(tpl) {
    setPreparing(tpl.id);
    try {
      const url = await prepareTemplate(tpl.id);
      window.open(url, '_blank');
    } finally {
      setPreparing(null);
    }
  }

  async function handleDownload(env) {
    const url = await getDownloadUrl(env.id);
    window.open(url, '_blank');
  }

  return (
    <div>
      {showUpload && (
        <UploadTemplateModal
          onClose={() => setShowUpload(false)}
          onUpload={uploadTemplate}
        />
      )}
      {sendingTemplate && (
        <SendEnvelopeModal
          template={sendingTemplate}
          members={members}
          onClose={() => setSendingTemplate(null)}
          onSend={sendEnvelope}
        />
      )}

      <div className="tabs">
        {[['templates','Templates'],['envelopes','Envelopes'],['masssend','Mass Send']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'templates' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="sec-hdr-title">Document Templates</div>
              <span className="badge badge-navy">{templates.length}</span>
            </div>
            <button className="btn btn-primary" onClick={() => setShowUpload(true)}><Ic n="plus" s={12} />New Template</button>
          </div>
          {tplLoading ? (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {templates.map(t => (
                <div key={t.id} className="template-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div className="template-card-name">{t.name}</div>
                    <span className={`badge ${t.dropboxsign_template_id ? 'badge-green' : 'badge-gold'}`} style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      {t.dropboxsign_template_id ? 'Ready' : 'Needs Setup'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <span className="badge badge-navy">{t.category}</span>
                    <span className="badge badge-gray">{t.pages}p</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 14 }}>
                    {t.uses_count} uses · {t.last_used ? `Last used: ${t.last_used}` : 'Never sent'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {t.dropboxsign_template_id ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setSendingTemplate(t)}>
                        <Ic n="pen" s={11} />Send Contract
                      </button>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => handlePrepare(t)} disabled={preparing === t.id}>
                        {preparing === t.id ? 'Opening…' : 'Prepare for eSign'}
                      </button>
                    )}
                    {t.file && <a className="btn btn-ghost btn-sm" href={t.file} target="_blank" rel="noreferrer">Download</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'envelopes' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', gap: 8 }}>
              {[['all','All'],['pending','Pending'],['completed','Completed'],['expired','Expired']].map(([v,l]) => (
                <div
                  key={v}
                  onClick={() => { setEnvFilter(v); setSelEnv(null); }}
                  style={{ cursor: 'pointer', padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: envFilter === v ? 'var(--navy)' : 'var(--white)', color: envFilter === v ? '#fff' : 'rgba(0,0,0,0.5)', border: 'var(--border)' }}
                >
                  {l}
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: envFilter === v ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)' }}>
                    {v === 'all' ? envelopes.length : envelopes.filter(e => e.status === v).length}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {envLoading ? (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: selEnv ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="tbl">
                  <thead>
                    <tr><th>Template</th><th>Recipient</th><th>Sent</th><th>Expires</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {filteredEnv.map(e => (
                      <tr key={e.id} style={{ cursor: 'pointer', background: selEnv?.id === e.id ? '#f5f8ff' : '' }} onClick={() => setSelEnv(e)}>
                        <td style={{ fontSize: 12 }}>{e.template_name}</td>
                        <td><div className="tbl-name">{e.recipient_name || '—'}</div><div className="tbl-sub">{e.vessel_name}</div></td>
                        <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{e.sent_at ? new Date(e.sent_at).toLocaleDateString() : '—'}</td>
                        <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{e.expires_at || '—'}</td>
                        <td><span className={`badge ${stMap[e.status] || 'badge-gray'}`}>{e.status}</span></td>
                        <td>
                          {e.status === 'completed' && (
                            <button className="btn btn-ghost btn-sm" onClick={ev => { ev.stopPropagation(); handleDownload(e); }}>View PDF</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selEnv && (
                <div className="detail">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="detail-title">Envelope #{selEnv.id}</div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelEnv(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
                  </div>
                  <span className={`badge ${stMap[selEnv.status] || 'badge-gray'}`} style={{ marginBottom: 14, display: 'inline-block' }}>{selEnv.status}</span>
                  <div style={{ marginTop: 10 }}>
                    {[
                      ['Template', selEnv.template_name],
                      ['Recipient', selEnv.recipient_name || '—'],
                      ['Vessel', selEnv.vessel_name || '—'],
                      ['Sent', selEnv.sent_at ? new Date(selEnv.sent_at).toLocaleDateString() : '—'],
                      ['Expires', selEnv.expires_at || '—'],
                      ['Completed', selEnv.completed_at ? new Date(selEnv.completed_at).toLocaleDateString() : '—'],
                      ['Reminders', selEnv.reminders_sent + ' sent'],
                    ].map(([k, v]) => (
                      <div key={k} className="detail-row">
                        <div className="detail-key">{k}</div>
                        <div className="detail-val">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="detail-actions">
                    {selEnv.status === 'completed' && (
                      <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => handleDownload(selEnv)}>
                        View Signed PDF
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'masssend' && (
        <div className="card" style={{ padding: 24, maxWidth: 500 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Mass Send</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            Mass send requires email/SMS infrastructure. Scheduled for Phase 3.
          </div>
        </div>
      )}
    </div>
  );
}
