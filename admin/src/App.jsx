import { useState } from 'react';
import Sidebar from './components/layout/Sidebar.jsx';
import Topbar  from './components/layout/Topbar.jsx';
import Overview      from './screens/Overview.jsx';
import Marinas       from './screens/Marinas.jsx';
import Subscriptions from './screens/Subscriptions.jsx';
import Finance       from './screens/Finance.jsx';
import Settings      from './screens/Settings.jsx';
import Login         from './screens/Login.jsx';
import { isAdminAuthenticated, adminLogout, getAdminUser } from './api.js';

const SCREENS = { overview: Overview, marinas: Marinas, subscriptions: Subscriptions, finance: Finance, settings: Settings };

export default function App() {
  const [authed, setAuthed]   = useState(() => isAdminAuthenticated());
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('db_admin_screen') || 'overview'
  );

  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('db_admin_screen', s);
  }

  function handleLogin(user) {
    setAuthed(true);
  }

  function handleLogout() {
    adminLogout();
    setAuthed(false);
  }

  if (!authed) return <Login onLogin={handleLogin} />;

  const Screen = SCREENS[screen] || Overview;
  const user = getAdminUser();

  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} onLogout={handleLogout} />
      <div className="main">
        <Topbar screen={screen} user={user} />
        <div className="content">
          <Screen />
        </div>
      </div>
    </div>
  );
}
