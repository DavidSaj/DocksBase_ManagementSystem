// frontend/src/screens/settings/MobileConfigTab.jsx
import { useState, useEffect, useRef } from 'react';
import api from '../../api.js';

const LABEL = {
  fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)',
  textTransform: 'uppercase', letterSpacing: '0.5px',
  display: 'block', marginBottom: 6,
};

const PORTAL_URL = import.meta.env.VITE_PORTAL_URL || 'https://portal.docksbase.com';

function Toggle({ on, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 9, cursor: disabled ? 'default' : 'pointer',
        background: on ? '#0075de' : 'rgba(0,0,0,0.15)',
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '13px 18px',
      borderBottom: 'var(--border)', gap: 16,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>{desc}</div>
      </div>
      <Toggle on={checked} onChange={onChange} />
    </div>
  );
}

export default function MobileConfigTab({ marina }) {
  const [config, setConfig] = useState(marina?.app_config || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [savingFlag, setSavingFlag] = useState(false);
  const [patchError, setPatchError] = useState(null);
  const patchTimer = useRef(null);
  const savedTimer = useRef(null);

  useEffect(() => { setConfig(marina?.app_config || {}); }, [marina]);

  function patch(updates) {
    setConfig(c => ({ ...c, ...updates }));
    setPatchError(null);
    setSavingFlag(true);
    clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      api.patch('/marina/app-config/', updates)
        .catch(() => setPatchError('Auto-save failed. Please refresh and try again.'))
        .finally(() => setSavingFlag(false));
    }, 300);
  }

  function saveContent(e) {
    e.preventDefault();
    setSaving(true);
    setPatchError(null);
    api.patch('/marina/app-config/', {
      wifi_name:     config.wifi_name     || '',
      wifi_password: config.wifi_password || '',
      local_guide:   config.local_guide   || '',
      brand_color:   config.brand_color   || '#0c1f3d',
    })
      .then(() => {
        setSaved(true);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2000);
      })
      .catch(() => setPatchError('Save failed. Please try again.'))
      .finally(() => setSaving(false));
  }

  const brand = config.brand_color || '#0c1f3d';
  const portalUrl = marina?.slug ? `${PORTAL_URL}/${marina.slug}` : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

        {patchError && (
          <div style={{
            background: '#fff5f5', color: '#b91c1c', border: '1px solid #fecaca',
            borderRadius: 6, padding: '10px 14px', fontSize: 13,
          }}>{patchError}</div>
        )}

        {/* Brand */}
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Brand</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Color applied to the member portal</div>
          </div>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="color"
              value={config.brand_color || '#0c1f3d'}
              onChange={e => setConfig(c => ({ ...c, brand_color: e.target.value }))}
              onBlur={e => patch({ brand_color: e.target.value })}
              style={{ width: 44, height: 36, padding: 2, border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}
              aria-label="Primary brand color"
            />
            <input
              type="text"
              className="input"
              value={config.brand_color || '#0c1f3d'}
              onChange={e => setConfig(c => ({ ...c, brand_color: e.target.value }))}
              onBlur={e => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && patch({ brand_color: e.target.value })}
              maxLength={7}
              style={{ width: 110, fontFamily: 'monospace' }}
            />
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginLeft: 'auto' }}>
              {savingFlag ? 'Saving…' : 'Saves automatically'}
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Features</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Toggle what members can see</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <ToggleRow
              label="Boatyard Services"
              desc="Members can submit work orders and maintenance requests"
              checked={config.enable_boatyard !== false}
              onChange={v => patch({ enable_boatyard: v })}
            />
            <ToggleRow
              label="Utility Tracking"
              desc="Members see their Dockwalk meter readings and usage costs"
              checked={config.enable_utilities !== false}
              onChange={v => patch({ enable_utilities: v })}
            />
            <div style={{ borderBottom: 0 }}>
              <ToggleRow
                label="Document Vault"
                desc="Members must upload insurance and registration documents"
                checked={config.enable_documents !== false}
                onChange={v => patch({ enable_documents: v })}
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Content</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Information shown on the member home screen</div>
          </div>
          <form className="card-body" onSubmit={saveContent} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={LABEL}>WiFi Network Name</label>
              <input
                className="input"
                type="text"
                value={config.wifi_name || ''}
                onChange={e => setConfig(c => ({ ...c, wifi_name: e.target.value }))}
                placeholder="Marina-Guest"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={LABEL}>WiFi Password</label>
              <input
                className="input"
                type="text"
                value={config.wifi_password || ''}
                onChange={e => setConfig(c => ({ ...c, wifi_password: e.target.value }))}
                placeholder="••••••••"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={LABEL}>Local Guide</label>
              <textarea
                className="input"
                rows={6}
                placeholder={"e.g.\nBest pizza: Joe's Catch +1 555 0123\nEmergency tow: SeaTow +1 555 9999"}
                value={config.local_guide || ''}
                onChange={e => setConfig(c => ({ ...c, local_guide: e.target.value }))}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 4 }}>
                Shown to members on arrival. Plain text or HTML.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>
                {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save Content'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Preview column */}
      <div style={{ minWidth: 0 }}>
        <div style={{ position: 'sticky', top: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Member Portal Preview
            </div>
            {portalUrl && (
              <a
                href={portalUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: '#0075de', fontWeight: 600, textDecoration: 'none' }}
              >Open live portal →</a>
            )}
          </div>
          <PhonePreview config={config} marinaName={marina?.name || 'Your Marina'} brand={brand} />
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 10, textAlign: 'center', lineHeight: 1.5 }}>
            A faithful rendering of the member home screen.<br />
            Click <strong>Open live portal</strong> to see your real portal.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Phone preview — mirrors portal MemberHomeTab pixel-for-pixel ─────────

