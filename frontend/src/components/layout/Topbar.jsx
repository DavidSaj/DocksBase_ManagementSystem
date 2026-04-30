import Ic from '../ui/Icon.jsx';

const TITLE_MAP = {
  overview:     'Overview',
  map:          'Marina Map',
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

export default function Topbar({ screen }) {
  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} · ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

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
        <div className="topbar-icon-btn"><Ic n="search" s={14} /></div>
        <div className="topbar-icon-btn" style={{ position: 'relative' }}>
          <Ic n="bell" s={14} />
          <div className="notif-dot" />
        </div>
        <div className="avatar" style={{ background: 'var(--navy)', border: '1.5px solid rgba(0,0,0,0.1)', color: 'rgba(0,0,0,0.6)', cursor: 'pointer' }}>MH</div>
      </div>
    </div>
  );
}
