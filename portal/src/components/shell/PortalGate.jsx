import { useState, useEffect } from 'react';
import { useTenant } from '@docksbase/portal-ui/context/TenantContext';
import api from '@docksbase/portal-ui/api';
import AppShell from './AppShell';
import LoginScreen from '@docksbase/portal-ui/screens/LoginScreen';

export default function PortalGate() {
  const { marina, isLoading } = useTenant();
  const [state, setState] = useState('idle'); // 'idle' | 'verifying' | 'error'
  const [tokenError, setTokenError] = useState(null);

  const params   = new URLSearchParams(window.location.search);
  const rawToken = params.get('token');

  useEffect(() => {
    if (!rawToken) return;
    let cancelled = false;
    setState('verifying');

    const isMember = rawToken.startsWith('m_');
    const isGuest  = rawToken.startsWith('g_');
    if (!isMember && !isGuest) {
      setTokenError('This link has expired or is invalid.');
      setState('error');
      return;
    }
    const token = rawToken.slice(2);
    if (!token) {
      setTokenError('This link has expired or is invalid.');
      setState('error');
      return;
    }
    const endpoint = isMember
      ? '/portal/auth/member-magic/verify/'
      : '/portal/checkin/auth/magic/';

    api.post(endpoint, { token })
      .then(res => {
        if (cancelled) return;
        const data = res.data;
        if (isMember) {
          localStorage.setItem('portal_session_token', data.session_token);
          localStorage.setItem('portal_refresh_token', data.refresh_token);
          localStorage.setItem('portal_token_type',    'member');
          localStorage.setItem('portal_marina_slug',   data.marina_slug);
        } else {
          localStorage.setItem('portal_session_token', data.token);
          localStorage.setItem('portal_token_type',    'guest');
          localStorage.setItem('portal_booking_id',    String(data.booking_id));
          localStorage.setItem('portal_marina_slug',   data.marina_slug);
        }
        window.location.replace(`/${data.marina_slug}/`);
      })
      .catch(() => {
        if (cancelled) return;
        setTokenError('This link has expired or is invalid.');
        setState('error');
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'verifying') {
    return (
      <div className="p-login" style={{ justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          Signing you in…
        </div>
      </div>
    );
  }

  const sessionToken = localStorage.getItem('portal_session_token');
  if (sessionToken && state !== 'error') return <AppShell initialTab="home" />;

  if (isLoading) {
    return (
      <div className="p-login" style={{ justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!marina) {
    return (
      <div className="p-login">
        <div className="p-login__marina-name" style={{ color: 'var(--cream)' }}>
          Marina not found.
        </div>
      </div>
    );
  }

  return <LoginScreen marina={marina} tokenError={tokenError} />;
}
