export function Badge({ children, color = 'secondary' }) {
  const colors = {
    success:   { background: 'rgba(47,179,135,0.12)', color: '#1a9c6e' },
    danger:    { background: 'rgba(214,57,57,0.12)',  color: '#c0392b' },
    warning:   { background: 'rgba(240,173,78,0.14)', color: '#b07d0a' },
    info:      { background: 'rgba(26,117,187,0.12)', color: '#1a75bb' },
    secondary: { background: 'rgba(0,0,0,0.07)',      color: 'rgba(0,0,0,0.5)' },
    navy:      { background: 'rgba(26,45,74,0.1)',    color: 'var(--navy)' },
  };
  const s = colors[color] || colors.secondary;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11,
      fontWeight: 600, ...s,
    }}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div style={{ padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 13, textAlign: 'center' }}>
      Loading…
    </div>
  );
}

export function EmptyState({ icon = '—', message }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>{icon}</div>
      {message}
    </div>
  );
}

export function ErrorMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: 'rgba(214,57,57,0.08)', border: '1px solid rgba(214,57,57,0.18)',
      borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c0392b', marginBottom: 12,
    }}>{msg}</div>
  );
}

export function SuccessMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: 'rgba(47,179,135,0.08)', border: '1px solid rgba(47,179,135,0.2)',
      borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#1a9c6e', marginBottom: 12,
    }}>{msg}</div>
  );
}
