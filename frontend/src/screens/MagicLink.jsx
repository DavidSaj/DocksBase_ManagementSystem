import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeMagicToken } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function MagicLink() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { signIn } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('No token found in the link. Ask the marina for a new one.');
      return;
    }

    exchangeMagicToken(token)
      .then(user => {
        signIn(user);
        // Redirect boaters to external portal URL
        window.location.href = import.meta.env.VITE_PORTAL_URL || 'https://booking.docksbase.com';
        return;
      })
      .catch(() => {
        setError('This link is invalid or has expired. Ask the marina to send a new one.');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
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
          <p style={{ fontSize: 14, color: '#cc2222', lineHeight: 1.5 }}>{error}</p>
        </div>
      </div>
    );
  }

  // Blank white with anchor icon — no flash of login
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a39e98" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="3"/>
        <line x1="12" y1="8" x2="12" y2="22"/>
        <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
      </svg>
    </div>
  );
}
