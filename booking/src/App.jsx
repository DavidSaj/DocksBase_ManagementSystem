import { Routes, Route, useParams } from 'react-router-dom';
import { useTenant } from '@docksbase/portal-ui/context/TenantContext';
import { isFeatureEnabled } from '@docksbase/portal-ui/features';
import BookingWizard       from './screens/BookingWizard';
import BookingConfirmed    from './screens/BookingConfirmed';
import PreviewScreen       from './screens/PreviewScreen';
import WaitlistApplyScreen from './screens/WaitlistApplyScreen';
import WaitlistStatusScreen from './screens/WaitlistStatusScreen';
import WaitlistOfferScreen  from './screens/WaitlistOfferScreen';

function FeatureUnavailable({ marina, title, body }) {
  const contactEmail = marina?.contact_email || '';
  const contactPhone = marina?.phone || '';
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: 'center', color: 'rgba(0,0,0,0.7)' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>{title}</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(0,0,0,0.55)' }}>{body}</p>
        {(contactEmail || contactPhone) && (
          <p style={{ fontSize: 13, marginTop: 18, color: 'rgba(0,0,0,0.55)' }}>
            Contact {marina?.name || 'the marina'} directly
            {contactEmail && <> at <a href={`mailto:${contactEmail}`}>{contactEmail}</a></>}
            {contactEmail && contactPhone && ' or '}
            {contactPhone && <><a href={`tel:${contactPhone}`}>{contactPhone}</a></>}.
          </p>
        )}
      </div>
    </div>
  );
}

function BookingWizardPage() {
  const { marina } = useTenant();
  if (!marina) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }
  if (!isFeatureEnabled(marina.features, 'guest_booking')) {
    return (
      <FeatureUnavailable
        marina={marina}
        title="Online booking unavailable"
        body="This marina does not currently accept online bookings through this site."
      />
    );
  }
  return <BookingWizard marina={marina} />;
}

function BookingConfirmedPage({ cancelled }) {
  const { id }     = useParams();
  const { marina } = useTenant();
  return <BookingConfirmed marina={marina} bookingId={id} cancelled={cancelled} />;
}

function WaitlistApplyPage() {
  const { marina } = useTenant();
  if (!marina) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }
  const waitlistOn = marina.waitlist_enabled || isFeatureEnabled(marina.features, 'waiting_list');
  if (!waitlistOn) {
    return (
      <FeatureUnavailable
        marina={marina}
        title="Waitlist unavailable"
        body="This marina is not currently accepting waitlist applications."
      />
    );
  }
  return <WaitlistApplyScreen marina={marina} />;
}

function WaitlistStatusPage() {
  const { id } = useParams();
  return <WaitlistStatusScreen entryId={id} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/__preview"                   element={<PreviewScreen />} />
      <Route path="/__preview/"                  element={<PreviewScreen />} />
      <Route path="/:slug/book"                  element={<BookingWizardPage />} />
      <Route path="/:slug/booking/:id/confirmed" element={<BookingConfirmedPage cancelled={false} />} />
      <Route path="/:slug/booking/:id/cancelled" element={<BookingConfirmedPage cancelled={true} />} />
      <Route path="/:slug/waitlist/apply"        element={<WaitlistApplyPage />} />
      <Route path="/:slug/waitlist/status/:id"   element={<WaitlistStatusPage />} />
      <Route path="/:slug/waitlist/offer/:token" element={<WaitlistOfferScreen />} />
    </Routes>
  );
}
