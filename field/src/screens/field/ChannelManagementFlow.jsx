import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const HDR = { background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const CARD = { background: '#fff', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };

const DIRECT_BADGE = { background: '#e8f4ea', color: '#1a6b2e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' };
const OTA_BADGE   = { background: '#e8eef9', color: '#1a3c7e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' };
const LOCKED_BADGE = { background: '#f0e8f4', color: '#6b2e8a', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none' };

export default function ChannelManagementFlow({ onBack }) {
  const [berths, setBerths] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/berths/'),
      api.get('/ota-connections/'),
    ])
      .then(([bRes, cRes]) => {
        setBerths((bRes.data.results ?? bRes.data).filter(b => b.berth_class === 'standard'));
        setConnections(cRes.data.results ?? cRes.data);
      })
      .catch(() => setError('Failed to load data.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleConfirm() {
    const { berth, newConnId } = confirm;
    setConfirm(null);
    setSaving(berth.id);
    try {
      const resp = await api.patch(`/berths/${berth.id}/`, { ota_connection: newConnId });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...resp.data } : b));
    } catch {
      setSaveError('Failed to update berth channel.');
    } finally {
      setSaving(null);
    }
  }

  async function handleUnlock(berth) {
    setSaving(berth.id);
    try {
      const resp = await api.patch(`/berths/${berth.id}/`, { channel_locked: false });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...resp.data } : b));
    } catch {
      setSaveError('Failed to unlock berth.');
    } finally {
      setSaving(null);
    }
  }

  function connName(connId) {
    if (!connId) return 'Direct';
    return connections.find(c => c.id === connId)?.name ?? 'OTA';
  }

  function nextConnId(berth) {
    if (!berth.ota_connection) return connections[0]?.id ?? null;
    const idx = connections.findIndex(c => c.id === berth.ota_connection);
    return idx >= 0 && idx < connections.length - 1 ? connections[idx + 1].id : null;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Channel Management</span>
      </div>

      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 340, width: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Move Berth {confirm.berth.code}?</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20 }}>
              Moving to <strong>{connName(confirm.newConnId)}</strong>. This berth will be locked to this channel until manually unlocked.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirm(null)} style={{ flex: 1, height: 44, borderRadius: 10, border: '1.5px solid #ddd', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleConfirm} style={{ flex: 1, height: 44, borderRadius: 10, border: 'none', background: '#0c1f3d', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 14 }}>{error}</div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {saveError && (
            <div style={{ background: '#fdedec', color: '#c0392b', padding: '10px 14px', borderRadius: 8, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {saveError}
              <button onClick={() => setSaveError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#c0392b', padding: '0 4px' }}>×</button>
            </div>
          )}
          {berths.map(b => {
            const badge = b.channel_locked
              ? { style: LOCKED_BADGE, label: `Locked · ${connName(b.ota_connection)}` }
              : b.ota_connection
                ? { style: OTA_BADGE, label: connName(b.ota_connection) }
                : { style: DIRECT_BADGE, label: 'Direct' };
            return (
              <div key={b.id} style={CARD}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Berth {b.code}</div>
                  {b.pier_code && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Pier {b.pier_code}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {b.channel_locked && (
                    <button
                      style={{ fontSize: 11, padding: '2px 8px', background: 'none', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 5, cursor: 'pointer' }}
                      disabled={saving === b.id}
                      onClick={() => handleUnlock(b)}
                    >
                      Unlock
                    </button>
                  )}
                  <button
                    style={{ ...badge.style, opacity: saving === b.id ? 0.5 : 1 }}
                    disabled={saving === b.id || connections.length === 0}
                    onClick={() => !b.channel_locked && setConfirm({ berth: b, newConnId: nextConnId(b) })}
                  >
                    {saving === b.id ? '…' : badge.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
