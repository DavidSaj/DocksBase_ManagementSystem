import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

export default function Settings({ group }) {
  const [settings, setSettings] = useState(null);
  const [editing, setEditing]   = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState(false);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setSettings(null);
    setError(false);
    api.get(`enterprise/groups/${group.id}/settings/`)
      .then(r => { if (!ignore) setSettings(r.data); })
      .catch(() => { if (!ignore) setError(true); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [group.id]);

  async function handleSave(e) {
    e.preventDefault();
    if (!Object.keys(editing).length) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`enterprise/groups/${group.id}/settings/`, editing);
      setSettings(data);
      setEditing({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (error)   return <div className="empty"><div className="empty-title">Failed to load settings.</div></div>;
  if (!settings) return null;

  const val   = field => editing[field] !== undefined ? editing[field] : (settings[field] ?? '');
  const set   = field => e => setEditing(prev => ({ ...prev, [field]: e.target.value }));
  const dirty = Object.keys(editing).length > 0;

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Settings</div>
      </div>

      <div className="card" style={{ maxWidth: 480, padding: 24 }}>
        <form onSubmit={handleSave}>
          {[
            ['Group name',      'name',                   'text'],
            ['Billing email',   'billing_contact_email',  'email'],
            ['VAT number',      'vat_number',             'text'],
            ['Base currency',   'base_currency',          'text'],
          ].map(([label, field, type]) => (
            <div key={field} style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5, color: 'rgba(0,0,0,0.6)' }}>
                {label}
              </label>
              <input
                type={type}
                value={val(field)}
                onChange={set(field)}
                style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !dirty}
              style={{ gap: 6 }}
            >
              <Ic n="save" s={13} /> Save changes
            </button>
            {saved && (
              <span style={{ fontSize: 12, color: 'var(--green)' }}>Saved.</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
