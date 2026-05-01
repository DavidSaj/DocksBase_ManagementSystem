import { useState } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const LABEL = { fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.55)', marginBottom: 6, display: 'block' };
const INPUT = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box', fontFamily: 'inherit' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

export default function LogTaskFlow({ onBack }) {
  const [form, setForm]       = useState({ title: '', priority: 'medium', description: '' });
  const [submitting, setSub]  = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setError('');
    setSub(true);
    try {
      await api.post('/maintenance/maintenance-tasks/', form);
      setSuccess(true);
      setTimeout(onBack, 1200);
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setSub(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Log Task</span>
      </div>
      {success ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔧</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Task logged!</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Title *</label>
            <input style={INPUT} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Fix gate latch on Pier A" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Priority</label>
            <select style={INPUT} value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="urgent">🔥 Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Notes <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>(optional)</span></label>
            <textarea style={{ ...INPUT, minHeight: 80, resize: 'none' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Any extra detail…" />
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" style={ACTION_BTN} disabled={submitting}>
            {submitting ? 'Saving…' : 'Log Task'}
          </button>
        </form>
      )}
    </div>
  );
}
