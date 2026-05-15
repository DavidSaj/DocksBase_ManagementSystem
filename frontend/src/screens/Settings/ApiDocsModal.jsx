import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import MarkdownView from './MarkdownView.jsx';

export default function ApiDocsModal({ onClose }) {
  const [markdown, setMarkdown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/api-keys/docs/')
      .then(r => setMarkdown(r.data.markdown))
      .catch(() => setError('Could not load documentation.'))
      .finally(() => setLoading(false));
  }, []);

  // Close on Esc
  const handleKeyDown = useCallback(e => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#fff', borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid rgba(0,0,0,0.08)', flexShrink: 0,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>API Documentation</div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '4px 10px', fontSize: 16, lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Body — scrollable */}
        <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ color: 'var(--red, #c0392b)', fontSize: 13 }}>{error}</div>
          )}
          {markdown && <MarkdownView source={markdown} />}
        </div>
      </div>
    </div>
  );
}
