import DimensionsForm from './checklist/DimensionsForm';
import WaiverItem from './checklist/WaiverItem';
import InsuranceItem from './checklist/InsuranceItem';

const CARD = { background: '#fff', borderRadius: 14, padding: 20, marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const HDR = { background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' };

function CheckItem({ label, done, children }) {
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: done ? 0 : 16 }}>
        <span style={{ fontSize: 20 }}>{done ? '✅' : '⬜'}</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
      </div>
      {!done && children}
    </div>
  );
}

export default function ChecklistView({ booking, onUpdate }) {
  const dimsDone   = booking.boat_loa != null && booking.boat_beam != null && booking.boat_draft != null;
  const waiverDone = booking.waiver_signed;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Pre-Arrival Checklist</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Complete all required steps before arrival</div>
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
