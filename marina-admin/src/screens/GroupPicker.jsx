import { useState, useEffect } from 'react';
import api, { logout } from '../api.js';

export default function GroupPicker({ onSelect }) {
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get('enterprise/me/')
      .then(r => {
        const gs = r.data.groups;
        setGroups(gs);
        if (gs.length === 1) {
          localStorage.setItem('ma_group', JSON.stringify(gs[0]));
          onSelect(gs[0]);
        }
      })
      .catch(() => setError('Could not load groups. Check that your account has enterprise access.'))
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(g) {
    localStorage.setItem('ma_group', JSON.stringify(g));
    onSelect(g);
  }

  if (loading) return (
    <div className="login-shell">
      <div className="login-card" style={{ textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
    </div>
  );

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-brand">DocksBase Enterprise</span>
        </div>
        {error ? (
          <>
            <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>{error}</p>
            <button className="abtn abtn-primary" style={{ width: '100%' }} onClick={() => { logout(); window.location.reload(); }}>
              Sign out
            </button>
          </>
        ) : groups.length === 0 ? (
          <>
            <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              Your account has no enterprise groups.
            </p>
            <button className="abtn abtn-primary" style={{ width: '100%' }} onClick={() => { logout(); window.location.reload(); }}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <h2 className="login-title" style={{ fontSize: 16 }}>Select a group</h2>
            {groups.map(g => (
              <button key={g.id} className="btn btn-ghost" onClick={() => handleSelect(g)}
                style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8, padding: '10px 14px' }}>
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span style={{ fontSize: 11, opacity: 0.5 }}>{g.marina_count} marina{g.marina_count !== 1 ? 's' : ''}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
