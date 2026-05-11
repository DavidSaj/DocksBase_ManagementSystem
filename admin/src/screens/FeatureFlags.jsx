import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

export default function FeatureFlags() {
  const [flags, setFlags]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(null); // flag name being saved

  useEffect(() => {
    api.get('admin/feature-flags/')
      .then(r => setFlags(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(flag) {
    setSaving(flag.name);
    try {
      const { data } = await api.patch(`admin/feature-flags/${flag.name}/`, { enabled: !flag.enabled });
      setFlags(prev => prev.map(f => f.name === data.name ? data : f));
    } catch { /* ignore */ } finally { setSaving(null); }
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Feature Flags <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({flags.length})</span></div>
        <div className="sec-hdr-sub">Master on/off switches applied platform-wide.</div>
      </div>

      <div className="card">
        {flags.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>No feature flags defined.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Flag name</th>
                <th>Status</th>
                <th>Last updated</th>
                <th style={{ textAlign: 'right' }}>Toggle</th>
              </tr>
            </thead>
            <tbody>
              {flags.map(f => (
                <tr key={f.name}>
                  <td>
                    <div className="tbl-name" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{f.name}</div>
                  </td>
                  <td>
                    <span className={`badge ${f.enabled ? 'badge-green' : 'badge-gray'}`}>
                      {f.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>
                    {f.updated_at ? new Date(f.updated_at).toLocaleString() : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${f.enabled ? 'btn-danger' : 'btn-primary'}`}
                      disabled={saving === f.name}
                      onClick={() => toggle(f)}
                      style={{ minWidth: 80 }}
                    >
                      {saving === f.name ? (
                        <Ic n="loader" s={12} />
                      ) : f.enabled ? (
                        <><Ic n="x" s={12} /> Disable</>
                      ) : (
                        <><Ic n="check" s={12} /> Enable</>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
