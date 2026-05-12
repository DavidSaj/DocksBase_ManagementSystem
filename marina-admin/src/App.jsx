import { useState } from 'react';
import { isAuthenticated, getStoredGroup, logout } from './api.js';
import Login       from './screens/Login.jsx';
import GroupPicker from './screens/GroupPicker.jsx';
import Sidebar     from './components/layout/Sidebar.jsx';
import Topbar      from './components/layout/Topbar.jsx';
import Overview    from './screens/Overview.jsx';
import Financials  from './screens/Financials.jsx';
import Marinas     from './screens/Marinas.jsx';
import Staff       from './screens/Staff.jsx';
import Settings    from './screens/Settings.jsx';

const SCREENS = {
  overview:   Overview,
  financials: Financials,
  marinas:    Marinas,
  staff:      Staff,
  settings:   Settings,
};

export default function App() {
  const [authed, setAuthed] = useState(() => isAuthenticated());
  const [group,  setGroup]  = useState(() => getStoredGroup());
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('ma_screen') || 'overview'
  );

  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('ma_screen', s);
  }

  function handleLogout() {
    logout();
    setAuthed(false);
    setGroup(null);
  }

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  if (!group)  return <GroupPicker onSelect={g => setGroup(g)} />;

  const Screen = SCREENS[screen] || Overview;
  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} onLogout={handleLogout} group={group} />
      <div className="main">
        <Topbar screen={screen} group={group} />
        <div className="content">
          <Screen group={group} setScreen={setScreen} />
        </div>
      </div>
    </div>
  );
}
