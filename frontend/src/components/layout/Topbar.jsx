import { useState, useEffect, useRef } from 'react';
import Ic from '../ui/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import useSearch from '../../hooks/useSearch.js';
import useNotifications from '../../hooks/useNotifications.js';
import SearchDropdown from './SearchDropdown.jsx';
import BugReportModal from './BugReportModal.jsx';

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

function getInitials(user) {
  if (!user) return '?';
  const first = (user.first_name || '').trim();
  const last = (user.last_name || '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (user.email) return user.email[0].toUpperCase();
  return '?';
}

export default function Topbar({ screen, setScreen }) {
  const { user, signOut } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [bugOpen, setBugOpen] = useState(false);

  const accountRef = useRef(null);
  const notifRef = useRef(null);
  const searchRef = useRef(null);

  const { results, loading: searchLoading } = useSearch(searchQuery);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  useEffect(() => {
    function handleMouseDown(e) {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setAccountOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    }
    if (accountOpen || notifOpen || searchOpen) {
      document.addEventListener('mousedown', handleMouseDown);
    }
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [accountOpen, notifOpen, searchOpen]);

  function handleSignOut() {
    signOut();
    window.location.href = '/login';
  }

  function handleSearchSelect(item) {
    if (item.screen && setScreen) {
      setScreen(item.screen);
    }
    setSearchOpen(false);
    setSearchQuery('');
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setSearchQuery('');
    }
  }

  function handleNotifClick(n) {
    markRead(n.id);
    if (n.link_screen && setScreen) {
      setScreen(n.link_screen);
    }
    setNotifOpen(false);
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

        {/* Search */}
        <div ref={searchRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {searchOpen ? (
            <div style={{ position: 'relative' }}>
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search…"
                style={{
                  width: 220,
                  height: 28,
                  padding: '0 10px',
                  fontSize: 12,
                  border: 'var(--border)',
                  borderRadius: 6,
                  outline: 'none',
                  background: 'var(--bg)',
                  color: 'rgba(0,0,0,0.85)',
                }}
              />
              <SearchDropdown
                results={results}
                loading={searchLoading}
                onSelect={handleSearchSelect}
              />
            </div>
          ) : (
            <div
              className="topbar-icon-btn"
              onClick={() => setSearchOpen(true)}
            >
              <Ic n="search" s={14} />
            </div>
          )}
        </div>

        {/* Notifications bell */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <div
            className="topbar-icon-btn"
            style={{ position: 'relative' }}
            onClick={() => { setNotifOpen(o => !o); setAccountOpen(false); }}
          >
            <Ic n="bell" s={14} />
            {unreadCount > 0 && <div className="notif-dot" />}
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
                <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button>
              </div>
              {/* Notification items */}
              {notifications.length === 0 && (
                <div style={{ padding: '16px', fontSize: 12, color: 'rgba(0,0,0,0.45)', textAlign: 'center' }}>
                  No notifications
                </div>
              )}
              {notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
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
                    background: !n.read ? '#dd5b00' : 'rgba(0,0,0,0.2)',
                    flexShrink: 0,
                    marginTop: 4,
                  }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.85)' }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{n.body}</div>
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

        {/* Report bug */}
        <div
          className="topbar-icon-btn"
          onClick={() => { setBugOpen(true); setNotifOpen(false); setAccountOpen(false); }}
          title="Report a bug"
        >
          <Ic n="alert-tri" s={14} />
        </div>
        <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} screen={screen} />

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
