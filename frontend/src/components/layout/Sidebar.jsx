import { useState, useEffect, useRef } from 'react';
import Ic from '../ui/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import useMarina from '../../hooks/useMarina.js';
import useSidebarCounts from '../../hooks/useSidebarCounts.js';

// Items with a `flag` key are hidden unless marina.features[flag] is true.
export const NAV = [
  { group: 'Daily Operations', items: [
    { id: 'overview',        icon: 'grid',       label: 'Overview' },
    { id: 'map',             icon: 'map',        label: 'Harbour' },
    { id: 'reservations',    icon: 'calendar',   label: 'Reservations' },
    { id: 'billing',         icon: 'dollar',     label: 'Billing & POS', alert: true },
    { id: 'operations',      icon: 'zap',        label: 'Operations' },
  ]},
  { group: 'Directory', items: [
    { id: 'members',         icon: 'users',      label: 'Members' },
    { id: 'vessels',         icon: 'ship',       label: 'Vessels' },
    { id: 'documents',       icon: 'clipboard',  label: 'Documents & eSign' },
  ]},
  { group: 'Yard & Services', items: [
    { id: 'boatyard',        icon: 'crane',      label: 'Boatyard' },
    { id: 'maintenance',     icon: 'wrench',     label: 'Maintenance' },
    { id: 'restaurant',      icon: 'utensils',   label: 'Restaurant',    flag: 'restaurant' },
    { id: 'events',          icon: 'star',       label: 'Events',        flag: 'events' },
  ]},
  { group: 'Management & Data', items: [
    { id: 'infrastructure',  icon: 'layers',     label: 'Harbor Infrastructure' },
    { id: 'channels',        icon: 'share-2',    label: 'Channels' },
    { id: 'staff',           icon: 'user-check', label: 'Staff' },
    { id: 'reports',         icon: 'chart',      label: 'Reports' },
  ]},
  { group: 'Master Data', items: [
    { id: 'service-catalog', icon: 'tag',        label: 'Service Catalog' },
  ]},
  { group: 'System', items: [
    { id: 'settings',        icon: 'settings',   label: 'Settings' },
  ]},
];

function getInitials(user) {
  if (!user) return '?';
  const first = (user.first_name || '').trim();
  const last = (user.last_name || '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (user.email) return user.email[0].toUpperCase();
  return '?';
}

function getDisplayName(user) {
  if (!user) return 'Unknown User';
  const first = (user.first_name || '').trim();
  const last = (user.last_name || '').trim();
  if (first && last) return `${first[0]}. ${last}`;
  if (first) return first;
  return user.email || 'Unknown User';
}

function getRoleLabel(role) {
  if (!role) return '';
  const map = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };
  return map[role] || role;
}

function canAccess(user, moduleId) {
  if (!user || user.role === 'owner' || user.role === 'manager') return true;
  if (user.role !== 'staff') return false;
  if (moduleId === 'settings') return false; // settings always owner/manager only
  if (moduleId === 'channels') return false; // channels owner/manager only
  const perms = user.module_permissions ?? {};
  if (Object.keys(perms).length === 0) return true; // no restrictions set — allow all
  return perms[moduleId] !== false;
}

