import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function GroupDetailPanel({ group, onClose, onUpdate, allMarinas }) {
  const [acting, setActing] = useState(false);
  const [addMarinaId, setAddMarinaId] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [editing, setEditing] = useState({});

  if (!group) return (
    <div className="detail-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'rgba(0,0,0,0.28)', gap: 8 }}>
      <Ic n="layers" s={28} c="rgba(0,0,0,0.15)" />
      <div style={{ fontSize: 12 }}>Select a group to view details</div>
    </div>
  );

  async function handleSave() {
    if (!Object.keys(editing).length) return;
    setActing(true);
    try {
      const { data } = await api.patch(`admin/groups/${group.id}/`, editing);
      onUpdate(data);
      setEditing({});
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleAddMarina() {
    if (!addMarinaId) return;
    setActing(true);
    try {
      const { data } = await api.post(`admin/groups/${group.id}/add_marina/`, { marina_id: parseInt(addMarinaId) });
      onUpdate(data);
      setAddMarinaId('');
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to add marina');
    } finally { setActing(false); }
  }

  async function handleRemoveMarina(marinaId) {
    setActing(true);
    try {
      const { data } = await api.post(`admin/groups/${group.id}/remove_marina/`, { marina_id: marinaId });
      onUpdate(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleSetAdmin() {
    const email = adminEmail.trim().toLowerCase();
    if (!email) return;
    setActing(true);
    try {
      const { data } = await api.post(`admin/groups/${group.id}/set_admin/`, { email });
      setAdminEmail('');
      window.alert(`Admin assigned to ${email}.`);
    } catch (e) {
      // 404 means the user doesn't exist — offer to invite them
      if (e.response?.status === 404) {
        if (window.confirm(`No user with ${email} exists. Send them an invite to become enterprise admin?`)) {
          try {
            const { data } = await api.post(`admin/groups/${group.id}/set_admin/`, { email, invite: true });
            setAdminEmail('');
            window.alert(`Invite sent to ${email}.`);
          } catch (e2) {
            window.alert(e2.response?.data?.detail || 'Failed to invite admin.');
          }
        }
      } else {
        window.alert(e.response?.data?.detail || 'Failed to set admin');
      }
    } finally { setActing(false); }
  }

  const availableMarinas = allMarinas.filter(m => !group.marinas?.some(gm => gm.id === m.id));
  const val = (field) => editing[field] !== undefined ? editing[field] : group[field];
  const set = (field, value) => setEditing(prev => ({ ...prev, [field]: value }));

  return (
    <div className="detail-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div className="detail-panel-title">{group.name}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
          <Ic n="x" s={12} />
        </button>
      </div>

      {[
        ['Name',            'name',                  'text'],
        ['Billing email',   'billing_contact_email', 'email'],
        ['Base currency',   'base_currency',         'text'],
        ['Marina limit',    'max_marinas',            'number'],
      ].map(([label, field, type]) => (
        <div key={field} className="detail-row">
          <span className="detail-key">{label}</span>
          <input
            type={type}
            value={val(field) ?? ''}
            onChange={e => set(field, type === 'number' ? parseInt(e.target.value) : e.target.value)}
            style={{ fontSize: 12, width: 140, padding: '2px 6px' }}
          />
        </div>
      ))}

      {Object.keys(editing).length > 0 && (
        <button type="button" className="btn btn-primary btn-sm" disabled={acting} onClick={handleSave} style={{ marginTop: 8, gap: 6 }}>
          <Ic n="save" s={11} /> Save changes
        </button>
      )}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Marinas ({group.marina_count} / {group.max_marinas})
        </div>
        {group.marinas?.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
            <span>{m.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={acting} onClick={() => handleRemoveMarina(m.id)} style={{ padding: '2px 6px', fontSize: 11 }}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <select value={addMarinaId} onChange={e => setAddMarinaId(e.target.value)} style={{ fontSize: 12, flex: 1 }}>
            <option value="">Add marina…</option>
            {availableMarinas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" disabled={acting || !addMarinaId} onClick={handleAddMarina}>
            Add
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Enterprise Admin
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="email"
            placeholder="user@example.com"
            value={adminEmail}
            onChange={e => setAdminEmail(e.target.value)}
            style={{ fontSize: 12, flex: 1 }}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={acting || !adminEmail.trim()} onClick={handleSetAdmin}>
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [allMarinas, setAllMarinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', slug: '', billing_contact_email: '', max_marinas: 1, base_currency: 'EUR' });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('admin/groups/'),
      api.get('admin/marinas/'),
    ]).then(([g, m]) => {
      setGroups(g.data);
      setAllMarinas(m.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleUpdate(updated) {
    setGroups(prev => prev.map(g => g.id === updated.id ? updated : g));
    setSelected(updated);
  }

  async function handleCreate() {
    if (!newGroup.name?.trim() || !newGroup.slug?.trim()) {
      window.alert('Name and slug are required.');
      return;
    }
    try {
      const payload = {
        ...newGroup,
        slug: newGroup.slug.trim().toLowerCase(),
        max_marinas: parseInt(newGroup.max_marinas) || 1,
      };
      const { data } = await api.post('admin/groups/', payload);
      setGroups(prev => [data, ...prev]);
      setCreating(false);
      setNewGroup({ name: '', slug: '', billing_contact_email: '', max_marinas: 1, base_currency: 'EUR' });
    } catch (e) {
      const d = e.response?.data;
      const msg = typeof d === 'string'
        ? d
        : d?.detail
        || Object.entries(d || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')
        || 'Failed to create group';
      window.alert(msg);
    }
  }

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Groups <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({groups.length})</span></div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(c => !c)}>
          <Ic n="plus" s={12} /> New Group
        </button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {[['Name', 'name', 'text'], ['Slug', 'slug', 'text'], ['Billing email', 'billing_contact_email', 'email'], ['Marina limit', 'max_marinas', 'number'], ['Base currency', 'base_currency', 'text']].map(([label, field, type]) => (
              <label key={field} style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {label}
                <input type={type} value={newGroup[field]} onChange={e => setNewGroup(p => ({ ...p, [field]: type === 'number' ? parseInt(e.target.value) : e.target.value }))} style={{ fontSize: 12 }} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="grid-b" style={{ alignItems: 'start' }}>
        <div>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Marinas</th>
                  <th>Base currency</th>
                  <th>Billing contact</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : groups.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No groups yet.</td></tr>
                ) : groups.map(g => (
                  <tr key={g.id} className={selected?.id === g.id ? 'selected' : ''} onClick={() => setSelected(selected?.id === g.id ? null : g)}>
                    <td><div className="tbl-name">{g.name}</div><div className="tbl-sub">{g.slug}</div></td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.marina_count} / {g.max_marinas}</td>
                    <td>{g.base_currency}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)' }}>{g.billing_contact_email || '—'}</td>
                    <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>{new Date(g.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <GroupDetailPanel
          group={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          allMarinas={allMarinas}
        />
      </div>
    </div>
  );
}
