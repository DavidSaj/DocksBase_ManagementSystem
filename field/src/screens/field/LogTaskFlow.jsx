import { useState } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const HDR = { background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const LABEL = { fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: 'Jost, system-ui, sans-serif' };
const INPUT = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box', fontFamily: 'inherit' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#0c1f3d', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer', fontFamily: 'Jost, system-ui, sans-serif' };

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
      await api.post('/maintenance-tasks/', form);
      setSuccess(true);
      setTimeout(onBack, 1200);
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setSub(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}><Icon name="arrow-left" size={22} color="#fff" /></button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Log Task</span>
      </div>
      {success ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="check-circle" size={56} color="#27ae60" strokeWidth={1.5} />
          </div>
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
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Notes <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
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
