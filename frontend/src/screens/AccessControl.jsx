import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function Badge({ color = 'secondary', children }) {
  return (
    <span className={`badge badge-${color}`} style={{ fontSize: 11 }}>
      {children}
    </span>
  );
}

function EmptyState({ icon = '—', message }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      {message}
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      Loading…
    </div>
  );
}

function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="card" style={{ width: 420, margin: 0 }}>
        <div className="card-header">
          <div className="card-header-title">{title}</div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>{message}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
            <button className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function heartbeatColor(lastHeartbeat) {
  if (!lastHeartbeat) return '#dc3545';
  const diffMin = (Date.now() - new Date(lastHeartbeat).getTime()) / 60000;
  if (diffMin < 5) return '#2fb344';
  if (diffMin < 30) return '#f59f00';
  return '#dc3545';
}

// ── Tab 1: Access Zones ────────────────────────────────────────────────────

function ZonesTab() {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', is_restricted: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/access-control/zones/')
      .then(r => setZones(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditing(null);
    setForm({ name: '', description: '', is_restricted: false });
    setError('');
    setShowForm(true);
  }

  function openEdit(zone) {
    setEditing(zone);
    setForm({ name: zone.name, description: zone.description || '', is_restricted: zone.is_restricted });
    setError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.patch(`/access-control/zones/${editing.id}/`, form);
      } else {
        await api.post('/access-control/zones/', form);
      }
      setShowForm(false);
      load();
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to save zone.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Access Zones</div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Zone</button>
        </div>
        {loading ? <LoadingState /> : zones.length === 0 ? (
          <EmptyState icon="🔒" message="No access zones configured. Add zones to define areas of the marina." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Zone Name</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {zones.map(zone => (
                  <tr key={zone.id}>
                    <td style={{ fontWeight: 600 }}>{zone.name}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{zone.description || '—'}</td>
                    <td>
                      {zone.is_restricted
                        ? <Badge color="danger">Staff Only</Badge>
                        : <Badge color="secondary">General</Badge>}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(zone)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ width: 440, margin: 0 }}>
            <div className="card-header">
              <div className="card-header-title">{editing ? 'Edit Zone' : 'Add Zone'}</div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Zone Name *</label>
                <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Pier A, Shower Block" />
              </div>
              <div>
                <label className="form-label">Description</label>
                <input className="form-control" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" id="is_restricted" checked={form.is_restricted} onChange={e => setForm(f => ({ ...f, is_restricted: e.target.checked }))} />
                <label htmlFor="is_restricted" style={{ fontSize: 13, cursor: 'pointer' }}>Restricted area (staff only)</label>
              </div>
              {error && <div style={{ fontSize: 12, color: '#dc3545' }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Zone'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Cards & Readers ─────────────────────────────────────────────────

function CardsTab() {
  const [subTab, setSubTab] = useState('cards');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(0,0,0,0.1)', paddingBottom: 0 }}>
        {[['cards', 'Cards'], ['readers', 'Readers']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              padding: '6px 16px', fontSize: 13, fontWeight: subTab === id ? 600 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: subTab === id ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              color: subTab === id ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.5)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {subTab === 'cards' ? <CardsSubTab /> : <ReadersSubTab />}
    </div>
  );
}

function CardsSubTab() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ member: '', card_uid: '', label: '', sub_type: 'owner', valid_from: '', valid_to: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deactivateModal, setDeactivateModal] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/access-control/cards/')
      .then(r => setCards(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = cards.filter(c => {
    const q = search.toLowerCase();
    return !q || (c.member_name || '').toLowerCase().includes(q) || (c.card_uid || '').toLowerCase().includes(q);
  });

  async function issueCard() {
    if (!form.member || !form.card_uid) { setFormError('Member ID and Card UID are required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await api.post('/access-control/cards/', form);
      setShowForm(false);
      setForm({ member: '', card_uid: '', label: '', sub_type: 'owner', valid_from: '', valid_to: '' });
      load();
    } catch (e) {
      setFormError(e.response?.data?.detail || JSON.stringify(e.response?.data) || 'Failed to issue card.');
    } finally {
      setSaving(false);
    }
  }

  async function activateCard(card) {
    setActionLoading(card.id);
    try {
      await api.post(`/access-control/cards/${card.id}/activate/`);
      load();
    } finally {
      setActionLoading(null);
    }
  }

  async function deactivateCard() {
    if (!deactivateReason.trim()) return;
    setActionLoading(deactivateModal.id);
    try {
      await api.post(`/access-control/cards/${deactivateModal.id}/deactivate/`, { reason: deactivateReason });
      setDeactivateModal(null);
      setDeactivateReason('');
      load();
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Access Cards</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="form-control"
              style={{ width: 220, fontSize: 13, padding: '5px 10px' }}
              placeholder="Search by member or UID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Issue Card</button>
          </div>
        </div>
        {loading ? <LoadingState /> : filtered.length === 0 ? (
          <EmptyState icon="💳" message={search ? 'No cards match your search.' : 'No access cards issued yet.'} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Card UID</th>
                  <th>Label</th>
                  <th>Sub-type</th>
                  <th>Valid From</th>
                  <th>Valid To</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(card => (
                  <tr key={card.id}>
                    <td style={{ fontWeight: 500 }}>{card.member_name || `Member #${card.member}`}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{card.card_uid}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{card.label || '—'}</td>
                    <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{card.sub_type}</td>
                    <td style={{ fontSize: 12 }}>{formatDate(card.valid_from)}</td>
                    <td style={{ fontSize: 12 }}>{formatDate(card.valid_to)}</td>
                    <td>
                      {card.is_active
                        ? <Badge color="success">Active</Badge>
                        : <Badge color="secondary">Inactive</Badge>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {card.is_active ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11, color: '#dc3545' }}
                            onClick={() => { setDeactivateModal(card); setDeactivateReason(''); }}
                            disabled={actionLoading === card.id}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11, color: '#2fb344' }}
                            onClick={() => activateCard(card)}
                            disabled={actionLoading === card.id}
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ width: 480, margin: 0 }}>
            <div className="card-header">
              <div className="card-header-title">Issue Access Card</div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: '8px 12px' }}>
                To scan a card: click the Card UID field, then tap the card on a USB RFID reader. The UID will be typed in automatically.
              </div>
              <div>
                <label className="form-label">Member ID *</label>
                <input className="form-control" value={form.member} onChange={e => setForm(f => ({ ...f, member: e.target.value }))} placeholder="Member ID number" type="number" />
              </div>
              <div>
                <label className="form-label">Card UID * <span style={{ fontWeight: 400, fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>(tap card on USB reader to auto-fill)</span></label>
                <input
                  className="form-control"
                  value={form.card_uid}
                  onChange={e => setForm(f => ({ ...f, card_uid: e.target.value }))}
                  placeholder="e.g. A1B2C3D4"
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
              <div>
                <label className="form-label">Label</label>
                <input className="form-control" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Owner Card, Crew — Jane" />
              </div>
              <div>
                <label className="form-label">Sub-type</label>
                <select className="form-control" value={form.sub_type} onChange={e => setForm(f => ({ ...f, sub_type: e.target.value }))}>
                  <option value="owner">Owner</option>
                  <option value="crew">Crew</option>
                  <option value="family">Family</option>
                  <option value="contractor">Contractor</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="form-label">Valid From</label>
                  <input className="form-control" type="date" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Valid To</label>
                  <input className="form-control" type="date" value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} />
                </div>
              </div>
              {formError && <div style={{ fontSize: 12, color: '#dc3545' }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={issueCard} disabled={saving}>
                  {saving ? 'Issuing…' : 'Issue Card'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deactivateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ width: 440, margin: 0 }}>
            <div className="card-header">
              <div className="card-header-title">Deactivate Card</div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>
                Deactivating card <strong style={{ fontFamily: 'monospace' }}>{deactivateModal.card_uid}</strong> for <strong>{deactivateModal.member_name || `Member #${deactivateModal.member}`}</strong>.
              </div>
              <div>
                <label className="form-label">Reason *</label>
                <input
                  className="form-control"
                  value={deactivateReason}
                  onChange={e => setDeactivateReason(e.target.value)}
                  placeholder="e.g. Card returned, Lost card, Contract ended"
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setDeactivateModal(null)}>Cancel</button>
                <button
                  className="btn btn-sm"
                  style={{ background: '#dc3545', color: '#fff' }}
                  onClick={deactivateCard}
                  disabled={!deactivateReason.trim() || actionLoading !== null}
                >
                  Deactivate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadersSubTab() {
  const [readers, setReaders] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ location_label: '', zone: '', hardware_type: 'rfid', ip_address: '', reader_uid: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/access-control/readers/').then(r => r.data.results ?? r.data),
      api.get('/access-control/zones/').then(r => r.data.results ?? r.data),
    ]).then(([r, z]) => { setReaders(r); setZones(z); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditing(null);
    setForm({ location_label: '', zone: '', hardware_type: 'rfid', ip_address: '', reader_uid: '', notes: '' });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(reader) {
    setEditing(reader);
    setForm({
      location_label: reader.location_label,
      zone: reader.zone,
      hardware_type: reader.hardware_type,
      ip_address: reader.ip_address || '',
      reader_uid: reader.reader_uid,
      notes: reader.notes || '',
    });
    setFormError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.location_label || !form.zone || !form.reader_uid) { setFormError('Location, zone and reader UID are required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.patch(`/access-control/readers/${editing.id}/`, form);
      } else {
        await api.post('/access-control/readers/', form);
      }
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.response?.data?.detail || 'Failed to save reader.');
    } finally {
      setSaving(false);
    }
  }

  async function syncReader(reader) {
    setSyncing(reader.id);
    try {
      await api.post(`/access-control/readers/${reader.id}/sync/`);
    } finally {
      setSyncing(null);
    }
  }

  const hwLabel = { rfid: 'RFID/NFC', anpr: 'ANPR Camera', biometric: 'Biometric', keypad: 'PIN Keypad' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Access Readers</div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Reader</button>
        </div>
        {loading ? <LoadingState /> : readers.length === 0 ? (
          <EmptyState icon="📡" message="No readers configured. Add readers to monitor access points." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Zone</th>
                  <th>Type</th>
                  <th>IP Address</th>
                  <th>Last Heartbeat</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {readers.map(reader => {
                  const hbColor = heartbeatColor(reader.last_heartbeat);
                  return (
                    <tr key={reader.id}>
                      <td style={{ fontWeight: 500 }}>{reader.location_label}</td>
                      <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{reader.zone_name || `Zone #${reader.zone}`}</td>
                      <td style={{ fontSize: 12 }}>{hwLabel[reader.hardware_type] || reader.hardware_type}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{reader.ip_address || '—'}</td>
                      <td style={{ fontSize: 12 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: hbColor, display: 'inline-block' }} />
                          {formatDateTime(reader.last_heartbeat)}
                        </span>
                      </td>
                      <td>
                        {reader.is_active
                          ? <Badge color="success">Active</Badge>
                          : <Badge color="secondary">Inactive</Badge>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(reader)}>Edit</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => syncReader(reader)} disabled={syncing === reader.id}>
                            {syncing === reader.id ? 'Syncing…' : 'Sync'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ width: 460, margin: 0 }}>
            <div className="card-header">
              <div className="card-header-title">{editing ? 'Edit Reader' : 'Add Reader'}</div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Location Label *</label>
                <input className="form-control" value={form.location_label} onChange={e => setForm(f => ({ ...f, location_label: e.target.value }))} placeholder="e.g. Main Gate — Entry" />
              </div>
              <div>
                <label className="form-label">Zone *</label>
                <select className="form-control" value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}>
                  <option value="">Select zone…</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Hardware Type</label>
                <select className="form-control" value={form.hardware_type} onChange={e => setForm(f => ({ ...f, hardware_type: e.target.value }))}>
                  <option value="rfid">RFID/NFC Reader</option>
                  <option value="anpr">ANPR Camera</option>
                  <option value="biometric">Biometric Terminal</option>
                  <option value="keypad">PIN Keypad</option>
                </select>
              </div>
              <div>
                <label className="form-label">Reader UID *</label>
                <input className="form-control" value={form.reader_uid} onChange={e => setForm(f => ({ ...f, reader_uid: e.target.value }))} placeholder="Vendor-assigned hardware UID" style={{ fontFamily: 'monospace' }} />
              </div>
              <div>
                <label className="form-label">IP Address</label>
                <input className="form-control" value={form.ip_address} onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))} placeholder="192.168.1.100" />
              </div>
              <div>
                <label className="form-label">Notes</label>
                <textarea className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional installation notes" />
              </div>
              {formError && <div style={{ fontSize: 12, color: '#dc3545' }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Reader'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Access Log ──────────────────────────────────────────────────────

function AccessLogTab() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ granted: '', credential_type: '', from: '', to: '' });
  const [copied, setCopied] = useState(null);

  function buildQuery() {
    const p = new URLSearchParams();
    if (filters.granted !== '') p.set('granted', filters.granted);
    if (filters.credential_type) p.set('credential_type', filters.credential_type);
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    return p.toString() ? `?${p.toString()}` : '';
  }

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/access-control/events/${buildQuery()}`)
      .then(r => setEvents(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  function credBadgeColor(type) {
    return { card: 'navy', face: 'purple', anpr: 'teal', pin: 'secondary' }[type] || 'secondary';
  }

  function copyTimestampCamera(event, camera) {
    const text = `Timestamp: ${event.occurred_at} | Camera: ${camera.camera_uid} | Location: ${camera.location_label}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(`${event.id}-${camera.camera_uid}`);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div className="card">
        <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>Result</label>
            <select className="form-control" style={{ fontSize: 12, padding: '5px 8px' }} value={filters.granted} onChange={e => setFilters(f => ({ ...f, granted: e.target.value }))}>
              <option value="">All</option>
              <option value="true">Granted</option>
              <option value="false">Denied</option>
            </select>
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>Credential</label>
            <select className="form-control" style={{ fontSize: 12, padding: '5px 8px' }} value={filters.credential_type} onChange={e => setFilters(f => ({ ...f, credential_type: e.target.value }))}>
              <option value="">All Types</option>
              <option value="card">RFID Card</option>
              <option value="face">Biometric Face</option>
              <option value="anpr">ANPR Plate</option>
              <option value="pin">PIN Code</option>
            </select>
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>From</label>
            <input className="form-control" type="date" style={{ fontSize: 12, padding: '5px 8px' }} value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>To</label>
            <input className="form-control" type="date" style={{ fontSize: 12, padding: '5px 8px' }} value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ granted: '', credential_type: '', from: '', to: '' })}>
            Clear
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Access Event Log</div>
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ fontSize: 12 }}>Refresh</button>
        </div>
        {loading ? <LoadingState /> : events.length === 0 ? (
          <EmptyState icon="📋" message="No access events match your filters." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Reader / Zone</th>
                  <th>Member</th>
                  <th>Credential</th>
                  <th>Result</th>
                  <th>Denial Reason</th>
                  <th>CCTV</th>
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTime(ev.occurred_at)}</td>
                    <td style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 500 }}>{ev.reader_label || `Reader #${ev.reader}`}</div>
                      {ev.zone_name && <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>{ev.zone_name}</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{ev.member_name || <span style={{ color: 'rgba(0,0,0,0.35)' }}>Unknown</span>}</td>
                    <td><Badge color={credBadgeColor(ev.credential_type)}>{ev.credential_type?.toUpperCase()}</Badge></td>
                    <td>
                      {ev.granted
                        ? <Badge color="success">Granted</Badge>
                        : <Badge color="danger">Denied</Badge>}
                    </td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{ev.denial_reason || '—'}</td>
                    <td>
                      {ev.cctv_cameras && ev.cctv_cameras.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {ev.cctv_cameras.map(cam => (
                            <div key={cam.camera_uid} style={{ display: 'flex', gap: 4 }}>
                              {cam.viewer_url && (
                                <a href={cam.viewer_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}>
                                  View Footage
                                </a>
                              )}
                              <button
                                className="btn btn-ghost btn-sm"
                                style={{ fontSize: 11, padding: '2px 8px' }}
                                onClick={() => copyTimestampCamera(ev, cam)}
                              >
                                {copied === `${ev.id}-${cam.camera_uid}` ? 'Copied!' : 'Copy Timestamp & Camera'}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 4: ANPR ────────────────────────────────────────────────────────────

function ANPRTab() {
  const [anprSub, setAnprSub] = useState('events');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
        {[['events', 'ANPR Events'], ['cameras', 'Cameras'], ['vehicles', 'Vehicles']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAnprSub(id)}
            style={{
              padding: '6px 16px', fontSize: 13, fontWeight: anprSub === id ? 600 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: anprSub === id ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              color: anprSub === id ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.5)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {anprSub === 'events' && <ANPREventsSubTab />}
      {anprSub === 'cameras' && <ANPRCamerasSubTab />}
      {anprSub === 'vehicles' && <VehiclesSubTab />}
    </div>
  );
}

function ANPREventsSubTab() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ access_granted: '', unrecognised: false, from: '', to: '' });
  const [reviewing, setReviewing] = useState(null);

  function buildQuery() {
    const p = new URLSearchParams();
    if (filters.access_granted !== '') p.set('access_granted', filters.access_granted);
    if (filters.unrecognised) p.set('unrecognised', 'true');
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    return p.toString() ? `?${p.toString()}` : '';
  }

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/access-control/anpr-events/${buildQuery()}`)
      .then(r => setEvents(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  async function markReviewed(ev) {
    setReviewing(ev.id);
    try {
      await api.patch(`/access-control/anpr-events/${ev.id}/`, { staff_reviewed: true });
      load();
    } finally {
      setReviewing(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>Access</label>
            <select className="form-control" style={{ fontSize: 12, padding: '5px 8px' }} value={filters.access_granted} onChange={e => setFilters(f => ({ ...f, access_granted: e.target.value }))}>
              <option value="">All</option>
              <option value="true">Granted</option>
              <option value="false">Denied</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input type="checkbox" id="unrecognised" checked={filters.unrecognised} onChange={e => setFilters(f => ({ ...f, unrecognised: e.target.checked }))} />
            <label htmlFor="unrecognised" style={{ fontSize: 13, cursor: 'pointer' }}>Unrecognised only</label>
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>From</label>
            <input className="form-control" type="date" style={{ fontSize: 12, padding: '5px 8px' }} value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>To</label>
            <input className="form-control" type="date" style={{ fontSize: 12, padding: '5px 8px' }} value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ access_granted: '', unrecognised: false, from: '', to: '' })}>Clear</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-header-title">ANPR Events</div>
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ fontSize: 12 }}>Refresh</button>
        </div>
        {loading ? <LoadingState /> : events.length === 0 ? (
          <EmptyState icon="🚗" message="No ANPR events match your filters." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Plate</th>
                  <th>Camera</th>
                  <th>Member</th>
                  <th>Confidence</th>
                  <th>Access</th>
                  <th>Reviewed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.map(ev => (
                  <tr key={ev.id}>
                    <td style={{ fontSize: 12 }}>{formatDateTime(ev.occurred_at)}</td>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{ev.plate_detected}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{ev.camera_label || `Camera #${ev.camera}`}</td>
                    <td style={{ fontSize: 12 }}>{ev.matched_member_name || <span style={{ color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>Unrecognised</span>}</td>
                    <td style={{ fontSize: 12 }}>{ev.confidence ? `${Math.round(ev.confidence * 100)}%` : '—'}</td>
                    <td>
                      {ev.access_granted
                        ? <Badge color="success">Granted</Badge>
                        : <Badge color="danger">Denied</Badge>}
                    </td>
                    <td>
                      {ev.staff_reviewed
                        ? <Badge color="secondary">Reviewed</Badge>
                        : <Badge color="warning">Pending</Badge>}
                    </td>
                    <td>
                      {!ev.staff_reviewed && (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => markReviewed(ev)} disabled={reviewing === ev.id}>
                          {reviewing === ev.id ? 'Marking…' : 'Mark Reviewed'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ANPRCamerasSubTab() {
  const [cameras, setCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ camera_uid: '', location_label: '', zone: '', ip_address: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/access-control/anpr-cameras/').then(r => r.data.results ?? r.data),
      api.get('/access-control/zones/').then(r => r.data.results ?? r.data),
    ]).then(([c, z]) => { setCameras(c); setZones(z); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(cam) {
    setEditing(cam);
    setForm({ camera_uid: cam.camera_uid, location_label: cam.location_label, zone: cam.zone, ip_address: cam.ip_address || '' });
    setFormError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.camera_uid || !form.location_label || !form.zone) { setFormError('All fields are required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.patch(`/access-control/anpr-cameras/${editing.id}/`, form);
      } else {
        await api.post('/access-control/anpr-cameras/', form);
      }
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.response?.data?.detail || 'Failed to save camera.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">ANPR Cameras</div>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setForm({ camera_uid: '', location_label: '', zone: '', ip_address: '' }); setFormError(''); setShowForm(true); }}>+ Add Camera</button>
        </div>
        {loading ? <LoadingState /> : cameras.length === 0 ? (
          <EmptyState icon="📷" message="No ANPR cameras configured." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Camera UID</th><th>Location</th><th>Zone</th><th>IP</th><th>Last Frame</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {cameras.map(cam => (
                  <tr key={cam.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{cam.camera_uid}</td>
                    <td style={{ fontWeight: 500 }}>{cam.location_label}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{cam.zone_name || `Zone #${cam.zone}`}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{cam.ip_address || '—'}</td>
                    <td style={{ fontSize: 12 }}>{formatDateTime(cam.last_frame_at)}</td>
                    <td>{cam.is_active ? <Badge color="success">Active</Badge> : <Badge color="secondary">Inactive</Badge>}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => openEdit(cam)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 440, margin: 0 }}>
            <div className="card-header"><div className="card-header-title">{editing ? 'Edit ANPR Camera' : 'Add ANPR Camera'}</div></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label className="form-label">Camera UID *</label><input className="form-control" value={form.camera_uid} onChange={e => setForm(f => ({ ...f, camera_uid: e.target.value }))} style={{ fontFamily: 'monospace' }} /></div>
              <div><label className="form-label">Location Label *</label><input className="form-control" value={form.location_label} onChange={e => setForm(f => ({ ...f, location_label: e.target.value }))} placeholder="e.g. Car Park Entry" /></div>
              <div>
                <label className="form-label">Zone *</label>
                <select className="form-control" value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}>
                  <option value="">Select zone…</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">IP Address</label><input className="form-control" value={form.ip_address} onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))} /></div>
              {formError && <div style={{ fontSize: 12, color: '#dc3545' }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VehiclesSubTab() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/access-control/vehicles/')
      .then(r => setVehicles(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Registered Vehicles</div>
      </div>
      {loading ? <LoadingState /> : vehicles.length === 0 ? (
        <EmptyState icon="🚘" message="No vehicle registrations. Members can register plates via the portal." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Plate</th><th>Member</th><th>Make / Model</th><th>Colour</th><th>Registered</th><th>Status</th></tr></thead>
            <tbody>
              {vehicles.map(v => (
                <tr key={v.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.plate_number}</td>
                  <td style={{ fontSize: 12 }}>{v.member_name || `Member #${v.member}`}</td>
                  <td style={{ fontSize: 12 }}>{[v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
                  <td style={{ fontSize: 12 }}>{v.colour || '—'}</td>
                  <td style={{ fontSize: 12 }}>{formatDateTime(v.registered_at)}</td>
                  <td>{v.is_active ? <Badge color="success">Active</Badge> : <Badge color="secondary">Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 5: CCTV ────────────────────────────────────────────────────────────

function CCTVTab() {
  const [cameras, setCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ camera_uid: '', location_label: '', zone: '', nvr_ip: '', nvr_channel: '', viewer_url_template: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/access-control/cctv-cameras/').then(r => r.data.results ?? r.data),
      api.get('/access-control/zones/').then(r => r.data.results ?? r.data),
    ]).then(([c, z]) => { setCameras(c); setZones(z); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditing(null);
    setForm({ camera_uid: '', location_label: '', zone: '', nvr_ip: '', nvr_channel: '', viewer_url_template: '' });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(cam) {
    setEditing(cam);
    setForm({
      camera_uid: cam.camera_uid,
      location_label: cam.location_label,
      zone: cam.zone,
      nvr_ip: cam.nvr_ip || '',
      nvr_channel: cam.nvr_channel ?? '',
      viewer_url_template: cam.viewer_url_template || '',
    });
    setFormError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.camera_uid || !form.location_label || !form.zone) { setFormError('Camera UID, location and zone are required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const payload = { ...form, nvr_channel: form.nvr_channel !== '' ? Number(form.nvr_channel) : null };
      if (editing) {
        await api.patch(`/access-control/cctv-cameras/${editing.id}/`, payload);
      } else {
        await api.post('/access-control/cctv-cameras/', payload);
      }
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.response?.data?.detail || 'Failed to save camera.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">CCTV Camera Registry</div>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Camera</button>
        </div>
        <div style={{ padding: '10px 16px', background: 'rgba(0,0,0,0.03)', fontSize: 12, color: 'rgba(0,0,0,0.5)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          DocksBase stores no video footage — only camera metadata for timestamp-based NVR navigation. Configure a viewer URL template to enable one-click NVR deep-links from the access event log.
        </div>
        {loading ? <LoadingState /> : cameras.length === 0 ? (
          <EmptyState icon="📹" message="No CCTV cameras registered." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Camera UID</th><th>Location</th><th>Zone</th><th>NVR IP</th><th>Channel</th><th>Deep-link</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {cameras.map(cam => (
                  <tr key={cam.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{cam.camera_uid}</td>
                    <td style={{ fontWeight: 500 }}>{cam.location_label}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{cam.zone_name || `Zone #${cam.zone}`}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{cam.nvr_ip || '—'}</td>
                    <td style={{ fontSize: 12 }}>{cam.nvr_channel ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {cam.viewer_url_template
                        ? <Badge color="success">Configured</Badge>
                        : <span style={{ color: 'rgba(0,0,0,0.35)' }}>Clipboard only</span>}
                    </td>
                    <td>{cam.is_active ? <Badge color="success">Active</Badge> : <Badge color="secondary">Inactive</Badge>}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => openEdit(cam)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 500, margin: 0 }}>
            <div className="card-header"><div className="card-header-title">{editing ? 'Edit CCTV Camera' : 'Add CCTV Camera'}</div></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div><label className="form-label">Camera UID *</label><input className="form-control" value={form.camera_uid} onChange={e => setForm(f => ({ ...f, camera_uid: e.target.value }))} placeholder="NVR channel ID or RTSP stream ID" style={{ fontFamily: 'monospace' }} /></div>
              <div><label className="form-label">Location Label *</label><input className="form-control" value={form.location_label} onChange={e => setForm(f => ({ ...f, location_label: e.target.value }))} placeholder="e.g. Pier A Gate — Facing East" /></div>
              <div>
                <label className="form-label">Zone *</label>
                <select className="form-control" value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}>
                  <option value="">Select zone…</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                <div><label className="form-label">NVR IP</label><input className="form-control" value={form.nvr_ip} onChange={e => setForm(f => ({ ...f, nvr_ip: e.target.value }))} placeholder="192.168.1.200" /></div>
                <div style={{ width: 80 }}><label className="form-label">Channel</label><input className="form-control" type="number" value={form.nvr_channel} onChange={e => setForm(f => ({ ...f, nvr_channel: e.target.value }))} /></div>
              </div>
              <div>
                <label className="form-label">
                  Viewer URL Template
                  <span style={{ fontWeight: 400, fontSize: 11, color: 'rgba(0,0,0,0.4)', marginLeft: 6 }}>
                    Use {'{'}{'{'}timestamp_iso{'}'}{'}'}  and {'{'}{'{'}camera_uid{'}'}{'}'}  as placeholders. Leave blank for clipboard-only mode.
                  </span>
                </label>
                <input className="form-control" value={form.viewer_url_template} onChange={e => setForm(f => ({ ...f, viewer_url_template: e.target.value }))} placeholder="http://nvr.local/view?cam={camera_uid}&t={timestamp_iso}" style={{ fontFamily: 'monospace', fontSize: 12 }} />
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 4 }}>
                  Leave blank if your NVR requires a desktop client (clipboard copy will still be available on the access event log).
                </div>
              </div>
              {formError && <div style={{ fontSize: 12, color: '#dc3545' }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Camera'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 6: Spend Auth ──────────────────────────────────────────────────────

function SpendAuthTab() {
  const [spendSub, setSpendSub] = useState('rules');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
        {[['rules', 'Spend Rules'], ['requests', 'Pending Approvals']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSpendSub(id)}
            style={{
              padding: '6px 16px', fontSize: 13, fontWeight: spendSub === id ? 600 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: spendSub === id ? '2px solid var(--navy, #1a2d4a)' : '2px solid transparent',
              color: spendSub === id ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.5)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {spendSub === 'rules' && <SpendRulesSubTab />}
      {spendSub === 'requests' && <SpendRequestsSubTab />}
    </div>
  );
}

const ACTION_TYPES = ['discount', 'write_off', 'refund', 'override'];
const ACTION_LABELS = { discount: 'Discount', write_off: 'Write-off', refund: 'Refund', override: 'Price Override' };
const ROLES = ['staff', 'manager'];
const ROLE_LABELS = { staff: 'Staff', manager: 'Manager' };

function SpendRulesSubTab() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form, setForm] = useState({ role: 'staff', action_type: 'discount', threshold_amount: '', requires_approver_role: 'manager' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/access-control/spend-rules/')
      .then(r => setRules(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function getRuleFor(role, action) {
    return rules.find(r => r.role === role && r.action_type === action);
  }

  function openCell(role, action) {
    const existing = getRuleFor(role, action);
    setEditingRule(existing || null);
    setForm({
      role,
      action_type: action,
      threshold_amount: existing ? existing.threshold_amount : '',
      requires_approver_role: existing ? existing.requires_approver_role : 'manager',
    });
    setFormError('');
    setShowForm(true);
  }

  async function save() {
    if (!form.threshold_amount) { setFormError('Threshold amount is required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      if (editingRule) {
        await api.patch(`/access-control/spend-rules/${editingRule.id}/`, form);
      } else {
        await api.post('/access-control/spend-rules/', form);
      }
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.response?.data?.detail || 'Failed to save rule.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Spend Authorisation Rules</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Click a cell to set or edit a rule</div>
        </div>
        {loading ? <LoadingState /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Role</th>
                  {ACTION_TYPES.map(a => <th key={a}>{ACTION_LABELS[a]}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROLES.map(role => (
                  <tr key={role}>
                    <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{ROLE_LABELS[role]}</td>
                    {ACTION_TYPES.map(action => {
                      const rule = getRuleFor(role, action);
                      return (
                        <td
                          key={action}
                          onClick={() => openCell(role, action)}
                          style={{ cursor: 'pointer', fontSize: 12 }}
                          title="Click to configure"
                        >
                          {rule ? (
                            <div>
                              <div style={{ fontWeight: 600 }}>€{Number(rule.threshold_amount).toFixed(2)}</div>
                              <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>Needs {rule.requires_approver_role}</div>
                            </div>
                          ) : (
                            <span style={{ color: 'rgba(0,0,0,0.25)' }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 420, margin: 0 }}>
            <div className="card-header">
              <div className="card-header-title">
                {editingRule ? 'Edit' : 'Set'} Rule — {ROLE_LABELS[form.role]} / {ACTION_LABELS[form.action_type]}
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label className="form-label">Threshold Amount (€) *</label>
                <input className="form-control" type="number" step="0.01" min="0" value={form.threshold_amount} onChange={e => setForm(f => ({ ...f, threshold_amount: e.target.value }))} placeholder="e.g. 100.00" />
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>
                  Any {ACTION_LABELS[form.action_type].toLowerCase()} above this amount by {ROLE_LABELS[form.role]} requires approval.
                </div>
              </div>
              <div>
                <label className="form-label">Requires Approval From</label>
                <select className="form-control" value={form.requires_approver_role} onChange={e => setForm(f => ({ ...f, requires_approver_role: e.target.value }))}>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              {formError && <div style={{ fontSize: 12, color: '#dc3545' }}>{formError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Rule'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const REQUEST_STATUS_COLORS = {
  pending: 'warning',
  suspended: 'secondary',
  overridden: 'danger',
  approved: 'success',
  denied: 'danger',
  expired: 'secondary',
};

function SpendRequestsSubTab() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [noteModal, setNoteModal] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/access-control/spend-requests/')
      .then(r => setRequests(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  async function doAction(req, action) {
    if ((action === 'approve' || action === 'deny') && !note.trim()) return;
    setActionLoading(`${req.id}-${action}`);
    try {
      await api.post(`/access-control/spend-requests/${req.id}/${action}/`, note ? { note } : {});
      setNoteModal(null);
      setNote('');
      load();
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Pending Approvals</div>
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ fontSize: 12 }}>Refresh</button>
        </div>
        {loading ? <LoadingState /> : requests.length === 0 ? (
          <EmptyState icon="✅" message="No spend authorisation requests." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Requested By</th>
                  <th>Action</th>
                  <th>Amount</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req.id}>
                    <td style={{ fontSize: 12 }}>{formatDateTime(req.requested_at)}</td>
                    <td style={{ fontSize: 12 }}>{req.requested_by_name || `Staff #${req.requested_by}`}</td>
                    <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{ACTION_LABELS[req.action_type] || req.action_type}</td>
                    <td style={{ fontWeight: 600 }}>€{Number(req.amount).toFixed(2)}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', maxWidth: 200 }}>{req.description}</td>
                    <td><Badge color={REQUEST_STATUS_COLORS[req.status] || 'secondary'}>{req.status}</Badge></td>
                    <td>
                      {req.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11, color: '#2fb344' }}
                            onClick={() => { setNoteModal({ req, action: 'approve' }); setNote(''); }}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11, color: '#dc3545' }}
                            onClick={() => { setNoteModal({ req, action: 'deny' }); setNote(''); }}
                          >
                            Deny
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {noteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 420, margin: 0 }}>
            <div className="card-header">
              <div className="card-header-title" style={{ textTransform: 'capitalize' }}>{noteModal.action} Request</div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>
                {noteModal.action === 'approve' ? 'Approving' : 'Denying'} €{Number(noteModal.req.amount).toFixed(2)} {ACTION_LABELS[noteModal.req.action_type]?.toLowerCase()} by {noteModal.req.requested_by_name}.
              </div>
              <div>
                <label className="form-label">Note *</label>
                <textarea className="form-control" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Required — provide a reason for your decision" autoFocus />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setNoteModal(null)}>Cancel</button>
                <button
                  className={`btn btn-sm ${noteModal.action === 'approve' ? 'btn-primary' : ''}`}
                  style={noteModal.action === 'deny' ? { background: '#dc3545', color: '#fff' } : {}}
                  onClick={() => doAction(noteModal.req, noteModal.action)}
                  disabled={!note.trim() || actionLoading !== null}
                >
                  {actionLoading ? 'Processing…' : noteModal.action === 'approve' ? 'Approve' : 'Deny'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 7: Fraud Alerts ────────────────────────────────────────────────────

const ALERT_TYPE_LABELS = {
  repeated_discount: 'Repeated Discounts',
  large_write_off: 'Large Write-off',
  unusual_refund: 'Unusual Refund Pattern',
  after_hours_sale: 'After-hours Sale',
  forced_override: 'Force-approved Spend',
  biometric_deletion_stalled: 'Biometric Deletion Stalled',
};

const ALERT_TYPE_COLORS = {
  repeated_discount: 'warning',
  large_write_off: 'danger',
  unusual_refund: 'warning',
  after_hours_sale: 'secondary',
  forced_override: 'danger',
  biometric_deletion_stalled: 'danger',
};

function FraudAlertsTab() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolveModal, setResolveModal] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/access-control/fraud-alerts/')
      .then(r => setAlerts(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolveAlert(alert) {
    if (!resolutionNote.trim()) return;
    setResolving(alert.id);
    try {
      await api.post(`/access-control/fraud-alerts/${alert.id}/resolve/`, { resolution_note: resolutionNote });
      setResolveModal(null);
      setResolutionNote('');
      load();
    } finally {
      setResolving(null);
    }
  }

  const unresolved = alerts.filter(a => !a.resolved_at);
  const resolved = alerts.filter(a => a.resolved_at);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {unresolved.length > 0 && (
        <div style={{ padding: '10px 14px', background: 'rgba(220,53,69,0.08)', borderRadius: 8, border: '1px solid rgba(220,53,69,0.25)', fontSize: 13, color: '#dc3545', fontWeight: 500 }}>
          {unresolved.length} unresolved fraud alert{unresolved.length > 1 ? 's' : ''} require{unresolved.length === 1 ? 's' : ''} manager attention.
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-header-title">Fraud & Anomaly Alerts</div>
          <button className="btn btn-ghost btn-sm" onClick={load} style={{ fontSize: 12 }}>Refresh</button>
        </div>
        {loading ? <LoadingState /> : alerts.length === 0 ? (
          <EmptyState icon="🛡️" message="No fraud alerts. The system is monitoring all transactions." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Alert Type</th>
                  <th>Staff Member</th>
                  <th>Period</th>
                  <th>Events</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(alert => (
                  <tr key={alert.id} style={{ background: !alert.resolved_at ? 'rgba(220,53,69,0.04)' : undefined }}>
                    <td>
                      <Badge color={ALERT_TYPE_COLORS[alert.alert_type] || 'secondary'}>
                        {ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
                      </Badge>
                    </td>
                    <td style={{ fontSize: 12 }}>{alert.staff_member_name || `Staff #${alert.staff_member}`}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)' }}>
                      {formatDateTime(alert.period_start)} – {formatDateTime(alert.period_end)}
                    </td>
                    <td style={{ fontSize: 12 }}>{alert.event_count}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>
                      {alert.total_amount ? `€${Number(alert.total_amount).toFixed(2)}` : '—'}
                    </td>
                    <td>
                      {alert.resolved_at
                        ? <Badge color="success">Resolved</Badge>
                        : <Badge color="danger">Unresolved</Badge>}
                    </td>
                    <td>
                      {!alert.resolved_at && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11 }}
                          onClick={() => { setResolveModal(alert); setResolutionNote(''); }}
                        >
                          Mark Resolved
                        </button>
                      )}
                      {alert.resolved_at && alert.resolution_note && (
                        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', fontStyle: 'italic' }} title={alert.resolution_note}>
                          Note available
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resolveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ width: 460, margin: 0 }}>
            <div className="card-header"><div className="card-header-title">Resolve Alert</div></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>
                Resolving: <strong>{ALERT_TYPE_LABELS[resolveModal.alert_type] || resolveModal.alert_type}</strong> for {resolveModal.staff_member_name}.
              </div>
              <div>
                <label className="form-label">Resolution Note *</label>
                <textarea className="form-control" rows={3} value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} placeholder="Document your investigation finding and outcome" autoFocus />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setResolveModal(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={() => resolveAlert(resolveModal)} disabled={!resolutionNote.trim() || resolving === resolveModal.id}>
                  {resolving === resolveModal.id ? 'Resolving…' : 'Mark Resolved'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'zones', label: 'Access Zones' },
  { id: 'cards', label: 'Cards & Readers' },
  { id: 'log', label: 'Access Log' },
  { id: 'anpr', label: 'ANPR' },
  { id: 'cctv', label: 'CCTV' },
  { id: 'spend', label: 'Spend Auth' },
  { id: 'fraud', label: 'Fraud Alerts' },
];

export default function AccessControl() {
  const [activeTab, setActiveTab] = useState('zones');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Page header */}
      <div className="page-header" style={{ marginBottom: 0, paddingBottom: 0 }}>
        <div className="page-title">Security &amp; Access Control</div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1.5px solid rgba(0,0,0,0.1)',
        marginBottom: 20, overflowX: 'auto',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px', fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 400,
              background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: activeTab === tab.id ? '2.5px solid var(--navy, #1a2d4a)' : '2.5px solid transparent',
              color: activeTab === tab.id ? 'var(--navy, #1a2d4a)' : 'rgba(0,0,0,0.55)',
              transition: 'color 0.1s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'zones' && <ZonesTab />}
      {activeTab === 'cards' && <CardsTab />}
      {activeTab === 'log' && <AccessLogTab />}
      {activeTab === 'anpr' && <ANPRTab />}
      {activeTab === 'cctv' && <CCTVTab />}
      {activeTab === 'spend' && <SpendAuthTab />}
      {activeTab === 'fraud' && <FraudAlertsTab />}
    </div>
  );
}
