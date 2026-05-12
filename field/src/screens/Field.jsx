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

const ACTIONS = [
  { id: 'checkin',  label: 'Check In',       icon: 'check-circle' },
  { id: 'checkout', label: 'Check Out',      icon: 'log-out' },
  { id: 'logtask',  label: 'Log Task',       icon: 'wrench' },
  { id: 'crane',    label: 'Approve Crane',  icon: 'crane' },
  { id: 'arrivals', label: "Arrivals",       icon: 'ship' },
  { id: 'fuel',     label: 'Fuel Dock',     icon: 'droplet' },
  { id: 'mytasks',  label: 'My Tasks',       icon: 'clipboard' },
  { id: 'message',  label: 'Message Guest',  icon: 'message-square' },
];

const TABS = [
  { id: 'actions', label: 'Actions',  icon: 'zap' },
  { id: 'tasks',   label: 'Tasks',    icon: 'clipboard' },
];

function ActionGrid({ onSelect }) {
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {ACTIONS.map(a => (
        <button key={a.id} onClick={() => onSelect(a.id)} style={{
          background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 14, padding: '20px 12px',
          cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.05), 0 4px 16px rgba(0,0,0,0.04)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'rgba(12,31,61,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={a.icon} size={22} color="#0c1f3d" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#0c1f3d', textAlign: 'center', lineHeight: 1.3, fontFamily: 'Jost, system-ui, sans-serif' }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function TabBar({ tab, setTab }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 -2px 12px rgba(0,0,0,0.06)', display: 'flex', height: 60 }}>
      {TABS.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, border: 'none', background: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
            color: active ? '#0c1f3d' : 'rgba(0,0,0,0.35)',
            fontFamily: 'Jost, system-ui, sans-serif', fontWeight: active ? 700 : 400,
            fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase',
            borderTop: active ? '3px solid #b8965a' : '3px solid transparent',
          }}>
            <Icon name={t.icon} size={20} color={active ? '#0c1f3d' : 'rgba(0,0,0,0.3)'} />
            {t.label}
          </button>
        );
      })}
    </div>
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

  if (flow === 'checkin')  return <CheckInFlow onBack={() => setFlow(null)} />;
  if (flow === 'checkout') return <CheckOutFlow onBack={() => setFlow(null)} />;
  if (flow === 'logtask')  return <LogTaskFlow onBack={() => setFlow(null)} />;
  if (flow === 'crane')    return <CraneApprovalFlow onBack={() => setFlow(null)} />;
  if (flow === 'arrivals') return <ArrivalsList onBack={() => setFlow(null)} />;
  if (flow === 'fuel')     return <FuelDockFlow onBack={() => setFlow(null)} />;
  if (flow === 'message')  return <MessageGuestFlow onBack={() => setFlow(null)} />;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3f0', paddingBottom: 60 }}>
      <div style={{ background: '#0c1f3d', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Brand size={24} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: 'rgba(245,240,230,0.5)', fontFamily: 'IBM Plex Sans, system-ui, sans-serif' }}>
            {user?.first_name ? `Hi, ${user.first_name}` : 'Staff Portal'}
          </div>
          <button onClick={signOut} style={{ background: 'none', border: 'none', color: '#b8965a', fontSize: 11, cursor: 'pointer', padding: 0, fontFamily: 'Jost, system-ui, sans-serif', fontWeight: 600, letterSpacing: '0.5px', marginTop: 2 }}>
            Sign out
          </button>
        </div>
      </div>

      {tab === 'actions' && <ActionGrid onSelect={handleSelect} />}
      {tab === 'tasks'   && <TaskList />}

      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
