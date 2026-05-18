import { Routes, Route } from 'react-router-dom';
import PortalGate       from './components/shell/PortalGate';
import ActivitiesList   from './screens/activities/ActivitiesList';
import ActivityDetail   from './screens/activities/ActivityDetail';
import RequestConfirmed from './screens/activities/RequestConfirmed';
import MyTripsScreen    from './screens/MyTripsScreen';

export default function App() {
  return (
    <Routes>
      <Route path="/dashboard"                              element={<MyTripsScreen />} />
      <Route path="/:slug/activities"                       element={<ActivitiesList />} />
      <Route path="/:slug/activities/:activityId"           element={<ActivityDetail />} />
      <Route path="/:slug/activities/:activityId/requested" element={<RequestConfirmed />} />
      <Route path="/:slug/*"                                element={<PortalGate />} />
    </Routes>
  );
}
