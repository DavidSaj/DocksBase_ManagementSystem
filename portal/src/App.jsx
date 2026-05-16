import { Routes, Route, useParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import PortalGate       from './components/shell/PortalGate';
import BookingWizard    from './screens/BookingWizard';
import BookingConfirmed from './screens/BookingConfirmed';
import ActivitiesList   from './screens/activities/ActivitiesList';
import ActivityDetail   from './screens/activities/ActivityDetail';
import RequestConfirmed from './screens/activities/RequestConfirmed';
import PreviewScreen    from './screens/PreviewScreen';
import WaitlistApplyScreen  from './screens/WaitlistApplyScreen';
import WaitlistStatusScreen from './screens/WaitlistStatusScreen';
import WaitlistOfferScreen  from './screens/WaitlistOfferScreen';

function BookingWizardPage() {
  const { marina } = useTenant();
  if (!marina) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading…</div>
      </div>
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
      <Route path="/:slug/activities"                            element={<ActivitiesList />} />
      <Route path="/:slug/activities/:activityId"             element={<ActivityDetail />} />
      <Route path="/:slug/activities/:activityId/requested"   element={<RequestConfirmed />} />
      <Route path="/:slug/waitlist/apply"          element={<WaitlistApplyPage />} />
      <Route path="/:slug/waitlist/status/:id"     element={<WaitlistStatusPage />} />
      <Route path="/:slug/waitlist/offer/:token"   element={<WaitlistOfferScreen />} />
      <Route path="/:slug/*"                                  element={<PortalGate />} />
    </Routes>
  );
}
