import { useState } from 'react';
import api from '../../api.js';
import Icon from '../../components/Icon.jsx';

const LABEL = { fontSize: 11, fontWeight: 700, color: 'var(--db-gold-light)', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: 2, fontFamily: 'var(--db-font-sans)' };

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
    <div className="f-screen">
      <div className="f-topbar">
        <button className="f-dw-back" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="arrow-left" size={18} color="var(--db-gold-light)" />
          Back
        </button>
        <span style={{ fontFamily: 'var(--db-font-serif)', fontSize: 18, fontWeight: 700, color: 'var(--db-on-dark)' }}>Log Task</span>
        <span style={{ width: 50 }} />
      </div>
      {success ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="check-circle" size={56} color="var(--db-status-green)" strokeWidth={1.5} />
          </div>
          <div style={{ fontFamily: 'var(--db-font-serif)', fontSize: 24, fontWeight: 700, color: 'var(--db-on-dark)' }}>Task logged!</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Title *</label>
            <input className="f-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Fix gate latch on Pier A" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Priority</label>
            <select className="f-select" value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={LABEL}>Notes <span style={{ fontWeight: 400, color: 'var(--db-on-dark-faint)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <textarea className="f-textarea" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Any extra detail…" />
          </div>
          {error && <div style={{ color: 'var(--db-status-red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" className="f-btn-primary" style={{ width: '100%' }} disabled={submitting}>
            {submitting ? 'Saving…' : 'Log Task'}
          </button>
        </form>
      )}
    </div>
  );
}
