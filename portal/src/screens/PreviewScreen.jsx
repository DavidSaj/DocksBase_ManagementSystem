// portal/src/screens/PreviewScreen.jsx
//
// Sandbox-friendly preview of the member home screen, embeddable as an iframe
// from the admin Mobile App settings tab. The parent posts:
//   { type: 'portal-preview-update', config: {...app_config}, marinaName: '...' }
// and we render the same DOM/styles as the real MemberHomeTab, with stubbed
// gate-code + auth, so no API calls happen.
//
// Brand color is bound at the document level so portal.css variables apply.

import { useEffect, useState } from 'react';

const STUB_GATE = { label: 'Main Gate PIN', pin: '4128' };

export default function PreviewScreen() {
  const [config, setConfig] = useState({});
  const [marinaName, setMarinaName] = useState('Your Marina');

  useEffect(() => {
    function handleMessage(event) {
      const data = event.data;
      if (!data || data.type !== 'portal-preview-update') return;
      if (data.config) setConfig(data.config);
      if (typeof data.marinaName === 'string') setMarinaName(data.marinaName);
    }
    window.addEventListener('message', handleMessage);
    // Tell the parent we're ready to receive config.
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'portal-preview-ready' }, '*');
    }
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Bind brand color the same way AppShell does at runtime.
  useEffect(() => {
    const brand = config.brand_color || '#0c1f3d';
    document.documentElement.style.setProperty('--color-primary', brand);
  }, [config.brand_color]);

  const tabs = [
    { id: 'home',      label: 'Home',      enabled: true },
    { id: 'utilities', label: 'Utilities', enabled: config.enable_utilities !== false },
    { id: 'services',  label: 'Services',  enabled: config.enable_boatyard  !== false },
    { id: 'account',   label: 'Account',   enabled: true },
  ].filter(t => t.enabled);

  return (
    <div className="p-shell">
      <div className="p-home-root">
        <div className="p-member-header">
          <span className="p-member-header__marina">{marinaName}</span>
        </div>

        <div className="p-home-card">
          <div className="p-home-card-title">Gate Access</div>
          <div className="p-home-gate-row">
            <div>
              <div className="p-home-gate-label">{STUB_GATE.label}</div>
              <div className="p-home-gate-pin">{STUB_GATE.pin}</div>
            </div>
            <div className="p-home-gate-copy">Tap to copy</div>
          </div>
        </div>

        {(config.wifi_name || config.wifi_password) ? (
          <div className="p-home-card">
            <div className="p-home-card-title">WiFi</div>
            {config.wifi_name && (
              <div className="p-home-wifi-row">
                <span className="p-home-wifi-label">Network</span>
                <span className="p-home-wifi-value">{config.wifi_name}</span>
              </div>
            )}
            {config.wifi_password && (
              <div className="p-home-wifi-row">
                <span className="p-home-wifi-label">Password</span>
                <span className="p-home-wifi-value">{config.wifi_password}</span>
              </div>
            )}
          </div>
        ) : null}

        {config.local_guide ? (
          <div className="p-home-card">
            <div className="p-home-card-title">Local Guide</div>
            <div
              style={{ fontSize: 13, color: '#1a2d4a', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}
            >{config.local_guide}</div>
          </div>
        ) : null}
      </div>

      {/* Mimic BottomNav using portal.css classes if present, else inline */}
      <PreviewBottomNav tabs={tabs} />
    </div>
  );
}

function PreviewBottomNav({ tabs }) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      display: 'flex', borderTop: '1px solid rgba(0,0,0,0.08)',
      background: '#fff', padding: '6px 0 10px',
    }}>
      {tabs.map((t, i) => (
        <div key={t.id} style={{
          flex: 1, textAlign: 'center', fontSize: 10, fontWeight: 600,
          color: i === 0 ? 'var(--color-primary)' : 'rgba(0,0,0,0.4)',
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: i === 0 ? 'var(--color-primary)' : 'rgba(0,0,0,0.25)',
            margin: '0 auto 4px',
          }} />
          {t.label}
        </div>
      ))}
    </div>
  );
}
