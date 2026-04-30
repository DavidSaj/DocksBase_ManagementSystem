import { useState } from 'react';
import Ic from '../components/ui/Icon.jsx';

const RATE_PLANS = [
  { name: 'Standard Transient', base: '€12.00', unit: '/m/night', peak: '+25%', discount7: '5%', discount28: '15%' },
  { name: 'Seasonal Berth',     base: '€8.50',  unit: '/m/night', peak: '—',    discount7: '—',  discount28: '—' },
  { name: 'Superyacht Rate',    base: '€22.00', unit: '/m/night', peak: '+30%', discount7: '—',  discount28: '10%' },
];

const STAFF = [
  { initials: 'MH', name: 'M. Hargreaves', email: 'm.hargreaves@harwichmarina.com', role: 'Harbor Master',     status: 'active' },
  { initials: 'JD', name: 'J. Davies',     email: 'j.davies@harwichmarina.com',     role: 'Dock Master',       status: 'active' },
  { initials: 'SR', name: 'S. Richards',   email: 's.richards@harwichmarina.com',   role: 'Finance Officer',   status: 'active' },
  { initials: 'KP', name: 'K. Patel',      email: 'k.patel@harwichmarina.com',      role: 'Office Admin',      status: 'active' },
  { initials: 'TW', name: 'T. Walsh',      email: 't.walsh@harwichmarina.com',      role: 'Yard Supervisor',   status: 'inactive' },
];

const NOTIF_SETTINGS = [
  { group: 'Bookings',   items: [
    { label: 'New booking confirmation',       email: true,  sms: false },
    { label: 'Arrival reminder (24h before)',  email: true,  sms: true },
    { label: 'Departure reminder',             email: true,  sms: false },
    { label: 'Overstay alert',                 email: true,  sms: true },
  ]},
  { group: 'Payments', items: [
    { label: 'Invoice issued',                 email: true,  sms: false },
    { label: 'Payment received',               email: true,  sms: false },
    { label: 'Payment overdue (7 days)',        email: true,  sms: true },
    { label: 'Payment overdue (30 days)',       email: true,  sms: true },
  ]},
  { group: 'Operations', items: [
    { label: 'Critical defect logged',         email: true,  sms: true },
    { label: 'Incident reported',              email: true,  sms: false },
    { label: 'Document expiry (30 days)',       email: true,  sms: false },
    { label: 'Insurance expiry (30 days)',      email: true,  sms: true },
  ]},
];

function Toggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
        background: on ? 'var(--teal)' : 'rgba(0,0,0,0.15)',
        position: 'relative', transition: 'background 0.15s', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

function FieldRow({ label, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>{hint}</div>}
    </div>
  );
}

const FEATURE_FLAGS_INIT = {
  restaurant:  false,
  events:      false,
  portal:      true,
  ais:         false,
  multimarina: false,
};

