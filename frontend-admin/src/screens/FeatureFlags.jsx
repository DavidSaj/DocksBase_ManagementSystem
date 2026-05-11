import { useEffect, useState } from 'react';
import api from '../api.js';

function Toggle({ on, onChange, disabled }) {
  return (
    <div onClick={!disabled ? onChange : undefined} style={{ width: 36, height: 20, borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer', background: on ? '#16a34a' : '#d1d5db', position: 'relative', transition: 'background 0.15s', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  );
}

export default function FeatureFlags() {
  const [flags, setFlags] = useState([]);
  const [toggling, setToggling] = useState(null);

  useEffect(() => {
    api.get('/admin/feature-flags/').then(r => setFlags(r.data));
  }, []);

  async function toggle(flag) {
    setToggling(flag.name);
    try {
      const { data } = await api.patch(`/admin/feature-flags/${flag.name}/`, { enabled: !flag.enabled });
      setFlags(prev => prev.map(f => f.name === flag.name ? data : f));
    } finally {
      setToggling(null);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Feature Flags</h2>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        {flags.length === 0 && <div style={{ padding: 24, color: '#999', fontSize: 13 }}>No feature flags configured.</div>}
        {flags.map((flag, i) => (
          <div key={flag.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: i < flags.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{flag.name}</div>
              {flag.updated_at && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Last updated: {flag.updated_at?.slice(0, 10)}</div>}
            </div>
            <Toggle on={flag.enabled} onChange={() => toggle(flag)} disabled={toggling === flag.name} />
          </div>
        ))}
      </div>
    </div>
  );
}
