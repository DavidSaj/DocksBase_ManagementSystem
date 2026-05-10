// portal/src/components/feed/QuickActions.jsx
import { useState } from 'react';

function QuickBtn({ label, icon, onTap, disabled }) {
  return (
    <button
      className={`p-quick-btn${disabled ? ' p-quick-btn--disabled' : ''}`}
      onClick={disabled ? undefined : onTap}
      aria-label={label}
    >
      {icon}
      <span className="p-quick-btn__label">{label}</span>
    </button>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="p-toast">{message}</div>;
}

export default function QuickActions({ wallet }) {
  const [toast, setToast] = useState('');

  function copyTo(value, label) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setToast(`${label} copied`);
      setTimeout(() => setToast(''), 2000);
    });
  }

  const wifiPassword       = wallet?.wifi_password;
  const gateCode           = wallet?.gate_codes?.[0]?.pin;
  const harbourMasterPhone = wallet?.harbour_master_phone;

  return (
    <>
      <div className="p-quick-actions">
        <QuickBtn
          label="WiFi"
          disabled={!wifiPassword}
          onTap={() => copyTo(wifiPassword, 'WiFi password')}
          icon={
            <svg viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          }
        />
        <QuickBtn
          label="Gate"
          disabled={!gateCode}
          onTap={() => copyTo(gateCode, 'Gate code')}
          icon={
            <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          }
        />
        <QuickBtn
          label="Call HM"
          disabled={!harbourMasterPhone}
          onTap={() => { if (harbourMasterPhone) window.location.href = `tel:${harbourMasterPhone}`; }}
          icon={
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.68 9.7a19.79 19.79 0 01-3.07-8.67A2 2 0 012.58 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.56a16 16 0 006.29 6.29l1.93-1.92a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          }
        />
        <QuickBtn
          label="VHF"
          disabled={!wallet?.vhf_channel}
          onTap={() => copyTo(wallet?.vhf_channel, 'VHF channel')}
          icon={
            <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>
          }
        />
      </div>
      <Toast message={toast} />
    </>
  );
}
