import { useState } from 'react';
import useMarina from '../../../hooks/useMarina.js';
import { SecHdr } from '../shared.jsx';

const PORTAL_URL = import.meta.env.VITE_PORTAL_URL || 'https://booking.docksbase.com';

export default function ShareEmbedTab() {
  const { marina } = useMarina();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  if (!marina?.slug) {
    return (
      <div>
        <SecHdr title="Share & Embed" />
        <div style={{ padding: 20, color: 'rgba(0,0,0,0.5)' }}>Marina not loaded yet.</div>
      </div>
    );
  }

  const url = `${PORTAL_URL}/${marina.slug}/activities`;
  const iframe = `<iframe src="${url}" width="100%" height="700" frameborder="0"></iframe>`;

  function copy(text, setter) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true);
      setTimeout(() => setter(false), 1500);
    });
  }

  return (
    <div>
      <SecHdr title="Share & Embed" />
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)', marginBottom: 6,
        }}>
          Direct link
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ flex: 1, wordBreak: 'break-all', fontSize: 13, color: 'var(--teal)' }}
          >
            {url}
          </a>
          <button className="btn btn-ghost btn-sm" onClick={() => copy(url, setCopiedUrl)}>
            {copiedUrl ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)', marginBottom: 6,
        }}>
          Embed on your website
        </div>
        <div style={{ position: 'relative' }}>
          <pre style={{
            fontSize: 11, background: 'var(--bg)', borderRadius: 6,
            padding: '10px 12px', margin: 0, whiteSpace: 'pre-wrap',
            wordBreak: 'break-all', fontFamily: 'monospace',
            border: 'var(--border)',
          }}>
            {iframe}
          </pre>
          <button
            className="btn btn-ghost btn-sm"
            style={{ position: 'absolute', top: 6, right: 6, fontSize: 11 }}
            onClick={() => copy(iframe, setCopiedEmbed)}
          >
            {copiedEmbed ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 6 }}>
          Paste this snippet into any page on your website. The booking form will load inline.
          Contact us if you want a custom domain (e.g. activities.yourmarina.com).
        </div>
      </div>
    </div>
  );
}
