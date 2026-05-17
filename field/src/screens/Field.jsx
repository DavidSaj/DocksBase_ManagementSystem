import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import Brand from '../components/Brand.jsx';
import TaskList from './field/TaskList.jsx';
import CheckInFlow from './field/CheckInFlow.jsx';
import CheckOutFlow from './field/CheckOutFlow.jsx';
import LogTaskFlow from './field/LogTaskFlow.jsx';
import CraneApprovalFlow from './field/CraneApprovalFlow.jsx';
import ArrivalsList from './field/ArrivalsList.jsx';
import FuelDockFlow from './field/FuelDockFlow.jsx';
import MessageGuestFlow from './field/MessageGuestFlow.jsx';
import DockwalkFlow from './field/DockwalkFlow.jsx';
import QuickChargeFlow from './field/QuickChargeFlow.jsx';

const ACTIONS = [
  { id: 'checkin',  label: 'Check In',       icon: 'check-circle' },
  { id: 'checkout', label: 'Check Out',      icon: 'log-out' },
  { id: 'logtask',  label: 'Log Task',       icon: 'wrench' },
  { id: 'crane',    label: 'Approve Crane',  icon: 'crane' },
  { id: 'arrivals', label: 'Arrivals',       icon: 'ship' },
  { id: 'fuel',     label: 'Fuel Dock',      icon: 'droplet' },
  { id: 'mytasks',  label: 'My Tasks',       icon: 'clipboard' },
  { id: 'message',  label: 'Message Guest',  icon: 'message-square' },
  { id: 'dockwalk', label: 'Meter Readings', icon: 'zap',  sub: 'Enter daily utility readings' },
  { id: 'quickcharge', label: 'Quick Charge', icon: 'tag', sub: 'Add ice, pump-out, fees' },
];

const TABS = [
  { id: 'actions', label: 'Actions', icon: 'zap' },
  { id: 'tasks',   label: 'Tasks',   icon: 'clipboard' },
];

function ActionGrid({ onSelect }) {
  return (
    <div className="f-action-grid">
      {ACTIONS.map((a) => (
        <button key={a.id} onClick={() => onSelect(a.id)} className="f-action-tile">
          <span className="f-action-tile__icon">
            <Icon name={a.icon} size={22} color="var(--db-gold-light)" />
          </span>
          <span className="f-action-tile__label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function TabBar({ tab, setTab }) {
  return (
    <nav className="f-tabbar" aria-label="Field tabs">
      {TABS.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`f-tab${active ? ' f-tab--active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={t.icon} size={20} color={active ? 'var(--db-gold-light)' : 'var(--db-on-dark-muted)'} />
            <span className="f-tab__label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function Field() {
  const { user, signOut } = useAuth();
  const [tab, setTab]   = useState('actions');
  const [flow, setFlow] = useState(null);

  function handleSelect(id) {
    if (id === 'mytasks') { setTab('tasks'); return; }
    setFlow(id);
  }

  if (flow === 'checkin')     return <CheckInFlow onBack={() => setFlow(null)} />;
  if (flow === 'checkout')    return <CheckOutFlow onBack={() => setFlow(null)} />;
  if (flow === 'logtask')     return <LogTaskFlow onBack={() => setFlow(null)} />;
  if (flow === 'crane')       return <CraneApprovalFlow onBack={() => setFlow(null)} />;
  if (flow === 'arrivals')    return <ArrivalsList onBack={() => setFlow(null)} />;
  if (flow === 'fuel')        return <FuelDockFlow onBack={() => setFlow(null)} />;
  if (flow === 'message')     return <MessageGuestFlow onBack={() => setFlow(null)} />;
  if (flow === 'dockwalk')    return <DockwalkFlow onBack={() => setFlow(null)} />;
  if (flow === 'quickcharge') return <QuickChargeFlow onBack={() => setFlow(null)} />;

  return (
    <div className="f-shell">
      <header className="f-shell__topbar">
        <Brand size={24} />
        <div className="f-shell__user">
          <div className="f-shell__greet">
            {user?.first_name ? `Hi, ${user.first_name}` : 'Staff Portal'}
          </div>
          <button onClick={signOut} className="f-shell__signout">Sign out</button>
        </div>
      </header>

      {tab === 'actions' && <ActionGrid onSelect={handleSelect} />}
      {tab === 'tasks'   && <TaskList />}

      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
