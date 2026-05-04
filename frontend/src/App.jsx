import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { MarinaProvider } from './context/MarinaContext.jsx';
import ProtectedRoute from './components/routing/ProtectedRoute.jsx';
import { useState, Component } from 'react';

class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }
  static getDerivedStateFromError() {
    localStorage.setItem('db_app_screen', 'overview');
    return { crashed: true };
  }
  render() {
    if (this.state.crashed) {
      return (
        <div className="empty">
          <div className="empty-title">Something went wrong.</div>
          <button className="btn" onClick={() => { this.setState({ crashed: false }); this.props.setScreen('overview'); }}>
            Go to Overview
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
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
import Sales           from './screens/Sales.jsx';
import Operations      from './screens/Operations.jsx';
import Infrastructure      from './screens/Infrastructure.jsx';
import ServiceCatalogScreen from './screens/ServiceCatalogScreen.jsx';
import Login        from './screens/Login.jsx';
import MagicLink    from './screens/MagicLink.jsx';
import Signup      from './screens/Signup.jsx';
import VerifyEmail from './screens/VerifyEmail.jsx';
import BoaterPortal from './screens/BoaterPortal.jsx';


const SCREEN_MAP = {
  overview: Overview, map: MarinaMap, reservations: Reservations,
  vessels: Vessels, boatyard: Boatyard, maintenance: Maintenance,
  staff: Staff, billing: Billing, reports: Reports, members: Members,
  restaurant: Restaurant, events: Events, settings: Settings,
  documents: Documents, sales: Sales, operations: Operations,
  infrastructure: Infrastructure,
  'service-catalog': ServiceCatalogScreen,
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
          <ScreenErrorBoundary key={screen} setScreen={setScreen}>
            <Screen setScreen={setScreen} />
          </ScreenErrorBoundary>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signup"       element={<Signup />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login"  element={<Login />} />
        <Route path="/magic"  element={<MagicLink />} />
        <Route path="/portal" element={<ProtectedRoute element={<BoaterPortal />} allowedRoles={['boater']} />} />
        <Route path="/*"      element={<ProtectedRoute element={<MarinaProvider><DesktopApp /></MarinaProvider>} allowedRoles={['owner', 'manager']} />} />
      </Routes>
    </AuthProvider>
  );
}
