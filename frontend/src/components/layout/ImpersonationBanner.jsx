import { clearAuth } from '../../api.js';

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return {};
  }
}

export default function ImpersonationBanner() {
  const token = localStorage.getItem('access_token');
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload.is_safe_mode) return null;

  const adminUrl = import.meta.env.VITE_ADMIN_URL || 'http://localhost:5174';

  function exitSession() {
    clearAuth();
    window.location.href = adminUrl;
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: '#DC2626', color: '#fff',
      padding: '8px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 13, fontWeight: 600,
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      <span>⚠ IMPERSONATING {payload.impersonated_marina} — ALL ACTIONS ARE AUDITED</span>
      <button
        onClick={exitSession}
        style={{
          background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff', padding: '4px 14px', borderRadius: 4, cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
        }}
      >
        Exit Session
      </button>
    </div>
  );
}
