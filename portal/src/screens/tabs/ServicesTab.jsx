import { useState } from 'react';
import CraneRequestScreen from '../CraneRequestScreen';
import ExtendStayScreen from '../ExtendStayScreen';
import ReportIssueScreen from '../ReportIssueScreen';

function ChevronIcon() {
  return (
    <svg className="p-service-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CraneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M12 2l8 6H4l8-6z" />
      <line x1="4" y1="8" x2="20" y2="8" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

const SERVICES = [
  { id: 'crane',  label: 'Crane / Lift Request', sub: 'Request a hoist service from the harbour team', Icon: CraneIcon },
  { id: 'extend', label: 'Extend Stay',           sub: 'Request additional nights at your berth',       Icon: CalendarIcon },
  { id: 'issue',  label: 'Report an Issue',       sub: 'Berth, facility or vessel problem',             Icon: AlertIcon },
];

const STUBS = [
  { label: 'Maintenance Request', sub: 'Coming soon' },
  { label: 'Activities',          sub: 'Coming soon' },
];

export default function ServicesTab() {
  const [active, setActive] = useState(null);

  if (active === 'crane')  return <CraneRequestScreen onBack={() => setActive(null)} />;
  if (active === 'extend') return <ExtendStayScreen   onBack={() => setActive(null)} />;
  if (active === 'issue')  return <ReportIssueScreen  onBack={() => setActive(null)} />;

  return (
    <div className="p-service-list">
      <div className="p-service-section">
        <div className="p-service-section__header">Services</div>
        {SERVICES.map(({ id, label, sub, Icon }) => (
          <button key={id} className="p-service-row" onClick={() => setActive(id)}>
            <div className="p-service-row__icon"><Icon /></div>
            <div className="p-service-row__text">
              <div className="p-service-row__label">{label}</div>
              <div className="p-service-row__sub">{sub}</div>
            </div>
            <ChevronIcon />
          </button>
        ))}
      </div>
      <div className="p-service-section">
        <div className="p-service-section__header">Coming soon</div>
        {STUBS.map(({ label, sub }) => (
          <div key={label} className="p-service-row p-service-row--disabled" aria-disabled="true">
            <div className="p-service-row__text">
              <div className="p-service-row__label">{label}</div>
              <div className="p-service-row__sub">{sub}</div>
            </div>
            <span className="p-service-row__badge">Soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}
