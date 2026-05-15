import { useState } from 'react';
import IntegrationsPanel from './IntegrationsPanel.jsx';
import PushEndpointPanel from './PushEndpointPanel.jsx';
import DeviceTokensPanel from './DeviceTokensPanel.jsx';
import MetersListPanel from './MetersListPanel.jsx';

const SUBTABS = [
  { id: 'integrations',    label: 'Integrations' },
  { id: 'push-endpoint',   label: 'Push Endpoint' },
  { id: 'device-tokens',   label: 'Device Tokens' },
  { id: 'meters',          label: 'Meters' },
];

export default function MetersTab() {
  const [sub, setSub] = useState('integrations');

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.06)', marginBottom: 18 }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              padding: '7px 14px', fontSize: 12,
              fontWeight: sub === t.id ? 700 : 500,
              border: 'none', background: 'none', cursor: 'pointer',
              color: sub === t.id ? 'var(--navy)' : 'rgba(0,0,0,0.5)',
              borderBottom: sub === t.id ? '2px solid var(--navy)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'integrations'  && <IntegrationsPanel />}
      {sub === 'push-endpoint' && <PushEndpointPanel />}
      {sub === 'device-tokens' && <DeviceTokensPanel />}
      {sub === 'meters'        && <MetersListPanel />}
    </div>
  );
}
