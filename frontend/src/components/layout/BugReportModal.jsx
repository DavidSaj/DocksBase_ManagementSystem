import { useState, useEffect } from 'react';
import api from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Ic from '../ui/Icon.jsx';

function wordCount(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

const MIN_WORDS = 15;

export default function BugReportModal({ open, onClose, screen }) {
  const { user } = useAuth();
  const [phase, setPhase] = useState('idle'); // idle | submitting | success
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  // Reset state every time the modal closes
  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setTitle('');
      setDescription('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const words = wordCount(description);
  const isValid = title.trim().length > 0 && words >= MIN_WORDS;

  async function handleSubmit() {
    if (!isValid || phase === 'submitting') return;
    setPhase('submitting');
    setError('');
    try {
      await api.post('tickets/', {
        title: title.trim(),
        description: description.trim(),
        context: {
          screen,
          user_email: user?.email || '',
          user_name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
          user_role: user?.role || '',
          user_agent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          app_version: '1.0.0',
        },
      });
      setPhase('success');
    } catch {
      setPhase('idle');
      setError('Failed to send — please try again.');
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={phase === 'submitting' ? undefined : onClose}
    >
      <div
        style={{
          width: 420, background: '#fff', borderRadius: 12,
          boxShadow: 'var(--shadow2)', overflow: 'hidden',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: 'var(--border)',
        }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Report a Bug</span>
          {phase !== 'submitting' && (
            <div className="topbar-icon-btn" onClick={onClose} style={{ width: 24, height: 24 }}>
              <Ic n="x" s={12} />
            </div>
          )}
        </div>

        <div style={{ padding: '18px' }}>
          {phase === 'success' ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--green)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <Ic n="check" s={22} color="#fff" />
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Report sent</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>
                We'll look at it within 24 hours. Thank you for helping us improve DocksBase.
              </div>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              {/* Title */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.55)', display: 'block', marginBottom: 4 }}>
                  Title
                </label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={120}
                  disabled={phase === 'submitting'}
                  placeholder="Short summary of the issue"
                  style={{
                    width: '100%', height: 32, padding: '0 10px',
                    fontSize: 12, border: 'var(--border2)',
                    borderRadius: 6, outline: 'none',
                    background: phase === 'submitting' ? 'var(--bg)' : '#fff',
                    color: 'rgba(0,0,0,0.85)', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Description */}
              <div style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.55)', display: 'block', marginBottom: 4 }}>
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={phase === 'submitting'}
                  rows={6}
                  placeholder="Describe what happened, what you expected, and any steps to reproduce. The more detail, the faster we can fix it."
                  style={{
                    width: '100%', padding: '8px 10px',
                    fontSize: 12, border: 'var(--border2)',
                    borderRadius: 6, outline: 'none', resize: 'vertical',
                    background: phase === 'submitting' ? 'var(--bg)' : '#fff',
                    color: 'rgba(0,0,0,0.85)', fontFamily: 'var(--font)',
                    lineHeight: 1.5, boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{
                fontSize: 10, color: words >= MIN_WORDS ? 'var(--green)' : 'rgba(0,0,0,0.38)',
                marginBottom: 14, textAlign: 'right',
              }}>
                {words} / {MIN_WORDS} words minimum
              </div>

              {error && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10 }}>{error}</div>
              )}

              <button
                className="btn"
                onClick={handleSubmit}
                disabled={!isValid || phase === 'submitting'}
                style={{ width: '100%' }}
              >
                {phase === 'submitting' ? 'Sending…' : 'Send Report'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
