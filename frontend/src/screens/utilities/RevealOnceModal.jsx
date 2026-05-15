import { useState } from 'react';

export default function RevealOnceModal({ title, secrets, onClose }) {
  const [revealed, setRevealed] = useState({});

  function copy(text) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: '#fff', borderRadius: 10, width: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
           onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: 'var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#b07d0a', marginTop: 4 }}>
            ⚠ Save this now — it will not be shown again.
          </div>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {secrets.map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{s.label}</div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg)', borderRadius: 6, padding: '8px 10px',
                fontFamily: 'monospace', fontSize: 12,
              }}>
                <span style={{ flex: 1, wordBreak: 'break-all' }}>
                  {revealed[s.label] ? s.value : '•'.repeat(Math.min(s.value.length, 32))}
                </span>
                {!revealed[s.label] && (
                  <button onClick={() => setRevealed(r => ({ ...r, [s.label]: true }))}
                          style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>
                    Reveal
                  </button>
                )}
                <button onClick={() => copy(s.value)}
                        style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>
                  Copy
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 20px', borderTop: 'var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
                  style={{ background: 'var(--navy)', color: '#fff', border: 'none',
                           borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            I have saved it
          </button>
        </div>
      </div>
    </div>
  );
}
