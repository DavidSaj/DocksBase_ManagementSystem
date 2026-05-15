import { useState, useEffect } from 'react';
import api from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import useMarina from '../../hooks/useMarina.js';
import MFAEnrollDialog from './MFAEnrollDialog.jsx';
import IPAllowlistEditor from './IPAllowlistEditor.jsx';
import AuditLogModal from './AuditLogModal.jsx';

// Local Toggle (mirrors the one in Settings.jsx)
function Toggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
        background: on ? 'var(--teal)' : 'rgba(0,0,0,0.15)',
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

function SectionRow({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
      {children}
    </div>
  );
}

export default function SecurityCard() {
  const { user } = useAuth();
  const { marina, updateMarina } = useMarina();
  const isOwner = user?.role === 'owner';

  // MFA status
  const [mfaStatus, setMfaStatus]     = useState(null);
  const [mfaLoading, setMfaLoading]   = useState(true);
  const [showEnroll, setShowEnroll]   = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError]       = useState('');
  const [disabling, setDisabling]             = useState(false);

  // Audit log
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => { fetchMfaStatus(); }, []);

  async function fetchMfaStatus() {
    setMfaLoading(true);
    try {
      const { data } = await api.get('/security/mfa/');
      setMfaStatus(data);
    } catch { /* ignore */ }
    finally { setMfaLoading(false); }
  }

  async function handleDisableMfa(e) {
    e.preventDefault();
    setDisableError('');
    setDisabling(true);
    try {
      await api.post('/security/mfa/disable/', { password: disablePassword });
      setMfaStatus(prev => ({ ...prev, enrolled: false, enrolled_at: null }));
      setShowDisable(false);
      setDisablePassword('');
    } catch (err) {
      setDisableError(err.response?.data?.detail || 'Incorrect password.');
    } finally {
      setDisabling(false);
    }
  }

  function handleMarinaToggle(field) {
    return (val) => {
      updateMarina({ [field]: val }).catch(() => {});
    };
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* MFA section — visible to all roles */}
        <SectionRow>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>Two-factor authentication</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>
              Authenticator app (TOTP) — works with Microsoft Authenticator, Google Authenticator, Authy
            </div>
          </div>
          {mfaLoading ? (
            <span className="badge badge-gray">Loading…</span>
          ) : mfaStatus?.enrolled ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-teal">Enabled</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDisable(true)}>Disable</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-gray">Not configured</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowEnroll(true)}>Enable MFA</button>
            </div>
          )}
        </SectionRow>

        {/* Owner-only sections */}
        {isOwner && (
          <>
            {/* Marina MFA policy */}
            <SectionRow>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Require MFA for managers</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>
                  Managers will be prompted to enrol during login if not already configured
                </div>
              </div>
              <Toggle
                on={!!marina?.require_mfa_for_managers}
                onChange={handleMarinaToggle('require_mfa_for_managers')}
              />
            </SectionRow>

            {/* IP Allowlist */}
            <div style={{ padding: '12px 14px', background: 'var(--bg)', borderRadius: 7 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>IP allowlist</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginBottom: 12 }}>
                Leave empty to allow all IPs. CIDR notation, e.g. 203.0.113.0/24. Owners can always delete entries.
              </div>
              <IPAllowlistEditor />
            </div>

            {/* Audit log */}
            <SectionRow>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Security audit log</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>
                  MFA, IP, password, email and API key events
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAudit(true)}>View log</button>
            </SectionRow>
          </>
        )}
      </div>

      {/* MFA Enroll Dialog */}
      {showEnroll && (
        <MFAEnrollDialog
          onClose={() => setShowEnroll(false)}
          onEnrolled={fetchMfaStatus}
        />
      )}

      {/* Disable MFA Dialog */}
      {showDisable && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setShowDisable(false)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Disable two-factor authentication</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 20 }}>
              Confirm your password to disable MFA. You can re-enable it at any time.
            </div>
            <form onSubmit={handleDisableMfa}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>
                  Password
                </label>
                <input
                  type="password"
                  value={disablePassword}
                  onChange={e => setDisablePassword(e.target.value)}
                  required
                  autoFocus
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid rgba(0,0,0,0.18)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
              {disableError && <p style={{ color: '#dc2626', fontSize: 12, marginBottom: 10 }}>{disableError}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowDisable(false)}>Cancel</button>
                <button type="submit" className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} disabled={disabling}>
                  {disabling ? 'Disabling…' : 'Disable MFA'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Audit Log Modal */}
      {showAudit && <AuditLogModal onClose={() => setShowAudit(false)} />}
    </>
  );
}
