import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { verifyEmail } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyEmail() {
  const { token }         = useParams();
  const [status, setStatus] = useState('loading');
  const navigate          = useNavigate();
  const { signIn }        = useAuth();

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    verifyEmail(token)
      .then(user => {
        signIn(user);
        navigate('/', { replace: true });
      })
      .catch(() => setStatus('error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/>
            <line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <span className="login-brand">DockBase</span>
        </div>

        {status === 'loading' && (
          <>
            <h2 className="login-title">Verifying your email…</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', textAlign: 'center' }}>Just a moment.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className="login-title">Link expired</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20, lineHeight: 1.5, textAlign: 'center' }}>
              This verification link has expired or has already been used. Go back to sign in and use the resend option to get a fresh link.
            </p>
            <Link to="/login" className="abtn abtn-primary login-submit" style={{ textAlign: 'center', display: 'block' }}>
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
