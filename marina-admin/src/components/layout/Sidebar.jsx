import Ic from '../ui/Icon.jsx';

const NAV = [
  { id: 'overview',   icon: 'grid',     label: 'Overview' },
  { id: 'financials', icon: 'dollar',   label: 'Financials' },
  { id: 'marinas',    icon: 'anchor',   label: 'Marinas' },
  { id: 'staff',      icon: 'users',    label: 'Staff' },
  { id: 'settings',   icon: 'settings', label: 'Settings' },
];

export default function Sidebar({ screen, setScreen, onLogout, group }) {
  return (
    <aside className="sb">
      <div className="sb-logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/>
          <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 3 }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontWeight: 600, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: '#fff' }}>DOCKS</span>
          <span style={{ fontFamily: 'var(--font-brand)', fontWeight: 300, fontSize: 11, letterSpacing: 3, color: 'var(--gold)' }}>Base</span>
        </div>
      </div>

      {group && (
        <div className="sb-env">
          <div className="sb-env-label">Enterprise</div>
          <div className="sb-env-desc">{group.name}</div>
        </div>
      )}

      <div className="sb-section">
        {NAV.map(item => (
          <div
            key={item.id}
            className={`sb-item${screen === item.id ? ' active' : ''}`}
            onClick={() => setScreen(item.id)}
          >
            <Ic n={item.icon} s={14} />
            {item.label}
          </div>
        ))}
      </div>

      <div className="sb-bottom">
        <div className="sb-item" onClick={onLogout}>
          <Ic n="log-out" s={14} />
          Sign out
        </div>
      </div>
    </aside>
  );
}
