import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

export default function Staff({ group }) {
  const [staff, setStaff]               = useState([]);
  const [marinas, setMarinas]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(false);
  const [acting, setActing]             = useState(false);
  const [inviteEmail, setInviteEmail]   = useState('');
  const [inviteMarinaId, setInviteMarinaId] = useState('');
  const loadIgnoreRef = useRef(false);

  const load = useCallback(() => {
    loadIgnoreRef.current = false;
    setLoading(true);
    setLoadError(false);
    return Promise.all([
      api.get(`enterprise/groups/${group.id}/staff/`),
      api.get(`enterprise/groups/${group.id}/overview/`),
    ]).then(([s, o]) => {
      if (!loadIgnoreRef.current) {
        setStaff(s.data);
        setMarinas(o.data.marinas);
      }
    }).catch(() => {
      if (!loadIgnoreRef.current) setLoadError(true);
    }).finally(() => {
      if (!loadIgnoreRef.current) setLoading(false);
    });
  }, [group.id]);

  useEffect(() => {
    load();
    return () => { loadIgnoreRef.current = true; };
  }, [load]);

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail || !inviteMarinaId) return;
    setActing(true);
    try {
      await api.post(`enterprise/groups/${group.id}/staff/invite/`, {
        email: inviteEmail,
        marina_id: parseInt(inviteMarinaId),
      });
      setInviteEmail('');
      setInviteMarinaId('');
      await load();
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to invite staff.');
    } finally {
      setActing(false);
    }
  }

  async function handleRemove(userId) {
    if (!window.confirm('Remove this staff member?')) return;
    setActing(true);
    try {
      await api.post(`enterprise/groups/${group.id}/staff/${userId}/remove/`);
      await load();
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to remove staff.');
    } finally {
      setActing(false);
    }
  }

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Staff</div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 18 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Invite staff member</div>
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            Email
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="staff@marina.com"
              required
              style={{ fontSize: 12, minWidth: 200 }}
            />
          </label>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            Marina
            <select
              value={inviteMarinaId}
              onChange={e => setInviteMarinaId(e.target.value)}
              required
              style={{ fontSize: 12 }}
            >
              <option value="">Select marina…</option>
              {marinas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={acting} style={{ gap: 6 }}>
            <Ic n="plus" s={12} /> Invite
          </button>
        </form>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name / Email</th>
              <th>Marina</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loadError ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--red)', padding: '20px 0', fontSize: 12 }}>Failed to load staff.</td></tr>
            ) : loading ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
            ) : staff.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No staff yet.</td></tr>
            ) : staff.map(s => (
              <tr key={s.id}>
                <td>
                  <div className="tbl-name">{s.name}</div>
                  <div className="tbl-sub">{s.email}</div>
                </td>
                <td style={{ fontSize: 12 }}>{s.marina_name}</td>
                <td><span className="badge badge-gray">{s.role}</span></td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={acting}
                    onClick={() => handleRemove(s.id)}
                    style={{ color: 'var(--red)', borderColor: 'rgba(192,57,43,0.2)' }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
