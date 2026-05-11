// portal/src/components/portal/ChecklistView.jsx
import DimensionsForm from './checklist/DimensionsForm';
import WaiverItem     from './checklist/WaiverItem';
import InsuranceItem  from './checklist/InsuranceItem';

function CheckIcon({ done }) {
  if (done) {
    return (
      <svg className="p-check-item__icon p-check-item__icon--done" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    );
  }
  return (
    <svg className="p-check-item__icon p-check-item__icon--pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
    </svg>
  );
}

function CheckItem({ label, done, children }) {
  return (
    <div className="p-check-item">
      <div className={`p-check-item__header${done ? '' : ' p-check-item__header--open'}`}>
        <CheckIcon done={done} />
        <span className="p-check-item__label">{label}</span>
      </div>
      {!done && children}
    </div>
  );
}

export default function ChecklistView({ booking, onUpdate }) {
  const dimsDone   = booking.boat_loa != null && booking.boat_beam != null && booking.boat_draft != null;
  const waiverDone = booking.waiver_signed;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="p-checkin-hero">
        <div className="p-checkin-hero__title">Pre-Arrival Checklist</div>
        <div className="p-checkin-hero__subtitle">Complete all required steps before arrival</div>
      </div>
      <div style={{ padding: '16px 16px 40px' }}>
        <CheckItem label="Vessel Dimensions" done={dimsDone}>
          <DimensionsForm booking={booking} onUpdate={onUpdate} />
        </CheckItem>
        <CheckItem label="Marina Waiver" done={waiverDone}>
          <WaiverItem booking={booking} onUpdate={onUpdate} />
        </CheckItem>
        <CheckItem label="Insurance Document (optional)" done={!!booking.insurance_doc}>
          <InsuranceItem booking={booking} onUpdate={onUpdate} />
        </CheckItem>
      </div>
    </div>
  );
}
