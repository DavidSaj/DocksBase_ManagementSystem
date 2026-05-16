import { useState, useEffect } from 'react';
import api from '../../api.js';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function IPAllowlistEditor() {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [cidr, setCidr]         = useState('');
  const [label, setLabel]       = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding]     = useState(false);
  const [fetchingIp, setFetchingIp] = useState(false);

  useEffect(() => { fetchEntries(); }, []);

  async function fetchEntries() {
    setLoading(true);
    try {
      const { data } = await api.get('/security/ip-allowlist/');
      setEntries(Array.isArray(data) ? data : data.results ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setAddError('');
    setAdding(true);
    try {
      const { data } = await api.post('/security/ip-allowlist/', { cidr, label: label || undefined });
      setEntries(prev => [data, ...prev]);
      setCidr('');
      setLabel('');
    } catch (err) {
      setAddError(err.response?.data?.detail || err.response?.data?.cidr?.[0] || 'Failed to add entry.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/security/ip-allowlist/${id}/`);
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch { /* ignore */ }
  }

  async function useMyIp() {
    setFetchingIp(true);
    try {
      const { data } = await api.get('/security/whoami-ip/');
      setCidr(`${data.ip}/32`);
    } catch { /* ignore */ }
    finally { setFetchingIp(false); }
  }

  return (
    <div>
      {/* Add form */}
      <form onSubmit={handleAdd} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={cidr}
            onChange={e => setCidr(e.target.value)}
            placeholder="e.g. 203.0.113.0/24"
            required
            style={{ flex: '2 1 160px', padding: '7px 10px', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 6, fontSize: 12 }}
          />
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Label (optional)"
            style={{ flex: '2 1 120px', padding: '7px 10px', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 6, fontSize: 12 }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={useMyIp}
            disabled={fetchingIp}
            style={{ whiteSpace: 'nowrap' }}
          >
            {fetchingIp ? '…' : 'Use my IP'}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={adding} style={{ whiteSpace: 'nowrap' }}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError && <p style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{addError}</p>}
      </form>

      {/* List */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', padding: '10px 0' }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', padding: '10px 0' }}>
          No entries — all IPs are allowed (allowlist is off).
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['CIDR', 'Label', 'Added', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '4px 8px 8px 0', color: 'rgba(0,0,0,0.4)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '8px 0', fontFamily: 'monospace', fontWeight: 500 }}>{entry.cidr}</td>
                <td style={{ padding: '8px 8px', color: 'rgba(0,0,0,0.55)' }}>{entry.label || '—'}</td>
                <td style={{ padding: '8px 8px', color: 'rgba(0,0,0,0.4)' }}>{formatDate(entry.created_at)}</td>
                <td style={{ padding: '8px 0', textAlign: 'right' }}>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 11, fontWeight: 600, padding: '2px 6px' }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