function PhonePreview({ config, marinaName, brand }) {
  const tabs = [
    { id: 'home',      label: 'Home',      enabled: true },
    { id: 'utilities', label: 'Utilities', enabled: config.enable_utilities !== false },
    { id: 'services',  label: 'Services',  enabled: config.enable_boatyard  !== false },
    { id: 'account',   label: 'Account',   enabled: true },
  ].filter(t => t.enabled);

  return (
    <div style={{
      width: 290, margin: '0 auto', background: '#111', borderRadius: 38, padding: 9,
      boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
    }}>
      <div style={{ width: 80, height: 5, background: '#333', borderRadius: 3, margin: '6px auto 8px' }} />
      <div style={{
        background: '#f4f6f8', borderRadius: 28, overflow: 'hidden',
        height: 560, display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 16px 0', flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1a2d4a', lineHeight: 1.15 }}>
            {marinaName}
          </div>
        </div>

        {/* Scrolling body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {/* Gate Access */}
          <div style={cardStyle}>
            <div style={cardTitleStyle}>Gate Access</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
              <div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Main Gate PIN</div>
                <div style={{
                  fontSize: 26, fontWeight: 800, color: brand,
                  fontFamily: '"IBM Plex Mono", monospace', letterSpacing: '4px',
                }}>4128</div>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>Tap to copy</div>
            </div>
          </div>

          {/* WiFi */}
          {(config.wifi_name || config.wifi_password) ? (
            <div style={cardStyle}>
              <div style={cardTitleStyle}>WiFi</div>
              {config.wifi_name && (
                <div style={wifiRowStyle}>
                  <span style={{ color: 'rgba(0,0,0,0.4)' }}>Network</span>
                  <span style={{ fontWeight: 600, color: '#1a2d4a' }}>{config.wifi_name}</span>
                </div>
              )}
              {config.wifi_password && (
                <div style={wifiRowStyle}>
                  <span style={{ color: 'rgba(0,0,0,0.4)' }}>Password</span>
                  <span style={{ fontWeight: 600, color: '#1a2d4a', fontFamily: 'monospace' }}>{config.wifi_password}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...cardStyle, opacity: 0.5 }}>
              <div style={cardTitleStyle}>WiFi</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', padding: '6px 0' }}>
                Add a network name and password to display them here.
              </div>
            </div>
          )}

          {/* Local guide */}
          {config.local_guide ? (
            <div style={cardStyle}>
              <div style={cardTitleStyle}>Local Guide</div>
              <div style={{
                fontSize: 12, color: '#1a2d4a', whiteSpace: 'pre-wrap', lineHeight: 1.45,
              }}>{config.local_guide}</div>
            </div>
          ) : null}
        </div>

        {/* Bottom nav */}
        <div style={{
          display: 'flex', borderTop: '1px solid rgba(0,0,0,0.08)', background: '#fff',
          padding: '6px 0 10px', flexShrink: 0,
        }}>
          {tabs.map((t, i) => (
            <div key={t.id} style={{
              flex: 1, textAlign: 'center', fontSize: 10, fontWeight: 600,
              color: i === 0 ? brand : 'rgba(0,0,0,0.4)',
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i === 0 ? brand : 'rgba(0,0,0,0.25)',
                margin: '0 auto 4px',
              }} />
              {t.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const cardStyle = {
  background: '#fff', borderRadius: 12, padding: 14, margin: '10px 14px 0',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.06)',
};
const cardTitleStyle = {
  fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)',
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8,
};
const wifiRowStyle = {
  display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13,
};
