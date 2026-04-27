import Ic from '../ui/Icon.jsx';

const TITLE_MAP = {
  overview:      'Overview',
  marinas:       'Marinas',
  subscriptions: 'Subscriptions',
  finance:       'Finance',
  settings:      'Settings',
};

export default function Topbar({ screen }) {
  const now = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} · ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        <span>DocksBase Platform</span>
        <span style={{ opacity: 0.4 }}> / </span>
        <b>{TITLE_MAP[screen] || screen}</b>
      </div>
      <div className="topbar-actions">
        <div className="topbar-date">{dateStr}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
          <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', fontWeight: 500 }}>All systems normal</span>
        </div>
        <div className="topbar-icon-btn"><Ic n="bell" s={14} /></div>
        <div className="avatar" style={{ background: 'var(--navy)', border: '1.5px solid rgba(0,0,0,0.1)', color: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: 10 }}>SA</div>
      </div>
    </div>
  );
}
