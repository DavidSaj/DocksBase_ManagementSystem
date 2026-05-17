// portal/src/components/shell/BoardingPass.jsx
import { useState, useEffect } from 'react';
import { useTenant } from '@docksbase/portal-ui/context/TenantContext';
import api from '@docksbase/portal-ui/api';

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button className="p-bp-copy-btn" onClick={copy} type="button">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function AccessRow({ label, value, copyable = true }) {
  if (!value) return null;
  return (
    <div className="p-bp-access-row">
      <div>
        <div className="p-bp-access-label">{label}</div>
        <div className="p-bp-access-value">{value}</div>
      </div>
      {copyable && <CopyBtn value={value} />}
    </div>
  );
}

function WashTokenRow({ token }) {
  const expires = new Date(token.expires_at);
  const now = new Date();
  const hoursLeft = Math.ceil((expires - now) / 3600000);
  const expiryText = hoursLeft < 24
    ? `Expires in ${hoursLeft}h`
    : `Valid until ${expires.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="p-bp-access-row">
      <div>
        <div className="p-bp-access-label">{token.facility === 'shower' ? 'Shower Code' : 'Laundry Code'}</div>
        <div className="p-bp-access-value">{token.token_code}</div>
        <div className="p-bp-access-expiry">{expiryText}</div>
      </div>
      <CopyBtn value={token.token_code} />
    </div>
  );
}

export default function BoardingPass({ booking }) {
  const { marina, appConfig } = useTenant();
  const w = booking.marina_wallet;
  const washTokens = booking.wash_tokens || [];
  const [mapData, setMapData] = useState(null);

  useEffect(() => {
    api.get('/portal/checkin/map/')
      .then(r => setMapData(r.data))
      .catch(() => {});
  }, []);

  return (
    <div className="p-bp-root">
      {/* Header */}
      <div className="p-bp-header">
        {appConfig?.logo_url
          ? <img src={appConfig.logo_url} alt={marina?.name} className="p-bp-logo" />
          : <span className="p-bp-marina-name">{marina?.name || w?.marina_name}</span>
        }
        <button className="p-bp-gear" aria-label="Settings" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
      </div>

      <div className="p-bp-scroll">
        {/* Section 1 — Slip */}
        <div className="p-bp-section">
          <div className="p-bp-section-label">Your Berth</div>
          <div className="p-bp-berth-code">
            {[booking.berth_pier, booking.berth_code].filter(Boolean).join(' · ') || 'Pending assignment'}
          </div>
          <div className="p-bp-dates">
            <span>{booking.check_in}</span>
            <span className="p-bp-dates-arrow">→</span>
            <span>{booking.check_out}</span>
          </div>
        </div>

        {/* Section 2 — Access */}
        {w && (
          <div className="p-bp-section">
            <div className="p-bp-section-label">Access &amp; WiFi</div>
            {w.gate_codes?.map((g, i) => (
              <AccessRow key={i} label={g.label || 'Gate PIN'} value={g.pin} />
            ))}
            <AccessRow label="WiFi Network"  value={w.wifi_network} copyable={false} />
            <AccessRow label="WiFi Password" value={w.wifi_password} />
            {washTokens.map((t, i) => <WashTokenRow key={i} token={t} />)}
          </div>
        )}

        {/* Section 3 — Map */}
        {mapData?.amenities?.length > 0 && (
          <div className="p-bp-section">
            <div className="p-bp-section-label">Marina Map</div>
            <div className="p-bp-map-container">
              <svg
                viewBox="0 0 800 600"
                className="p-bp-map-svg"
                style={{ touchAction: 'pinch-zoom' }}
              >
                {mapData.amenities.map((a, i) => (
                  <g key={i} transform={`translate(${a.canvas_x}, ${a.canvas_y})`}>
                    <circle r="12" fill="var(--color-primary)" opacity="0.15" />
                    <circle r="6" fill="var(--color-primary)" />
                    <title>{a.label || a.type}</title>
                  </g>
                ))}
                {booking.berth_canvas_x && booking.berth_canvas_y && (
                  <g transform={`translate(${booking.berth_canvas_x}, ${booking.berth_canvas_y})`}>
                    <circle r="14" fill="#e6b800" opacity="0.3" />
                    <circle r="8" fill="#e6b800" />
                    <title>Your Berth: {booking.berth_code}</title>
                  </g>
                )}
              </svg>
              <div className="p-bp-map-legend">
                {mapData.amenities.map((a, i) => (
                  <span key={i} className="p-bp-map-legend-item">
                    <span className="p-bp-map-dot" />
                    {a.label || a.type}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Section 4 — Local Guide */}
        {appConfig?.local_guide && (
          <div className="p-bp-section">
            <div className="p-bp-section-label">Local Guide</div>
            <div
              className="p-bp-local-guide"
              dangerouslySetInnerHTML={{
                __html: (appConfig.local_guide || '')
                  .replace(/\n/g, '<br/>')
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
              }}
            />
          </div>
        )}

        {/* Section 5 — Extend Stay */}
        <div className="p-bp-section p-bp-extend">
          <div className="p-bp-section-label">Need more time?</div>
          <button
            className="p-bp-extend-btn"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('portal:navigate', { detail: { screen: 'extend' } }))}
          >
            Request Extra Night
          </button>
        </div>
      </div>
    </div>
  );
}
