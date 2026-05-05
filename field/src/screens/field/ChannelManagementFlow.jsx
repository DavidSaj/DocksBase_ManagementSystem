import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const CARD = { background: '#fff', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };

const BADGE = {
  direct: { background: '#e8f4ea', color: '#1a6b2e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' },
  mysea:  { background: '#e8eef9', color: '#1a3c7e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' },
  cooldown: { background: '#f4f0e8', color: '#8a6d2e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'default', border: 'none' },
};

function isCoolingDown(berth) {
  if (!berth.channel_cooldown_until) return false;
  return new Date(berth.channel_cooldown_until) > new Date();
}

export default function ChannelManagementFlow({ onBack }) {
  const [berths, setBerths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/berths/')
      .then(r => setBerths((r.data.results ?? r.data).filter(b => b.berth_class === 'standard')))
      .catch(() => setError('Failed to load berths.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleConfirm() {
    const { berth, newChannel } = confirm;
    setConfirm(null);
    setSaving(berth.id);
    try {
      const resp = await api.patch(`/berths/${berth.id}/`, { sales_channel: newChannel });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...resp.data } : b));
    } catch {
      setError('Failed to update berth channel.');
    } finally {
      setSaving(null);
    }
  }

  const channelLabel = ch => ch === 'mysea' ? 'mySea' : 'Direct';

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Channel Management</span>
      </div>

      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 340, width: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Move Berth {confirm.berth.code}?</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20 }}>
              Moving to <strong>{channelLabel(confirm.newChannel)}</strong>. This berth will be unavailable on both channels for 30 minutes while the transition completes.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirm(null)} style={{ flex: 1, height: 44, borderRadius: 10, border: '1.5px solid #ddd', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleConfirm} style={{ flex: 1, height: 44, borderRadius: 10, border: 'none', background: '#1a2d4a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
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
          {berths.map(b => {
            const cooling = isCoolingDown(b);
            const badgeStyle = cooling ? BADGE.cooldown : BADGE[b.sales_channel] ?? BADGE.direct;
            const label = cooling ? '⏳ Cooldown' : channelLabel(b.sales_channel);
            return (
              <div key={b.id} style={CARD}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Berth {b.code}</div>
                  {b.pier_code && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Pier {b.pier_code}</div>}
                </div>
                <button
                  style={{ ...badgeStyle, opacity: saving === b.id ? 0.5 : 1 }}
                  disabled={cooling || saving === b.id}
                  onClick={() => !cooling && setConfirm({ berth: b, newChannel: b.sales_channel === 'mysea' ? 'direct' : 'mysea' })}
                >
                  {saving === b.id ? '…' : label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
