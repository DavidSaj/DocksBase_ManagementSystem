import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Spinner, ErrorMsg } from './_shared.jsx';
import RevealOnceModal from './RevealOnceModal.jsx';

export default function PushEndpointPanel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [err,  setErr]        = useState('');
  const [reveal, setReveal]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/webhook-key/')
      .then(r => setData(r.data))
      .catch(() => setErr('Failed to load.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function rotate() {
    if (data?.status === 'active' && !confirm('Rotate the key? The old one will stop working immediately.')) return;
    setBusy(true); setErr('');
    try {
      const { data: rotated } = await api.post('/utilities/webhook-key/rotate/');
      const plaintext = rotated.key;
      setData({ ...rotated, key: undefined });
      setReveal([{ label: 'Webhook key', value: plaintext }]);
    } catch {
      setErr('Failed to rotate.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('Revoke the key? Any system using it will lose access.')) return;
    setBusy(true);
    await api.delete('/utilities/webhook-key/');
    setBusy(false);
    load();
  }

  if (loading) return <Spinner />;
  if (err)     return <ErrorMsg msg={err} />;

  const issued = data?.status !== 'unissued';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Push Endpoint</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 14 }}>
          Use this to receive readings from any system that can make an HTTP POST.
          Useful when DocksBase doesn't have a built-in integration for your vendor.
        </div>

        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>Endpoint URL</div>
        <div style={{
          background: 'var(--bg)', borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace',
          fontSize: 12, marginBottom: 14, wordBreak: 'break-all',
        }}>{data.endpoint_url}</div>

        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>API key</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)',
          borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', fontSize: 12,
          marginBottom: 14,
        }}>
          <span style={{ flex: 1 }}>
            {issued ? `${data.key_prefix}${'•'.repeat(32)}` : 'No key issued yet'}
          </span>
          {issued ? (
            <>
              <button onClick={rotate} disabled={busy} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Rotate</button>
              <button onClick={revoke} disabled={busy} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Revoke</button>
            </>
          ) : (
            <button onClick={rotate} disabled={busy} className="btn btn-sm"
                    style={{ background: 'var(--navy)', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
              Generate key
            </button>
          )}
        </div>

        {issued && (
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
            {data.last_used_at ? `Last used ${new Date(data.last_used_at).toLocaleString()}` : 'Never used'}
            {' · '} {data.rotated_at ? `Rotated ${new Date(data.rotated_at).toLocaleDateString()}` : `Issued ${new Date(data.created_at).toLocaleDateString()}`}
          </div>
        )}
      </div>

      <details className="card" style={{ padding: 14, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How to use</summary>
        <pre style={{
          background: 'var(--bg)', padding: 12, borderRadius: 6, marginTop: 10, overflowX: 'auto',
          fontSize: 11, fontFamily: 'monospace',
        }}>{`curl -X POST ${data.endpoint_url} \\
  -H 'X-Webhook-Key: <your key>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "readings": [{
      "device_id": "ROLEC-12345",
      "recorded_at": "2026-05-14T10:00:00Z",
      "cumulative_kwh": 1234.567
    }]
  }'`}</pre>
        <div style={{ marginTop: 8, color: 'rgba(0,0,0,0.55)' }}>
          The <code>device_id</code> must match a meter you've registered under the Meters sub-tab.
          Duplicate <code>(device_id, recorded_at)</code> pairs are silently deduped.
        </div>
      </details>

      {reveal && (
        <RevealOnceModal
          title="Your webhook key"
          secrets={reveal}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}
