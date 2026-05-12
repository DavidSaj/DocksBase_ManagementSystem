const NAV = '#1a2d4a';

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.ceil((parseLocalDate(dateStr) - today) / 86400000);
}

function nightsBetween(checkIn, checkOut) {
  return Math.round((parseLocalDate(checkOut) - parseLocalDate(checkIn)) / 86400000);
}

function DateBlock({ label, dateStr }) {
  const d = parseLocalDate(dateStr);
  const dow = d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
  const day = d.getDate();
  const mon = d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
  const yr  = d.getFullYear();
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>{dow}</div>
      <div style={{ fontSize: 40, fontWeight: 800, color: NAV, lineHeight: 1 }}>{day}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginTop: 4 }}>{mon} {yr}</div>
    </div>
  );
}

function NightsBadge({ nights }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 12px' }}>
      <div style={{ width: 1, height: 16, background: 'rgba(0,0,0,0.12)' }} />
      <div style={{ margin: '6px 0', background: '#f0f3f7', borderRadius: 20, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>
        {nights} {nights === 1 ? 'night' : 'nights'}
      </div>
      <div style={{ width: 1, height: 16, background: 'rgba(0,0,0,0.12)' }} />
    </div>
  );
}

const icons = {
  phone: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
    </svg>
  ),
  email: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  ),
  radio: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 010 8.49m-8.48-.01a6 6 0 010-8.49m11.31-2.82a10 10 0 010 14.14m-14.14 0a10 10 0 010-14.14"/>
    </svg>
  ),
  clock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  map: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  ),
  globe: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
    </svg>
  ),
};

function InfoRow({ icon, children, href }) {
  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
      <span style={{ color: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13, color: href ? NAV : 'rgba(0,0,0,0.65)', fontWeight: href ? 600 : 400 }}>{children}</span>
    </div>
  );
  if (href) return <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={{ textDecoration: 'none', display: 'block' }}>{inner}</a>;
  return inner;
}

export default function CountdownView({ booking }) {
  const days   = daysUntil(booking.check_in);
  const nights = nightsBetween(booking.check_in, booking.check_out);
  const firstName = booking.guest_name?.split(' ')[0] || 'there';
  const info = booking.marina_info || {};

  const hasDims = booking.boat_loa != null && booking.boat_beam != null && booking.boat_draft != null;
  const phone = info.harbour_master_phone || info.phone;
  const mapsUrl = info.lat && info.lng ? `https://www.google.com/maps?q=${info.lat},${info.lng}` : null;
  const hasInfo = phone || info.contact_email || info.website || info.vhf_channel || info.office_hours || mapsUrl;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ background: NAV, padding: '24px 20px 20px', color: '#fff' }}>
        <div style={{ fontSize: 21, fontWeight: 700 }}>All set, {firstName}!</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 3 }}>
          {booking.marina_name || 'Your marina'} is ready for you
        </div>
      </div>

      {/* Countdown pill */}
      <div style={{ margin: '16px 16px 0', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          background: NAV, color: '#fff', borderRadius: 32,
          padding: '10px 24px', fontSize: 14, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{days}</span>
          <span style={{ opacity: 0.8 }}>{days === 1 ? 'day until arrival' : 'days until arrival'}</span>
        </div>
      </div>

      {/* Dates card */}
      <div style={{ margin: '12px 16px 0', background: '#fff', borderRadius: 16, padding: '20px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <DateBlock label="ARRIVAL" dateStr={booking.check_in} />
          <NightsBadge nights={nights} />
          <DateBlock label="DEPARTURE" dateStr={booking.check_out} />
        </div>
      </div>

      {/* Berth */}
      <div style={{ margin: '12px 16px 0', background: '#fff', borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Your Berth</div>
        {booking.berth_code
          ? <div style={{ fontSize: 22, fontWeight: 800, color: NAV }}>{booking.berth_pier} · {booking.berth_code}</div>
          : <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.4)' }}>Will be confirmed before arrival</div>
        }
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: NAV, fontWeight: 600, textDecoration: 'none' }}>
            {icons.map} Get directions to marina
          </a>
        )}
      </div>

      {/* Marina info card */}
      {hasInfo && (
        <div style={{ margin: '12px 16px 0', background: '#fff', borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Marina Contact</div>
          {phone && <InfoRow icon={icons.phone} href={`tel:${phone}`}>{phone}</InfoRow>}
          {info.contact_email && <InfoRow icon={icons.email} href={`mailto:${info.contact_email}`}>{info.contact_email}</InfoRow>}
          {info.website && <InfoRow icon={icons.globe} href={info.website}>{info.website.replace(/^https?:\/\//, '')}</InfoRow>}
          {info.vhf_channel && <InfoRow icon={icons.radio}>VHF Channel {info.vhf_channel}</InfoRow>}
          {info.office_hours && <InfoRow icon={icons.clock}>{info.office_hours}</InfoRow>}
        </div>
      )}

      {/* Vessel summary */}
      {hasDims && (
        <div style={{ margin: '12px 16px 0', background: '#fff', borderRadius: 16, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Vessel</div>
          <div style={{ display: 'flex' }}>
            {[['LOA', booking.boat_loa + 'm'], ['Beam', booking.boat_beam + 'm'], ['Draft', booking.boat_draft + 'm']].map(([k, v], i, arr) => (
              <div key={k} style={{ flex: 1, textAlign: 'center', borderRight: i < arr.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: NAV }}>{v}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{k}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pre-arrival complete badge */}
      <div style={{ margin: '12px 16px 0', background: '#eaf7ef', borderRadius: 16, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e7e42' }}>Pre-arrival checklist complete</div>
          <div style={{ fontSize: 12, color: '#27ae60', marginTop: 1, opacity: 0.8 }}>You're ready to go</div>
        </div>
      </div>

    </div>
  );
}
