// portal/src/screens/tabs/MemberHomeTab.jsx
// Redesigned with the Astro mobile-preview visual language.
import { useState, useEffect } from 'react';
import { useTenant } from '@docksbase/portal-ui/context/TenantContext';
import { fetchMemberGate } from '@docksbase/portal-ui/api';
import { BrandMark, Badge } from '@docksbase/portal-ui/components/primitives';

function GateCode({ code }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code.pin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div
      className="p-home-gate-row"
      onClick={copy}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && copy()}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 0',
        cursor: 'pointer',
      }}
    >
      <div>
        <div className="p-home-gate-label">{code.label || 'Gate PIN'}</div>
        <div className="p-home-gate-pin">{code.pin}</div>
      </div>
      <div className="p-home-gate-copy">{copied ? '✓ Copied' : 'Tap to copy'}</div>
    </div>
  );
}

export default function MemberHomeTab() {
  const { marina } = useTenant();
  const [gateData, setGateData] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetchMemberGate()
      .then((r) => setGateData(r.data))
      .catch(() => setGateData(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-home-root">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 20px 0',
        }}
      >
        <BrandMark />
        <Badge variant="live">Live</Badge>
      </header>

      <h1 className="p-greet">{marina?.name || 'My Marina'}</h1>
      <div className="p-greet-sub">Member access</div>

      <div className="p-home-card">
        <div className="p-home-card-title">Gate Access</div>
        {loading && <div className="p-home-loading">Loading…</div>}
        {!loading && !gateData?.gate_codes?.length && (
          <div className="p-home-empty">No gate codes on file. Contact the marina.</div>
        )}
        {!loading && gateData?.gate_codes?.map((c, i) => <GateCode key={i} code={c} />)}
      </div>

      {gateData?.wifi_name && (
        <div className="p-home-card">
          <div className="p-home-card-title">WiFi</div>
          <div className="p-home-wifi-row">
            <span className="p-home-wifi-label">Network</span>
            <span className="p-home-wifi-value">{gateData.wifi_name}</span>
          </div>
          {gateData.wifi_password && (
            <div className="p-home-wifi-row">
              <span className="p-home-wifi-label">Password</span>
              <span className="p-home-wifi-value">{gateData.wifi_password}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
