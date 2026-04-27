import { useState } from 'react';
import Sidebar from './components/layout/Sidebar.jsx';
import Topbar  from './components/layout/Topbar.jsx';
import Overview     from './screens/Overview.jsx';
import Marinas      from './screens/Marinas.jsx';
import Subscriptions from './screens/Subscriptions.jsx';
import Finance      from './screens/Finance.jsx';
import Settings     from './screens/Settings.jsx';

const SCREENS = { overview: Overview, marinas: Marinas, subscriptions: Subscriptions, finance: Finance, settings: Settings };

export default function App() {
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('db_admin_screen') || 'overview'
  );

  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('db_admin_screen', s);
  }

  const Screen = SCREENS[screen] || Overview;

  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} />
      <div className="main">
        <Topbar screen={screen} />
        <div className="content">
          <Screen />
        </div>
      </div>
    </div>
  );
}