export default function Settings() {
  const [tab, setTab] = useState('marina');
  const [notifs, setNotifs] = useState(NOTIF_SETTINGS);
  const [flags, setFlags] = useState(FEATURE_FLAGS_INIT);

  function toggleNotif(gi, ii, channel) {
    setNotifs(prev => prev.map((g, gIdx) => gIdx !== gi ? g : {
      ...g,
      items: g.items.map((item, iIdx) => iIdx !== ii ? item : { ...item, [channel]: !item[channel] }),
    }));
  }

  return (
    <div>
      <div className="tabs">
        {[['marina','Marina Profile'],['rates','Rate Plans'],['users','Users & Roles'],['notifications','Notifications'],['system','System']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {/* ── MARINA PROFILE ─────────────────────────────────────────── */}
      {tab === 'marina' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><div className="card-header-title">Marina Identity</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <FieldRow label="Marina Name">
                  <input type="text" defaultValue="Harwich Marina" />
                </FieldRow>
                <FieldRow label="Harbour Authority">
                  <input type="text" defaultValue="Harwich Haven Authority" />
                </FieldRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FieldRow label="Country">
                    <select defaultValue="GB">
                      <option value="GB">United Kingdom</option>
                      <option value="FR">France</option>
                      <option value="ES">Spain</option>
                      <option value="IT">Italy</option>
                      <option value="NL">Netherlands</option>
                    </select>
                  </FieldRow>
                  <FieldRow label="Time Zone">
                    <select defaultValue="Europe/London">
                      <option value="Europe/London">Europe/London (UTC+1)</option>
                      <option value="Europe/Paris">Europe/Paris (UTC+2)</option>
                      <option value="Europe/Madrid">Europe/Madrid (UTC+2)</option>
                    </select>
                  </FieldRow>
                </div>
                <FieldRow label="Address">
                  <input type="text" defaultValue="Ha'penny Pier, Harwich, Essex CO12 3HH" />
                </FieldRow>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FieldRow label="Latitude">
                    <input type="text" defaultValue="51.9458° N" />
                  </FieldRow>
                  <FieldRow label="Longitude">
                    <input type="text" defaultValue="1.2829° E" />
                  </FieldRow>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Contact & Billing</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FieldRow label="Contact Email">
                    <input type="email" defaultValue="office@harwichmarina.com" />
                  </FieldRow>
                  <FieldRow label="Contact Phone">
                    <input type="tel" defaultValue="+44 1255 504141" />
                  </FieldRow>
                </div>
                <FieldRow label="VAT Number">
                  <input type="text" defaultValue="GB 123 4567 89" />
                </FieldRow>
                <FieldRow label="Billing Currency">
                  <select defaultValue="EUR">
                    <option value="EUR">EUR — Euro (€)</option>
                    <option value="GBP">GBP — British Pound (£)</option>
                    <option value="USD">USD — US Dollar ($)</option>
                  </select>
                </FieldRow>
                <FieldRow label="Payment Terms" hint="Number of days from invoice issue date">
                  <select defaultValue="7">
                    <option value="3">Net 3 days</option>
                    <option value="7">Net 7 days</option>
                    <option value="14">Net 14 days</option>
                    <option value="30">Net 30 days</option>
                  </select>
                </FieldRow>
                <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Save Changes</button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><div className="card-header-title">Capacity</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <FieldRow label="Total Berths">
                    <input type="number" defaultValue="22" />
                  </FieldRow>
                  <FieldRow label="Dry Storage Slots">
                    <input type="number" defaultValue="24" />
                  </FieldRow>
                </div>
                <FieldRow label="Max Vessel LOA">
                  <input type="text" defaultValue="30m" />
                </FieldRow>
                <FieldRow label="Max Draft">
                  <input type="text" defaultValue="4.5m" />
                </FieldRow>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Subscription</div></div>
              <div className="card-body">
                <div style={{ background: 'var(--navy)', borderRadius: 8, padding: '16px 20px', color: '#fff', marginBottom: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.45)', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 6 }}>Current Plan</div>
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Professional</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Unlimited berths · All modules · Priority support</div>
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                    Renews <b style={{ color: 'rgba(255,255,255,0.75)' }}>1 May 2027</b>
                  </div>
                </div>
                {[
                  ['Active Berths', '22 / unlimited'],
                  ['Staff Accounts', '5 / unlimited'],
                  ['Data Storage', '2.4 GB used'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                    <span style={{ color: 'rgba(0,0,0,0.45)' }}>{k}</span>
                    <span style={{ fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RATE PLANS ─────────────────────────────────────────────── */}
      {tab === 'rates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sec-hdr">
            <div>
              <div className="sec-hdr-title">Rate Plans</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 3 }}>Pricing rules applied automatically at booking</div>
            </div>
            <button className="btn btn-primary"><Ic n="plus" s={12} />New Rate Plan</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>Plan Name</th><th>Base Rate</th><th>Peak Multiplier</th><th>7-Night Discount</th><th>28-Night Discount</th><th></th></tr>
              </thead>
              <tbody>
                {RATE_PLANS.map((r, i) => (
                  <tr key={i}>
                    <td><div className="tbl-name">{r.name}</div></td>
                    <td style={{ fontWeight: 600 }}>{r.base} <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.38)', fontSize: 11 }}>{r.unit}</span></td>
                    <td style={{ fontSize: 12, color: r.peak === '—' ? 'rgba(0,0,0,0.25)' : 'var(--orange)', fontWeight: r.peak !== '—' ? 600 : 400 }}>{r.peak}</td>
                    <td style={{ fontSize: 12, color: r.discount7 === '—' ? 'rgba(0,0,0,0.25)' : 'var(--green)', fontWeight: r.discount7 !== '—' ? 600 : 400 }}>{r.discount7}</td>
                    <td style={{ fontSize: 12, color: r.discount28 === '—' ? 'rgba(0,0,0,0.25)' : 'var(--green)', fontWeight: r.discount28 !== '—' ? 600 : 400 }}>{r.discount28}</td>
                    <td><button className="btn btn-ghost btn-sm">Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-header-title">Utility Rates</div></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {[
                  ['Electricity', '€0.28', 'per kWh'],
                  ['Water', '€0.004', 'per litre'],
                  ['Fuel — Diesel', '€1.42', 'per litre'],
                  ['Fuel — Petrol', '€1.55', 'per litre'],
                  ['Pump-out', '€12.00', 'flat fee'],
                  ['Shore Power Token', '€3.00', 'flat fee'],
                ].map(([name, rate, unit]) => (
                  <div key={name} style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 6 }}>{name}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>{rate}</div>
                    <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>{unit}</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}>Edit Utility Rates</button>
            </div>
          </div>
        </div>
      )}

      {/* ── USERS & ROLES ──────────────────────────────────────────── */}
      {tab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Staff Accounts</div>
            <button className="btn btn-primary"><Ic n="plus" s={12} />Invite Staff</button>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {STAFF.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="avatar" style={{ background: 'var(--navy)', color: '#fff', border: 'none' }}>{s.initials}</div>
                        <div className="tbl-name">{s.name}</div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{s.email}</td>
                    <td>
                      <span className="badge badge-navy">{s.role}</span>
                    </td>
                    <td>
                      <span className={`badge ${s.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{s.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm">Edit</button>
                        {s.status === 'active' && <button className="btn btn-danger btn-sm">Deactivate</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-header-title">Role Permissions</div></div>
            <div className="card-body">
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Harbor Master</th>
                      <th>Dock Master</th>
                      <th>Finance Officer</th>
                      <th>Office Admin</th>
                      <th>Yard Supervisor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Marina Map',       true,  true,  false, false, false],
                      ['Reservations',     true,  true,  true,  true,  false],
                      ['Boatyard',         true,  false, false, false, true],
                      ['Billing',          true,  false, true,  true,  false],
                      ['Members',          true,  true,  true,  true,  false],
                      ['Maintenance',      true,  true,  false, false, true],
                      ['Settings',         true,  false, false, false, false],
                    ].map(([module, ...perms]) => (
                      <tr key={module}>
                        <td style={{ fontWeight: 600 }}>{module}</td>
                        {perms.map((p, i) => (
                          <td key={i} style={{ textAlign: 'center' }}>
                            {p
                              ? <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 14 }}>✓</span>
                              : <span style={{ color: 'rgba(0,0,0,0.18)', fontSize: 12 }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS ──────────────────────────────────────────── */}
      {tab === 'notifications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">
              <div className="card-header-title">Automated Notification Rules</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Configure which events trigger email and SMS alerts</div>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {notifs.map((group, gi) => (
                <div key={group.group}>
                  <div style={{ padding: '12px 18px 6px', background: 'var(--bg)', fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.4)', letterSpacing: '1px', textTransform: 'uppercase', borderBottom: 'var(--border)' }}>
                    {group.group}
                  </div>
                  {group.items.map((item, ii) => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', borderBottom: 'var(--border)', gap: 16 }}>
                      <div style={{ flex: 1, fontSize: 12.5, color: 'rgba(0,0,0,0.8)' }}>{item.label}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', width: 32 }}>Email</span>
                        <Toggle on={item.email} onChange={() => toggleNotif(gi, ii, 'email')} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', width: 24 }}>SMS</span>
                        <Toggle on={item.sms} onChange={() => toggleNotif(gi, ii, 'sms')} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-header-title">Email Provider</div></div>
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <FieldRow label="Provider">
                <select defaultValue="sendgrid">
                  <option value="sendgrid">SendGrid</option>
                  <option value="mailgun">Mailgun</option>
                  <option value="postmark">Postmark</option>
                  <option value="smtp">Custom SMTP</option>
                </select>
              </FieldRow>
              <FieldRow label="From Address">
                <input type="email" defaultValue="noreply@harwichmarina.com" />
              </FieldRow>
              <FieldRow label="API Key" hint="Last updated 3 months ago">
                <input type="password" defaultValue="SG.xxxxxxxxxxxxxxxxxxx" />
              </FieldRow>
              <FieldRow label="SMS Provider">
                <select defaultValue="twilio">
                  <option value="twilio">Twilio</option>
                  <option value="messagebird">MessageBird</option>
                  <option value="vonage">Vonage</option>
                </select>
              </FieldRow>
              <div style={{ gridColumn: '1 / -1' }}>
                <button className="btn btn-primary">Save Provider Settings</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SYSTEM ─────────────────────────────────────────────────── */}
      {tab === 'system' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><div className="card-header-title">Integrations</div></div>
              <div className="card-body" style={{ padding: 0 }}>
                {[
                  { name: 'Stripe Payments', desc: 'Card payments and invoicing', connected: true,  badge: 'badge-green' },
                  { name: 'Xero Accounting', desc: 'Invoice and payment sync',    connected: false, badge: 'badge-gray' },
                  { name: 'AIS Vessel Tracking', desc: 'MarineTraffic API',       connected: false, badge: 'badge-gray' },
                  { name: 'OpenWeatherMap',  desc: 'Live weather conditions',      connected: true,  badge: 'badge-green' },
                  { name: 'DocuSign',        desc: 'Electronic signatures',        connected: false, badge: 'badge-gray' },
                ].map((int, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: 'var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{int.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>{int.desc}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className={`badge ${int.badge}`}>{int.connected ? 'Connected' : 'Not set up'}</span>
                      <button className="btn btn-ghost btn-sm">{int.connected ? 'Configure' : 'Connect'}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Feature Flags</div></div>
              <div className="card-body" style={{ padding: 0 }}>
                {[
                  { key: 'restaurant',  label: 'Restaurant module',           desc: 'Enable F&B screens' },
                  { key: 'events',      label: 'Events module',               desc: 'Event and venue hire' },
                  { key: 'portal',      label: 'Customer self-service portal', desc: 'Boater web portal' },
                  { key: 'ais',         label: 'AIS map overlay',             desc: 'Show live vessel positions' },
                  { key: 'multimarina', label: 'Multi-marina mode',           desc: 'Group reporting' },
                ].map(f => (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', padding: '13px 18px', borderBottom: 'var(--border)', gap: 16 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{f.label}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>{f.desc}</div>
                    </div>
                    <Toggle on={flags[f.key]} onChange={v => setFlags(prev => ({ ...prev, [f.key]: v }))} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-header"><div className="card-header-title">Security</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>Two-factor authentication</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>Required for Harbor Master + Admins</div>
                  </div>
                  <span className="badge badge-green">Enforced</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>Session timeout</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>Auto-logout after 8 hours idle</div>
                  </div>
                  <span className="badge badge-blue">8h</span>
                </div>
                <FieldRow label="IP Allowlist" hint="Leave blank to allow all IPs">
                  <input type="text" placeholder="e.g. 192.168.1.0/24, 203.0.113.0" />
                </FieldRow>
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>View Audit Log</button>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-header-title">Data & Backup</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  ['Last backup', 'Today 03:00 UTC', 'badge-green'],
                  ['Backup retention', '30 days', null],
                  ['Database size', '2.4 GB', null],
                ].map(([k, v, badge]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                    <span style={{ color: 'rgba(0,0,0,0.45)' }}>{k}</span>
                    {badge ? <span className={`badge ${badge}`}>{v}</span> : <span style={{ fontWeight: 600 }}>{v}</span>}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className="btn btn-ghost btn-sm">Export All Data</button>
                  <button className="btn btn-ghost btn-sm">Point-in-time Restore</button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-header-title">API Access</div></div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Production key</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginFamily: 'monospace', marginTop: 3, fontFamily: 'monospace', letterSpacing: '0.3px' }}>db_live_••••••••••••••••••••••</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm">Copy</button>
                    <button className="btn btn-danger btn-sm">Revoke</button>
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}><Ic n="plus" s={11} />Generate New Key</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
