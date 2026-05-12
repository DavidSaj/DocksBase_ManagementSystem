const TITLE_MAP = {
  overview: 'Overview', financials: 'Financials', marinas: 'Marinas',
  staff: 'Staff', settings: 'Settings',
};

export default function Topbar({ screen, group }) {
  const now = new Date();
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        <span>Enterprise</span>
        {group && <><span style={{ opacity: 0.4 }}> / </span><span style={{ opacity: 0.55 }}>{group.name}</span></>}
        <span style={{ opacity: 0.4 }}> / </span>
        <b>{TITLE_MAP[screen] || screen}</b>
      </div>
      <div className="topbar-actions">
        <div className="topbar-date">{dateStr}</div>
        {group && (
          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', background: 'var(--bg)', padding: '3px 8px', borderRadius: 9999, border: 'var(--border2)' }}>
            {group.base_currency} · {group.marina_count} marina{group.marina_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
