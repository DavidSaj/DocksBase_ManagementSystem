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
  );
}
