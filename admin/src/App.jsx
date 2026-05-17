import { useState } from 'react';
import Sidebar from './components/layout/Sidebar.jsx';
import Topbar  from './components/layout/Topbar.jsx';
import Overview      from './screens/Overview.jsx';
import Marinas       from './screens/Marinas.jsx';
import MarinaDetail  from './screens/MarinaDetail.jsx';
import Subscriptions from './screens/Subscriptions.jsx';
import Finance       from './screens/Finance.jsx';
import Settings      from './screens/Settings.jsx';
import FeatureFlags  from './screens/FeatureFlags.jsx';
import AuditLog      from './screens/AuditLog.jsx';
import Groups        from './screens/Groups.jsx';
import Login         from './screens/Login.jsx';
import { isAdminAuthenticated, adminLogout, getAdminUser } from './api.js';

const SCREENS = {
  overview: Overview, subscriptions: Subscriptions,
  finance: Finance, settings: Settings,
  'feature-flags': FeatureFlags, 'audit-log': AuditLog, groups: Groups,
};

export default function App() {
  const [authed, setAuthed]   = useState(() => isAdminAuthenticated());
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('db_admin_screen') || 'overview'
  );
  // Selected marina id for the detail full-page route. null = list view.
  const [marinaId, setMarinaIdRaw] = useState(() => {
    const v = localStorage.getItem('db_admin_marina_id');
    return v ? parseInt(v) : null;
  });

  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('db_admin_screen', s);
    // Leaving the marinas section resets any open detail page.
    if (s !== 'marinas') {
      setMarinaIdRaw(null);
      localStorage.removeItem('db_admin_marina_id');
    }
  }

  function openMarina(id) {
    setMarinaIdRaw(id);
    localStorage.setItem('db_admin_marina_id', String(id));
  }
  function closeMarina() {
    setMarinaIdRaw(null);
    localStorage.removeItem('db_admin_marina_id');
  }

  function handleLogin(user) {
    setAuthed(true);
  }

  function handleLogout() {
    adminLogout();
    setAuthed(false);
  }

  if (!authed) return <Login onLogin={handleLogin} />;

  const user = getAdminUser();
  const showMarinaDetail = screen === 'marinas' && marinaId != null;

  let content;
  if (showMarinaDetail) {
    content = <MarinaDetail marinaId={marinaId} onBack={closeMarina} />;
  } else if (screen === 'marinas') {
    content = <Marinas onOpenMarina={openMarina} />;
  } else {
    const Screen = SCREENS[screen] || Overview;
    content = <Screen />;
  }

  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} onLogout={handleLogout} />
      <div className="main">
        <Topbar screen={screen} user={user} />
        <div className="content">
          {content}
        </div>
      </div>
    </div>
  );
}
