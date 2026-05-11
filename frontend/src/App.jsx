import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { MarinaProvider } from './context/MarinaContext.jsx';
import ProtectedRoute from './components/routing/ProtectedRoute.jsx';
import { useState, Component } from 'react';
import { AnimatePresence } from 'framer-motion';
import WelcomeScreen from './components/WelcomeScreen.jsx';

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
import ImpersonationBanner from './components/layout/ImpersonationBanner.jsx';
import SetupGuide from './components/onboarding/SetupGuide.jsx';

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
import Channels from './screens/Channels.jsx';
import ActivitiesHousekeeping from './screens/ActivitiesHousekeeping.jsx';
import RevenueIntelligence from './screens/RevenueIntelligence.jsx';
import BerthIntelligence from './screens/BerthIntelligence.jsx';
import Loyalty from './screens/Loyalty.jsx';
import Accounting from './screens/Accounting.jsx';
import Utilities from './screens/Utilities.jsx';
import Communications from './screens/Communications.jsx';
import Charter from './screens/Charter.jsx';
import Tenants from './screens/Tenants.jsx';
import AccessControl from './screens/AccessControl.jsx';
import Sustainability from './screens/Sustainability.jsx';


const SCREEN_MAP = {
  overview: Overview, map: MarinaMap, reservations: Reservations,
  vessels: Vessels, boatyard: Boatyard, maintenance: Maintenance,
  staff: Staff, billing: Billing, reports: Reports, members: Members,
  restaurant: Restaurant, events: Events, settings: Settings,
  documents: Documents, sales: Sales, operations: Operations,
  infrastructure: Infrastructure,
  'service-catalog': ServiceCatalogScreen,
  channels: Channels,
  activities: ActivitiesHousekeeping,
  'revenue-intelligence': RevenueIntelligence,
  'berth-intelligence': BerthIntelligence,
  loyalty: Loyalty,
  accounting: Accounting,
  utilities: Utilities,
  communications: Communications,
  charter: Charter,
  tenants: Tenants,
  'access-control': AccessControl,
  sustainability: Sustainability,
};

function ComingSoon() {
  return <div className="empty"><div className="empty-title">Coming soon.</div></div>;
}

function DesktopApp() {
  const { user } = useAuth();
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('db_app_screen') || 'overview'
  );
  const welcomeKey = user?.id ? `db_welcomed_${user.id}` : null;
  const [showWelcome, setShowWelcome] = useState(
    () => welcomeKey ? !localStorage.getItem(welcomeKey) : false
  );

  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('db_app_screen', s);
  }

  function dismissWelcome() {
    if (welcomeKey) localStorage.setItem(welcomeKey, '1');
    setShowWelcome(false);
  }

  const token = localStorage.getItem('access_token');
  const isSafeMode = (() => {
    try {
      if (!token) return false;
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(part)).is_safe_mode === true;
    } catch { return false; }
  })();

  const Screen = SCREEN_MAP[screen] || ComingSoon;
  return (
    <>
      <ImpersonationBanner />
      <AnimatePresence>
        {showWelcome && (
          <WelcomeScreen
            name={user?.first_name}
            onDone={dismissWelcome}
          />
        )}
      </AnimatePresence>
      <div className="app" style={isSafeMode ? { paddingTop: 36 } : {}}>
        <Sidebar screen={screen} setScreen={setScreen} />
        <div className="main">
          <Topbar screen={screen} />
          <div className="content">
            <ScreenErrorBoundary key={screen} setScreen={setScreen}>
              <Screen setScreen={setScreen} />
            </ScreenErrorBoundary>
          </div>
        </div>
        <SetupGuide setScreen={setScreen} />
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signup"       element={<Signup />} />
        <Route path="/verify-email/:token" element={<VerifyEmail />} />
        <Route path="/login"  element={<Login />} />
        <Route path="/magic"  element={<MagicLink />} />
        <Route path="/*"      element={<ProtectedRoute element={<MarinaProvider><DesktopApp /></MarinaProvider>} allowedRoles={['owner', 'manager']} />} />
      </Routes>
    </AuthProvider>
  );
}
