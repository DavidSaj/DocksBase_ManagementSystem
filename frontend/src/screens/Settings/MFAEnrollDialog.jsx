import { useState, useEffect } from 'react';
import api from '../../api.js';
import QRCode from 'qrcode';

export default function MFAEnrollDialog({ onClose, onEnrolled }) {
  const [enrollState, setEnrollState] = useState('start'); // 'start' | 'verify' | 'backup-codes'
  const [qrDataUrl, setQrDataUrl]     = useState('');
  const [secret, setSecret]           = useState('');
  const [enrollToken, setEnrollToken] = useState(null);
  const [code, setCode]               = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [loadingQr, setLoadingQr]     = useState(true);
  const [copiedCodes, setCopiedCodes] = useState(false);

  useEffect(() => {
    api.post('/security/mfa/start-enrollment/')
      .then(async ({ data }) => {
        setSecret(data.secret);
        setEnrollToken(data.qr_uri); // store for reference
        const dataUrl = await QRCode.toDataURL(data.qr_uri);
        setQrDataUrl(dataUrl);
        setLoadingQr(false);
        setEnrollState('verify');
      })
      .catch(err => {
        setError(err.response?.data?.detail || 'Failed to start enrollment.');
        setLoadingQr(false);
      });
  }, []);

  async function handleVerify(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/security/mfa/complete-enrollment/', { code });
      setBackupCodes(data.backup_codes || []);
      setEnrollState('backup-codes');
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.code || 'Invalid code.');
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    navigator.clipboard.writeText(backupCodes.join('\n')).catch(() => {});
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  }

  function downloadCodes() {
    const blob = new Blob([backupCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'docksbase-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDone() {
    onEnrolled?.();
    onClose?.();
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose?.()}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 440, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {enrollState === 'backup-codes' ? 'Save your backup codes' : 'Enable two-factor authentication'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.4)', lineHeight: 1 }}>×</button>
        </div>

        {/* Loading QR */}
        {loadingQr && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>
            Loading…
          </div>
        )}

        {/* Verify step */}
        {enrollState === 'verify' && !loadingQr && (
          <>
            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 16, lineHeight: 1.6 }}>
              Scan the QR code with Microsoft Authenticator, Google Authenticator, or Authy, then enter the 6-digit code below.
            </p>
            {qrDataUrl && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <img src={qrDataUrl} alt="QR code" style={{ width: 180, height: 180, borderRadius: 8 }} />
              </div>
            )}
            {secret && (
              <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 16, wordBreak: 'break-all', textAlign: 'center' }}>
                Or enter manually: <span style={{ fontFamily: 'monospace', color: 'rgba(0,0,0,0.65)' }}>{secret}</span>
              </p>
            )}
            <form onSubmit={handleVerify}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  required
                  autoFocus
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 7, fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.1em', boxSizing: 'border-box' }}
                />
              </div>
              {error && <p style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }} disabled={loading}>
                  {loading ? 'Verifying…' : 'Verify & enable'}
                </button>
              </div>
            </form>
          </>
        )}

        {/* Backup codes step */}
        {enrollState === 'backup-codes' && (
          <>
            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 16, lineHeight: 1.6 }}>
              MFA is now enabled. Store these backup codes somewhere safe — each can be used once if you lose access to your authenticator app.
            </p>
            <div style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg)', borderRadius: 7, padding: '14px 16px', lineHeight: 2, marginBottom: 14 }}>
              {backupCodes.map(c => <div key={c}>{c}</div>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={copyAll}>
                {copiedCodes ? 'Copied!' : 'Copy all'}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={downloadCodes}>Download</button>
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleDone}>
              I saved these — done
            </button>
          </>
        )}

        {/* Error with no QR (enrollment start failed) */}
        {error && loadingQr === false && enrollState === 'start' && (
          <p style={{ color: '#dc2626', fontSize: 12 }}>{error}</p>
        )}
      </div>
    </div>
  );
}
