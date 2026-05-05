import { useState } from 'react';

const CARD = { background: '#fff', borderRadius: 14, padding: 20, marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const LABEL = { fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const VALUE = { fontSize: 18, fontWeight: 700, color: '#1a2d4a' };

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div>
        <div style={LABEL}>{label}</div>
        <div style={VALUE}>{value}</div>
      </div>
      <button onClick={copy} style={{ background: copied ? '#27ae60' : '#f4f6f8', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: copied ? '#fff' : '#1a2d4a', transition: 'background 0.2s' }}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export default function WalletCard({ booking }) {
  const w = booking.marina_wallet;
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{w.marina_name}</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Marina Card</div>
      </div>
      <div style={{ padding: '16px 16px 40px' }}>

        {(booking.berth_code || booking.berth_pier) && (
          <div style={CARD}>
            <div style={LABEL}>Your Berth</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#1a2d4a' }}>
              {[booking.berth_pier, booking.berth_code].filter(Boolean).join(' · ')}
            </div>
          </div>
        )}

        {w.wifi_network && (
          <div style={CARD}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>WiFi</div>
            <CopyRow label="Network" value={w.wifi_network} />
            {w.wifi_password && <CopyRow label="Password" value={w.wifi_password} />}
          </div>
        )}

        {w.gate_codes?.length > 0 && (
          <div style={CARD}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Gate Access</div>
            {w.gate_codes.map((g, i) => (
              <CopyRow key={i} label={g.label} value={g.pin} />
            ))}
          </div>
        )}

        <div style={CARD}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Contacts</div>
          {w.harbour_master_phone && (
            <div style={{ marginBottom: 10 }}>
              <div style={LABEL}>Harbour Master</div>
              <a href={`tel:${w.harbour_master_phone}`} style={{ ...VALUE, textDecoration: 'none', color: '#1a2d4a' }}>
                {w.harbour_master_phone}
              </a>
            </div>
          )}
          {w.vhf_channel && (
            <div style={{ marginBottom: 10 }}>
              <div style={LABEL}>VHF Channel</div>
              <div style={VALUE}>{w.vhf_channel}</div>
            </div>
          )}
          {w.office_hours && (
            <div>
              <div style={LABEL}>Office Hours</div>
              <div style={{ fontSize: 15, color: 'rgba(0,0,0,0.7)' }}>{w.office_hours}</div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>
            Stay: {booking.check_in} → {booking.check_out}
          </div>
        </div>
      </div>
    </div>
  );
}
