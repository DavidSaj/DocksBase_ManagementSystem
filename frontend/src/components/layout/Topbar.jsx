import { useState, useEffect, useRef } from 'react';
import Ic from '../ui/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const TITLE_MAP = {
  overview:     'Overview',
  map:          'Harbour',
  reservations: 'Reservations',
  vessels:      'Vessel Registry',
  boatyard:     'Boatyard',
  maintenance:  'Maintenance',
  staff:        'Staff & Rota',
  billing:      'Billing',
  reports:      'Reports & Analytics',
  members:      'Members & Owners',
  restaurant:   'Restaurant',
  events:       'Events & Venue Hire',
  settings:     'Settings',
  documents:    'Documents & eSign',
  sales:        'Boat Sales & Brokerage',
};

const MOCK_NOTIFS = [
  { id: 1, title: 'New reservation request', sub: 'Vessel Lady K, 3 nights from 4 May', unread: true },
  { id: 2, title: 'Invoice overdue', sub: 'INV-0042 — €1,840 — 5 days overdue', unread: true },
  { id: 3, title: 'Maintenance task completed', sub: 'Engine room bilge pump serviced', unread: false },
  { id: 4, title: 'Fuel dock: low stock alert', sub: 'Diesel below 500L threshold', unread: true },
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

export default function Topbar({ screen }) {
  const { user, signOut } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const accountRef = useRef(null);
  const notifRef = useRef(null);

  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} · ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  useEffect(() => {
    function handleMouseDown(e) {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setAccountOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    }
    if (accountOpen || notifOpen) {
      document.addEventListener('mousedown', handleMouseDown);
    }
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [accountOpen, notifOpen]);

  function handleSignOut() {
    signOut();
    window.location.href = '/login';
  }

  const initials = getInitials(user);
  const email = user?.email || '';
  const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || email : 'Unknown';

  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        <span>Harwich Marina</span>
        <span style={{ opacity: 0.4 }}> / </span>
        <b>{TITLE_MAP[screen] || screen}</b>
      </div>
      <div className="topbar-actions">
        <div className="topbar-date">{dateStr}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
          <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', fontWeight: 500 }}>All systems normal</span>
        </div>

        {/* Search button */}
        <div className="topbar-icon-btn" onClick={() => alert('Search coming soon')}>
          <Ic n="search" s={14} />
        </div>

        {/* Notifications bell */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <div
            className="topbar-icon-btn"
            style={{ position: 'relative' }}
            onClick={() => { setNotifOpen(o => !o); setAccountOpen(false); }}
          >
            <Ic n="bell" s={14} />
            <div className="notif-dot" />
          </div>
          {notifOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              width: 320,
              background: '#fff',
              border: 'var(--border)',
              borderRadius: 10,
              boxShadow: 'var(--shadow2)',
              zIndex: 200,
              overflow: 'hidden',
              marginTop: 6,
            }}>
              {/* Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: 'var(--border)',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
                <button className="btn btn-ghost btn-sm">Mark all read</button>
              </div>
              {/* Notification items */}
              {MOCK_NOTIFS.map(n => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 16px',
                    borderBottom: 'var(--border)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: n.unread ? '#dd5b00' : 'rgba(0,0,0,0.2)',
                    flexShrink: 0,
                    marginTop: 4,
                  }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.85)' }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{n.sub}</div>
                  </div>
                </div>
              ))}
              {/* Footer */}
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  padding: 10,
                  cursor: 'pointer',
                  color: 'var(--navy)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                View all notifications
              </div>
            </div>
          )}
        </div>

        {/* Account avatar */}
        <div style={{ position: 'relative' }} ref={accountRef}>
          <div
            className="avatar"
            style={{ background: 'var(--navy)', border: '1.5px solid rgba(0,0,0,0.1)', color: '#fff', cursor: 'pointer' }}
            onClick={() => { setAccountOpen(o => !o); setNotifOpen(false); }}
          >
            {initials}
          </div>
          {accountOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              minWidth: 200,
              background: '#fff',
              borderRadius: 8,
              boxShadow: 'var(--shadow2)',
              border: 'var(--border)',
              zIndex: 200,
              overflow: 'hidden',
              marginTop: 6,
            }}>
              <div style={{ padding: '10px 14px', borderBottom: 'var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.85)' }}>{fullName}</div>
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
        </div>
      </div>
    </div>
  );
}
