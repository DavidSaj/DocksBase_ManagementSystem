// frontend/src/screens/settings/MobileConfigTab.jsx
import { useState, useEffect, useRef } from 'react';
import api from '../../api.js';

function Toggle({ label, desc, checked, onChange }) {
  return (
    <div className="mc-toggle-row">
      <div>
        <div className="mc-toggle-label">{label}</div>
        <div className="mc-toggle-desc">{desc}</div>
      </div>
      <button
        className={`mc-toggle-btn${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
        type="button"
        aria-pressed={checked}
      >
        {checked ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

export default function MobileConfigTab({ marina }) {
  const [config, setConfig] = useState(marina?.app_config || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [patchError, setPatchError] = useState(null);
  const patchTimer = useRef(null);
  const savedTimer = useRef(null);

  useEffect(() => { setConfig(marina?.app_config || {}); }, [marina]);

  function patch(updates) {
    setConfig(c => ({ ...c, ...updates }));
    clearTimeout(patchTimer.current);
    patchTimer.current = setTimeout(() => {
      api.patch('/api/v1/marina/app-config/', updates)
        .catch(() => setPatchError('Auto-save failed. Please refresh and try again.'));
    }, 300);
  }

  function saveContent(e) {
    e.preventDefault();
    setSaving(true);
    api.patch('/api/v1/marina/app-config/', {
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

  return (
    <div className="mc-root">
      {patchError && <div className="mc-error">{patchError}</div>}
      <div className="mc-layout">
      <div className="mc-form-col">
      {/* Brand & Identity */}
      <div className="mc-section-title">Brand &amp; Identity</div>
      <div className="mc-card">
        <label className="mc-label" htmlFor="mc-brand-color">Primary Brand Color</label>
        <div className="mc-color-row">
          <input
            type="color"
            id="mc-brand-color"
            className="mc-color-picker"
            value={config.brand_color || '#0c1f3d'}
            onChange={e => setConfig(c => ({ ...c, brand_color: e.target.value }))}
            onBlur={e => patch({ brand_color: e.target.value })}
          />
          <input
            type="text"
            className="mc-color-hex"
            value={config.brand_color || '#0c1f3d'}
            onChange={e => setConfig(c => ({ ...c, brand_color: e.target.value }))}
            onBlur={e => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && patch({ brand_color: e.target.value })}
            maxLength={7}
            aria-label="Brand color hex value"
          />
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="mc-section-title">Feature Toggles</div>
      <div className="mc-card">
        <Toggle
          label="Boatyard Services"
          desc="Members can submit work orders and maintenance requests"
          checked={config.enable_boatyard !== false}
          onChange={v => patch({ enable_boatyard: v })}
        />
        <Toggle
          label="Utility Tracking"
          desc="Members see their Dockwalk meter readings and usage costs"
          checked={config.enable_utilities !== false}
          onChange={v => patch({ enable_utilities: v })}
        />
        <Toggle
          label="Document Vault"
          desc="Members must upload insurance and registration documents"
          checked={config.enable_documents !== false}
          onChange={v => patch({ enable_documents: v })}
        />
      </div>

      {/* Content */}
      <div className="mc-section-title">Content</div>
      <form className="mc-card" onSubmit={saveContent}>
        <label className="mc-label" htmlFor="mc-wifi-name">WiFi Network Name</label>
        <input
          id="mc-wifi-name"
          className="mc-input"
          type="text"
          value={config.wifi_name || ''}
          onChange={e => setConfig(c => ({ ...c, wifi_name: e.target.value }))}
        />
        <label className="mc-label" htmlFor="mc-wifi-pass">WiFi Password</label>
        <input
          id="mc-wifi-pass"
          className="mc-input"
          type="text"
          value={config.wifi_password || ''}
          onChange={e => setConfig(c => ({ ...c, wifi_password: e.target.value }))}
        />
        <label className="mc-label" htmlFor="mc-local-guide">Local Guide</label>
        <textarea
          id="mc-local-guide"
          className="mc-textarea"
          rows={5}
          placeholder={"e.g.\nBest pizza: Joe's Catch +1 555 0123\nEmergency tow: SeaTow +1 555 9999"}
          value={config.local_guide || ''}
          onChange={e => setConfig(c => ({ ...c, local_guide: e.target.value }))}
        />
        <button className="mc-save" type="submit" disabled={saving}>
          {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save Content'}
        </button>
      </form>
      </div>
      <div className="mc-preview-col">
        <ClientPreview config={config} marinaName={marina?.name || 'Your Marina'} />
      </div>
      </div>
    </div>
  );
}

function ClientPreview({ config, marinaName }) {
  const [mode, setMode] = useState('app');
  const brand = config.brand_color || '#0c1f3d';
  return (
    <div className="mc-preview-sticky">
      <div className="mc-preview-header">
        <div className="mc-preview-title">Client Preview</div>
        <div className="mc-preview-tabs">
          <button
            type="button"
            className={`mc-preview-tab${mode === 'app' ? ' active' : ''}`}
            onClick={() => setMode('app')}
          >Mobile App</button>
          <button
            type="button"
            className={`mc-preview-tab${mode === 'email' ? ' active' : ''}`}
            onClick={() => setMode('email')}
          >Arrival Email</button>
        </div>
      </div>
      {mode === 'app' ? (
        <PhonePreview config={config} marinaName={marinaName} brand={brand} />
      ) : (
        <EmailPreview config={config} marinaName={marinaName} brand={brand} />
      )}
    </div>
  );
}

function PhonePreview({ config, marinaName, brand }) {
  const features = [
    { key: 'enable_boatyard', label: 'Boatyard' },
    { key: 'enable_utilities', label: 'Utilities' },
    { key: 'enable_documents', label: 'Documents' },
  ].filter(f => config[f.key] !== false);
  return (
    <div className="mc-phone">
      <div className="mc-phone-notch" />
      <div className="mc-phone-screen">
        <div className="mc-phone-hero" style={{ background: brand }}>
          <div className="mc-phone-hello">Welcome aboard</div>
          <div className="mc-phone-marina">{marinaName}</div>
        </div>
        <div className="mc-phone-body">
          <div className="mc-phone-card">
            <div className="mc-phone-card-label">WiFi</div>
            <div className="mc-phone-card-value">{config.wifi_name || '—'}</div>
            <div className="mc-phone-card-sub">{config.wifi_password ? `Password: ${config.wifi_password}` : 'No password set'}</div>
          </div>
          <div className="mc-phone-tiles">
            {features.length === 0 && <div className="mc-phone-empty">No features enabled</div>}
            {features.map(f => (
              <div key={f.key} className="mc-phone-tile" style={{ borderColor: brand }}>
                <div className="mc-phone-tile-dot" style={{ background: brand }} />
                {f.label}
              </div>
            ))}
          </div>
          <div className="mc-phone-card">
            <div className="mc-phone-card-label">Local Guide</div>
            <div className="mc-phone-guide">
              {config.local_guide
                ? config.local_guide
                : <span style={{ opacity: 0.5 }}>Add tips, contacts, and recommendations…</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailPreview({ config, marinaName, brand }) {
  return (
    <div className="mc-email">
      <div className="mc-email-meta">
        <div><strong>From:</strong> {marinaName}</div>
        <div><strong>Subject:</strong> Your arrival info — {marinaName}</div>
      </div>
      <div className="mc-email-body">
        <div className="mc-email-hero" style={{ background: brand }}>
          <div className="mc-email-hero-title">Welcome to {marinaName}</div>
        </div>
        <div className="mc-email-section">
          <p>We're looking forward to your visit. Here's what you'll need on arrival.</p>
        </div>
        <div className="mc-email-section">
          <div className="mc-email-h">WiFi</div>
          <div>Network: <strong>{config.wifi_name || '—'}</strong></div>
          <div>Password: <strong>{config.wifi_password || '—'}</strong></div>
        </div>
        {config.local_guide && (
          <div className="mc-email-section">
            <div className="mc-email-h">Local Guide</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{config.local_guide}</div>
          </div>
        )}
        <div className="mc-email-footer">
          Safe travels,<br />The {marinaName} team
        </div>
      </div>
    </div>
  );
}
