import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Badge, Spinner, EmptyState, ErrorMsg } from './_shared.jsx';
import RevealOnceModal from './RevealOnceModal.jsx';

export default function DeviceTokensPanel() {
  const [meters, setMeters]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [err, setErr]         = useState('');
  const [reveal, setReveal]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/smart-meters/')
      .then(r => setMeters(r.data.results ?? r.data))
      .catch(() => setMeters([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function generate(m) {
    setBusy(m.id); setErr('');
    try {
      const { data } = await api.post(`/utilities/smart-meters/${m.id}/device-token/`);
      setReveal([
        { label: 'Hardware ID',  value: data.hardware_id },
        { label: 'Device Token', value: data.device_token },
      ]);
      load();
    } catch {
      setErr('Failed to generate.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(m) {
    if (!confirm(`Revoke the token for ${m.label || m.device_id}? The meter will lose access.`)) return;
    setBusy(m.id);
    await api.delete(`/utilities/smart-meters/${m.id}/device-token/`);
    setBusy(null);
    load();
  }

  return (
    <div>
      <div className="card" style={{ padding: 12, marginBottom: 14, fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
        Use device tokens for meters that POST directly to DocksBase
        (i.e. they don't go through a vendor's cloud). Each meter gets its own
        Hardware ID + Token pair. Treat the token like a password.
      </div>

      <ErrorMsg msg={err} />

      {loading ? <Spinner /> : meters.length === 0 ? (
        <EmptyState icon="📡" message="No meters registered. Add a meter on the Meters sub-tab first." />
      ) : (
        <div className="card">
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Meter</th>
                <th>Hardware ID</th>
                <th>Token</th>
                <th>Last seen</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meters.map(m => {
                const has = !!m.hardware_id;
                return (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{m.label || m.device_id}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(0,0,0,0.6)' }}>
                      {m.hardware_id || '—'}
                    </td>
                    <td>
                      {has
                        ? <Badge color="info">{m.device_token_prefix}…</Badge>
                        : <Badge color="secondary">Not issued</Badge>}
                    </td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                      {m.device_token_last_used_at ? new Date(m.device_token_last_used_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {has ? (
                        <>
                          <button onClick={() => generate(m)} disabled={busy === m.id} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Rotate</button>
                          <button onClick={() => revoke(m)}   disabled={busy === m.id} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Revoke</button>
                        </>
                      ) : (
                        <button onClick={() => generate(m)} disabled={busy === m.id}
                                style={{ background: 'var(--navy)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                          Generate token
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reveal && (
        <RevealOnceModal
          title="Device credentials"
          secrets={reveal}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}
