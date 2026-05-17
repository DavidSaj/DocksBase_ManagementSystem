import { useState, useEffect } from 'react';
import useDocTemplates from '../hooks/useDocTemplates.js';
import useEnvelopes from '../hooks/useEnvelopes.js';
import useMembers from '../hooks/useMembers.js';
import Ic from '../components/ui/Icon.jsx';
import ScreenInfo from '../components/ui/ScreenInfo.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

function UploadTemplateModal({ onClose, onUpload, onUploaded }) {
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
      const created = await onUpload(fd);
      onUploaded?.(created);
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

function SendEnvelopeModal({ template, members, onClose, onSend, defaultRecipient = '' }) {
  const [recipientId, setRecipientId] = useState(defaultRecipient);
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

function MassSendTab({ templates, members, sendEnvelope }) {
  const [templateId, setTemplateId] = useState('');
  const [memberIds, setMemberIds] = useState(() => new Set());
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ ok: 0, fail: 0, total: 0 });
  const [errors, setErrors] = useState([]);
  const [done, setDone] = useState(false);

  const eligibleMembers = members.filter(m => m.email);

  function toggleAll() {
    if (memberIds.size === eligibleMembers.length) setMemberIds(new Set());
    else setMemberIds(new Set(eligibleMembers.map(m => m.id)));
  }

  function toggleOne(id) {
    setMemberIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (!templateId || memberIds.size === 0) return;
    const ids = [...memberIds];
    setSending(true);
    setDone(false);
    setErrors([]);
    setProgress({ ok: 0, fail: 0, total: ids.length });
    let ok = 0, fail = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await sendEnvelope({
          template: Number(templateId),
          recipient: id,
          expires_at: expiresAt || null,
        });
        ok += 1;
      } catch (e) {
        fail += 1;
        const member = members.find(m => m.id === id);
        failed.push(`${member?.name || `Member #${id}`}: ${e?.response?.data?.detail || e.message || 'Send failed'}`);
      }
      setProgress({ ok, fail, total: ids.length });
    }
    setErrors(failed);
    setSending(false);
    setDone(true);
  }

  if (templates.length === 0) {
    return (
      <div className="card" style={{ padding: 24, maxWidth: 560 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Mass Send</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.5 }}>
          No e-sign-ready templates yet. Upload a template in the Templates tab
          and finish its provider setup before using mass send.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Mass Send</div>
      <div style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.5)', marginBottom: 18, lineHeight: 1.5 }}>
        Send the same e-sign envelope to multiple members at once. Each member
        receives their own envelope via the e-sign provider — emails go out
        using the marina&apos;s configured email settings.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Template</label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} disabled={sending}>
            <option value="">Select template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Expiry Date (optional)</label>
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} disabled={sending} />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Recipients ({memberIds.size}/{eligibleMembers.length})
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAll} disabled={sending}>
              {memberIds.size === eligibleMembers.length && eligibleMembers.length > 0 ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', border: 'var(--border)', borderRadius: 6 }}>
            {eligibleMembers.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No members with an email address on file.</div>
            ) : eligibleMembers.map(m => (
              <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderBottom: 'var(--border)' }}>
                <input
                  type="checkbox"
                  checked={memberIds.has(m.id)}
                  onChange={() => toggleOne(m.id)}
                  disabled={sending}
                />
                <span style={{ flex: 1 }}>{m.name}</span>
                <span style={{ color: 'rgba(0,0,0,0.4)' }}>{m.email}</span>
              </label>
            ))}
          </div>
        </div>

        {sending && (
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
            Sending… {progress.ok + progress.fail}/{progress.total}
          </div>
        )}
        {done && (
          <div style={{ fontSize: 12, padding: '8px 12px', borderRadius: 6, background: progress.fail === 0 ? '#ecfdf5' : '#fff5f5', border: `1px solid ${progress.fail === 0 ? '#a7f3d0' : 'rgba(220,38,38,0.25)'}`, color: progress.fail === 0 ? '#065f46' : 'var(--red)' }}>
            <div style={{ fontWeight: 600 }}>
              Sent {progress.ok} of {progress.total}{progress.fail > 0 ? ` · ${progress.fail} failed` : ''}.
            </div>
            {errors.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSend}
            disabled={sending || !templateId || memberIds.size === 0}
          >
            {sending ? 'Sending…' : `Send to ${memberIds.size} member${memberIds.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Documents({ setScreen }) {
  const { templates, loading: tplLoading, uploadTemplate, clearWaiver } = useDocTemplates();
  const { envelopes, loading: envLoading, sendEnvelope, getDownloadUrl } = useEnvelopes();
  const { members } = useMembers();
  const [tab, setTab] = useState('templates');
  const [envFilter, setEnvFilter] = useState('all');
  const [selEnv, setSelEnv] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(null);
  const [waiverBusy, setWaiverBusy] = useState(null);
  const [presetRecipient, setPresetRecipient] = useState(null);

  // Cross-screen handoff: Members screen sets `documents_pending_recipient`
  // before navigating here — auto-open the Upload modal so the user can
  // upload + send in one flow.
  useEffect(() => {
    const recip = localStorage.getItem('documents_pending_recipient');
    if (!recip) return;
    localStorage.removeItem('documents_pending_recipient');
    setPresetRecipient(recip);
    setTab('templates');
    setShowUpload(true);
  }, []);

  const filteredEnv = envFilter === 'all' ? envelopes : envelopes.filter(e => e.status === envFilter);

  async function handleDownload(env) {
    const url = await getDownloadUrl(env.id);
    window.open(url, '_blank');
  }

  async function handleClearWaiver(tpl) {
    setWaiverBusy(tpl.id);
    try { await clearWaiver(tpl.id); } finally { setWaiverBusy(null); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>Documents</span>
        <ScreenInfo title="Documents" body={SCREEN_INFO.documents} />
      </div>
      {showUpload && (
        <UploadTemplateModal
          onClose={() => setShowUpload(false)}
          onUpload={uploadTemplate}
          onUploaded={(tpl) => {
            // If we arrived here via the Member detail "Upload & send" flow,
            // chain straight into the SendEnvelope modal with the recipient
            // pre-selected. Only safe if the template is provider-ready.
            if (presetRecipient && tpl?.dropboxsign_template_id) {
              setSendingTemplate(tpl);
            }
          }}
        />
      )}
      {sendingTemplate && (
        <SendEnvelopeModal
          template={sendingTemplate}
          members={members}
          onClose={() => { setSendingTemplate(null); setPresetRecipient(null); }}
          onSend={sendEnvelope}
          defaultRecipient={presetRecipient ?? ''}
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
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {t.dropboxsign_template_id ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setSendingTemplate(t)}>
                        <Ic n="pen" s={11} />Send Contract
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setScreen('infrastructure')}>
                        Set up eSign
                      </button>
                    )}
                    {t.file && <a className="btn btn-ghost btn-sm" href={t.file} target="_blank" rel="noreferrer">Download</a>}
                  </div>
                  {t.category === 'waiver' && t.file && t.is_active_waiver && (
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-green" style={{ fontSize: 10 }}>Active Marina Waiver</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 11, color: 'var(--red)' }}
                        onClick={() => handleClearWaiver(t)}
                        disabled={waiverBusy === t.id}
                      >
                        {waiverBusy === t.id ? '…' : 'Remove'}
                      </button>
                    </div>
                  )}
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
        <MassSendTab
          templates={templates.filter(t => t.dropboxsign_template_id)}
          members={members}
          sendEnvelope={sendEnvelope}
        />
      )}
    </div>
  );
}
