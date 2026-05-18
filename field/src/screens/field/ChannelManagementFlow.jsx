import { useState, useEffect } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

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
    <div className="f-screen">
      <div className="f-topbar">
        <button className="f-dw-back" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
          Back
        </button>
        <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>Channel Management</span>
        <span style={{ width: 50 }} />
      </div>

      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: 'var(--db-bezel)', border: 'var(--db-card-border)', borderRadius: 'var(--db-radius-md)', padding: 24, maxWidth: 340, width: '100%' }}>
            <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 20, fontWeight: 700, color: 'var(--db-on-dark)', marginBottom: 10 }}>Move Berth {confirm.berth.code}?</div>
            <div style={{ fontSize: 13, color: 'var(--db-on-dark-muted)', marginBottom: 20 }}>
              Moving to <strong style={{ color: 'var(--db-gold-light)' }}>{connName(confirm.newConnId)}</strong>. This berth will be locked to this channel until manually unlocked.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirm(null)} className="f-btn-ghost" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleConfirm} className="f-btn-primary" style={{ flex: 1 }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="f-dw-loading">Loading…</div>
      ) : error ? (
        <div className="f-dw-error">{error}</div>
      ) : (
        <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column' }}>
          {saveError && (
            <div style={{ margin: '0 16px 8px', background: 'rgba(224,85,85,0.12)', color: 'var(--db-status-red)', padding: '10px 14px', borderRadius: 'var(--db-radius-sm)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(224,85,85,0.3)' }}>
              {saveError}
              <button onClick={() => setSaveError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--db-status-red)', padding: '0 4px' }}>×</button>
            </div>
          )}
          {berths.map(b => {
            const pillClass = b.channel_locked
              ? 'f-pill f-pill--gold'
              : b.ota_connection
                ? 'f-pill f-pill--gold'
                : 'f-pill f-pill--green';
            const pillLabel = b.channel_locked
              ? `Locked · ${connName(b.ota_connection)}`
              : b.ota_connection
                ? connName(b.ota_connection)
                : 'Direct';
            return (
              <div key={b.id} className="f-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 17, fontWeight: 700, color: 'var(--db-on-dark)' }}>Berth {b.code}</div>
                  {b.pier_code && <div style={{ fontSize: 12, color: 'var(--db-on-dark-muted)' }}>Pier {b.pier_code}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {b.channel_locked && (
                    <button
                      style={{ fontSize: 11, padding: '4px 10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--db-on-dark-soft)', borderRadius: 5, cursor: 'pointer' }}
                      disabled={saving === b.id}
                      onClick={() => handleUnlock(b)}
                    >
                      Unlock
                    </button>
                  )}
                  <button
                    className={pillClass}
                    style={{ opacity: saving === b.id ? 0.5 : 1, cursor: 'pointer' }}
                    disabled={saving === b.id || connections.length === 0}
                    onClick={() => !b.channel_locked && setConfirm({ berth: b, newConnId: nextConnId(b) })}
                  >
                    {saving === b.id ? '…' : pillLabel}
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