export default function Sidebar({ screen, setScreen }) {
  const { user, signOut } = useAuth();
  const { marina } = useMarina();
  const features = marina?.features ?? {};
  const counts = useSidebarCounts();
  const LIVE_COUNTS = {
    reservations: counts.reservations,
    maintenance:  counts.maintenance,
    billing:      counts.billing,
  };
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleMouseDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleMouseDown);
    }
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  function handleSignOut() {
    signOut();
    window.location.href = '/login';
  }

  const initials = getInitials(user);
  const displayName = getDisplayName(user);
  const roleLabel = getRoleLabel(user?.role);
  const email = user?.email || '';

  return (
    <aside className="sb">
      <div className="sb-logo">
        <svg className="sb-logo-icon" width="24" height="24" viewBox="0 0 100 100" fill="none">
          <path d="M 42.2,10.8 L 46.9,10.1 L 47.7,4.1 L 52.3,4.1 L 53.1,10.1 A 40 40 0 0 1 57.8,10.8 L 62.4,12.0 L 65.4,6.7 L 69.7,8.5 L 68.2,14.4 A 40 40 0 0 1 72.2,16.7 L 76.0,19.6 L 80.8,15.9 L 84.1,19.2 L 80.4,24.0 A 40 40 0 0 1 83.3,27.8 L 85.6,31.8 L 91.5,30.3 L 93.3,34.6 L 88.0,37.6 A 40 40 0 0 1 89.2,42.2 L 89.9,46.9 L 95.9,47.7 L 95.9,52.3 L 89.9,53.1 A 40 40 0 0 1 89.2,57.8 L 88.0,62.4 L 93.3,65.4 L 91.5,69.7 L 85.6,68.2 A 40 40 0 0 1 83.3,72.2 L 80.4,76.0 L 84.1,80.8 L 80.8,84.1 L 76.0,80.4 A 40 40 0 0 1 72.2,83.3 L 68.2,85.6 L 69.7,91.5 L 65.4,93.3 L 62.4,88.0 A 40 40 0 0 1 57.8,89.2 L 53.1,89.9 L 52.3,95.9 L 47.7,95.9 L 46.9,89.9 A 40 40 0 0 1 42.2,89.2 L 37.6,88.0 L 34.6,93.3 L 30.3,91.5 L 31.8,85.6 A 40 40 0 0 1 27.8,83.3 L 24.0,80.4 L 19.2,84.1 L 15.9,80.8 L 19.6,76.0 A 40 40 0 0 1 16.7,72.2 L 14.4,68.2 L 8.5,69.7 L 6.7,65.4 L 12.0,62.4 A 40 40 0 0 1 10.8,57.8 L 10.1,53.1 L 4.1,52.3 L 4.1,47.7 L 10.1,46.9 A 40 40 0 0 1 10.8,42.2 L 12.0,37.6 L 6.7,34.6 L 8.5,30.3 L 14.4,31.8 A 40 40 0 0 1 16.7,27.8 L 19.6,24.0 L 15.9,19.2 L 19.2,15.9 L 24.0,19.6 A 40 40 0 0 1 27.8,16.7 L 31.8,14.4 L 30.3,8.5 L 34.6,6.7 L 37.6,12.0 A 40 40 0 0 1 42.2,10.8 Z"
            stroke="rgba(255,255,255,0.92)" strokeWidth="3" fill="none" strokeLinejoin="round"/>
          <circle cx="50" cy="50" r="36" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" fill="none"/>
          <path d="M 50.0,22.0 L 54.5,50.0 L 50.0,46.0 L 45.5,50.0 Z" fill="#b8965a" stroke="#b8965a" strokeWidth="1" strokeLinejoin="round"/>
          <path d="M 50.0,78.0 L 45.5,50.0 L 50.0,54.0 L 54.5,50.0 Z" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M 69.0,50.0 L 50.0,53.5 L 53.0,50.0 L 50.0,46.5 Z" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M 31.0,50.0 L 50.0,46.5 L 47.0,50.0 L 50.0,53.5 Z" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5" strokeLinejoin="round"/>
          <circle cx="50" cy="50" r="3.5" fill="#b8965a"/>
        </svg>
        <div style={{ width: '1px', height: '30px', background: 'rgba(255,255,255,0.18)', flexShrink: 0, margin: '0 2px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: '3px' }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontWeight: 600, fontSize: '11px', letterSpacing: '3px', textTransform: 'uppercase', color: '#fff' }}>DOCKS</span>
          <span style={{ fontFamily: 'var(--font-brand)', fontWeight: 300, fontSize: '11px', letterSpacing: '3px', color: '#c9a84c' }}>Base</span>
        </div>
      </div>

      <div className="sb-marina">
        <div className="sb-marina-name">{marina?.name ?? '…'}</div>
        <div className="sb-marina-sub">{marina?.total_berths != null ? `${marina.total_berths} active berths` : ''}</div>
      </div>

      <div className="sb-nav">
        {NAV.map(group => {
          const visibleItems = group.items.filter(item =>
            (!item.flag || features[item.flag]) && canAccess(user, item.id)
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.group} className="sb-section">
              <div className="sb-section-label">{group.group}</div>
              {visibleItems.map(item => (
                <div
                  key={item.id}
                  className={`sb-item${screen === item.id ? ' active' : ''}`}
                  onClick={() => setScreen(item.id)}
                >
                  <Ic n={item.icon} s={14} />
                  {item.label}
                  {(() => {
                    const live = LIVE_COUNTS[item.id];
                    const display = live != null ? live : item.count;
                    return display != null && display > 0 ? (
                      <span className={`sb-badge${item.alert ? ' alert' : ''}`}>{display}</span>
                    ) : null;
                  })()}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="sb-bottom">
        <div style={{ position: 'relative' }} ref={wrapperRef}>
          {open && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              minWidth: 200,
              background: '#fff',
              borderRadius: 8,
              boxShadow: 'var(--shadow2)',
              border: 'var(--border)',
              zIndex: 200,
              overflow: 'hidden',
              marginBottom: 4,
            }}>
              <div style={{ padding: '10px 14px', borderBottom: 'var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.85)' }}>{user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || email : 'Unknown'}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{email}</div>
              </div>
              <div
                onClick={handleSignOut}
                style={{ padding: '10px 14px', fontSize: 12, cursor: 'pointer', color: 'rgba(0,0,0,0.75)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Log out
              </div>
            </div>
          )}
          <div className="sb-user" onClick={() => setOpen(o => !o)}>
            <div className="avatar">{initials}</div>
            <div className="sb-user-info">
              <div className="sb-user-name">{displayName}</div>
              <div className="sb-user-role">{roleLabel}</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
