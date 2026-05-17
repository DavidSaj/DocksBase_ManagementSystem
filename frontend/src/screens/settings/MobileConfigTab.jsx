// frontend/src/screens/settings/MobileConfigTab.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
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

        {/* Brand — mobile/portal color is locked to the DocksBase navy so the
            boater experience stays consistent across marinas. Editing was
            removed at user request; we display the fixed color for reference. */}
        <div className="card">
          <div className="card-header">
            <div className="card-header-title">Brand</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Mobile portal color</div>
          </div>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              aria-label="Mobile portal color (fixed)"
              style={{ width: 44, height: 36, border: '1px solid #ddd', borderRadius: 4, background: '#0c1f3d' }}
            />
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'rgba(0,0,0,0.6)' }}>#0c1f3d</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginLeft: 'auto', maxWidth: 260, lineHeight: 1.4, textAlign: 'right' }}>
              Mobile colors are fixed to ensure a consistent boater experience across marinas.
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
          <PortalIframePreview config={config} marinaName={marina?.name || 'Your Marina'} />
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 10, textAlign: 'center', lineHeight: 1.5 }}>
            Live preview from the real portal. Edits show instantly.
          </div>
          <div style={{
            marginTop: 12, padding: '10px 12px',
            background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 6, fontSize: 11, color: 'rgba(0,0,0,0.55)', lineHeight: 1.5,
          }}>
            <strong>About the gate PIN in the preview.</strong> Boaters see their
            marina's gate PINs on the member portal home screen, pulled from each
            member's wallet (<code>wallet.gate_codes</code>). Set or edit PINs per
            zone under <strong>Access Control → Zones</strong> — there is no
            separate gate-PIN field on this Settings screen.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Portal iframe preview ────────────────────────────────────────────────
// Loads PORTAL_URL/__preview/ and posts config updates over postMessage. The
// preview screen in the portal bypasses auth and tenant detection.

function PortalIframePreview({ config, marinaName }) {
  const iframeRef = useRef(null);
  const [ready, setReady] = useState(false);
  const previewUrl = `${PORTAL_URL.replace(/\/$/, '')}/__preview/`;
  const targetOrigin = useMemo(() => {
    try { return new URL(PORTAL_URL).origin; }
    catch { return '*'; }
  }, []);

  // Listen for the iframe's "ready" handshake.
  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'portal-preview-ready') setReady(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Push the current config whenever it changes (and after the iframe is ready).
  useEffect(() => {
    if (!ready || !iframeRef.current) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'portal-preview-update', config, marinaName },
      targetOrigin,
    );
  }, [config, marinaName, ready, targetOrigin]);

  return (
    <div style={{
      width: 290, margin: '0 auto', background: '#111', borderRadius: 38, padding: 9,
      boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
    }}>
      <div style={{ width: 80, height: 5, background: '#333', borderRadius: 3, margin: '6px auto 8px' }} />
      <div style={{
        background: '#f4f6f8', borderRadius: 28, overflow: 'hidden',
        height: 560, position: 'relative',
      }}>
        <iframe
          ref={iframeRef}
          src={previewUrl}
          title="Member portal preview"
          style={{
            width: '100%', height: '100%', border: 'none', display: 'block',
            background: '#f4f6f8',
          }}
          // sandbox kept permissive enough for postMessage + same-origin storage access
          sandbox="allow-scripts allow-same-origin"
        />
        {!ready && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 12, color: 'rgba(0,0,0,0.4)', background: '#f4f6f8',
          }}>
            Loading preview…
          </div>
        )}
      </div>
    </div>
  );
}
