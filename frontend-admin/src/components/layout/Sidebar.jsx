import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/',        label: 'Dashboard' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/finance',  label: 'Finance' },
  { to: '/flags',    label: 'Feature Flags' },
  { to: '/audit',    label: 'Audit Log' },
];

const sidebarStyle = {
  width: 200, minHeight: '100vh', background: '#1a1a2e', padding: '24px 0',
  display: 'flex', flexDirection: 'column',
};

const linkStyle = ({ isActive }) => ({
  display: 'block', padding: '10px 24px', color: isActive ? '#fff' : 'rgba(255,255,255,0.6)',
  textDecoration: 'none', fontSize: 14, fontWeight: isActive ? 600 : 400,
  background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
});

export default function Sidebar({ onSignOut }) {
  return (
    <nav style={sidebarStyle}>
      <div style={{ padding: '0 24px 24px', color: '#fff', fontWeight: 700, fontSize: 15 }}>
        DocksBase Admin
      </div>
      {NAV.map(({ to, label }) => (
        <NavLink key={to} to={to} end={to === '/'} style={linkStyle}>{label}</NavLink>
      ))}
      <div style={{ marginTop: 'auto', padding: '0 24px' }}>
        <button
          onClick={onSignOut}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
