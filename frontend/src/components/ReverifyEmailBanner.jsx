import { useState, useEffect } from 'react';
import api from '../api.js';

export default function ReverifyEmailBanner() {
  const [warningShown, setWarningShown]   = useState(false);
  const [blockedModal, setBlockedModal]   = useState(false);
  const [emailSent, setEmailSent]         = useState(false);
  const [sending, setSending]             = useState(false);

  useEffect(() => {
    const onWarn  = () => setWarningShown(true);
    const onBlock = () => setBlockedModal(true);
    window.addEventListener('email-reverify-warning', onWarn);
    window.addEventListener('email-reverify-required', onBlock);
    return () => {
      window.removeEventListener('email-reverify-warning', onWarn);
      window.removeEventListener('email-reverify-required', onBlock);
    };
  }, []);

  async function sendReverify() {
    setSending(true);
    try {
      await api.post('/auth/reverify-email/request/');
      setEmailSent(true);
    } catch { /* ignore */ }
    finally { setSending(false); }
  }

  if (blockedModal) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(255,255,255,0.97)',
        zIndex: 99998,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          maxWidth: 440, padding: '40px 36px', textAlign: 'center',
          background: '#fff', borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>✉️</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Email verification required</div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 24, lineHeight: 1.7 }}>
            For your security, we need to confirm your email address periodically. Please check your inbox and click the verification link.
          </div>
          {emailSent ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#166534' }}>
              Verification email sent — check your inbox.
            </div>
          ) : (
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={sendReverify}
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send verification email'}
            </button>
          )}
          <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 20 }}>
            After clicking the link in the email, refresh this page to continue.
          </p>
        </div>
      </div>
    );
  }

  if (warningShown) {
    return (
      <div style={{
        background: '#fef9c3',
        border: '1px solid #fde047',
        borderRadius: 8,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: 12,
        margin: '0 0 8px 0',
        flexShrink: 0,
      }}>
        <span style={{ color: '#713f12', lineHeight: 1.5 }}>
          Your email hasn't been verified recently. Please re-verify to avoid being locked out.
        </span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {emailSent ? (
            <span style={{ color: '#166534', fontWeight: 600 }}>Email sent!</span>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={sendReverify}
              disabled={sending}
              style={{ whiteSpace: 'nowrap' }}
            >
              {sending ? 'Sending…' : 'Re-verify email'}
            </button>
          )}
          <button
            onClick={() => setWarningShown(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.35)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return null;
}
