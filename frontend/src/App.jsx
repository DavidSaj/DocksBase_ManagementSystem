import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/routing/ProtectedRoute.jsx';
import { useState } from 'react';
import Sidebar from './components/layout/Sidebar.jsx';
import Topbar  from './components/layout/Topbar.jsx';

import Overview     from './screens/Overview.jsx';
import MarinaMap    from './screens/MarinaMap.jsx';
import Reservations from './screens/Reservations.jsx';
import Vessels      from './screens/Vessels.jsx';
import Boatyard     from './screens/Boatyard.jsx';
import Maintenance  from './screens/Maintenance.jsx';
import Staff        from './screens/Staff.jsx';
import Billing      from './screens/Billing.jsx';
import Reports      from './screens/Reports.jsx';
import Members      from './screens/Members.jsx';
import Restaurant   from './screens/Restaurant.jsx';
import Events       from './screens/Events.jsx';
import Settings     from './screens/Settings.jsx';
import Documents    from './screens/Documents.jsx';
import Sales        from './screens/Sales.jsx';
import Operations   from './screens/Operations.jsx';
import Field        from './screens/Field.jsx';
import Login        from './screens/Login.jsx';
import MagicLink    from './screens/MagicLink.jsx';
import BoaterPortal from './screens/BoaterPortal.jsx';

const SCREEN_MAP = {
  overview: Overview, map: MarinaMap, reservations: Reservations,
  vessels: Vessels, boatyard: Boatyard, maintenance: Maintenance,
  staff: Staff, billing: Billing, reports: Reports, members: Members,
  restaurant: Restaurant, events: Events, settings: Settings,
  documents: Documents, sales: Sales, operations: Operations,
};

function ComingSoon() {
  return <div className="empty"><div className="empty-title">Coming soon.</div></div>;
}

function DesktopApp() {
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('db_app_screen') || 'overview'
  );
  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('db_app_screen', s);
  }
  const Screen = SCREEN_MAP[screen] || ComingSoon;
  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} />
      <div className="main">
        <Topbar screen={screen} />
        <div className="content">
          <Screen setScreen={setScreen} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login"  element={<Login />} />
        <Route path="/magic"  element={<MagicLink />} />
        <Route path="/portal" element={<ProtectedRoute element={<BoaterPortal />} allowedRoles={['boater']} />} />
        <Route path="/field"  element={<ProtectedRoute element={<Field />}        allowedRoles={['staff', 'owner', 'manager']} />} />
        <Route path="/*"      element={<ProtectedRoute element={<DesktopApp />}   allowedRoles={['owner', 'manager']} />} />
      </Routes>
    </AuthProvider>
  );
}
