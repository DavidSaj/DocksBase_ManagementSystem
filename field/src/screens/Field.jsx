import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import TaskList from './field/TaskList.jsx';
import CheckInFlow from './field/CheckInFlow.jsx';
import CheckOutFlow from './field/CheckOutFlow.jsx';
import LogTaskFlow from './field/LogTaskFlow.jsx';
import CraneApprovalFlow from './field/CraneApprovalFlow.jsx';
import ArrivalsList from './field/ArrivalsList.jsx';
import ChannelManagementFlow from './field/ChannelManagementFlow.jsx';

const ACTIONS = [
  { id: 'checkin',  label: 'Check in vessel',  icon: '✅' },
  { id: 'checkout', label: 'Check out vessel', icon: '🚪' },
  { id: 'logtask',  label: 'Log task',          icon: '🔧' },
  { id: 'crane',    label: 'Approve crane',     icon: '🏗️' },
  { id: 'arrivals', label: "Today's arrivals",  icon: '🚢' },
  { id: 'mytasks',  label: 'My tasks',          icon: '📋' },
  { id: 'channels', label: 'Channels',          icon: '⚓' },
];

function ActionGrid({ onSelect }) {
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {ACTIONS.map(a => (
        <button key={a.id} onClick={() => onSelect(a.id)} style={{
          background: '#fff', border: 'none', borderRadius: 16, padding: '20px 12px',
          cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 28 }}>{a.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1a2d4a', textAlign: 'center', lineHeight: 1.3 }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function TabBar({ tab, setTab }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', height: 60 }}>
      {[{ id: 'actions', label: 'Actions', icon: '⚡' }, { id: 'tasks', label: 'Tasks', icon: '📋' }].map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex: 1, border: 'none', background: 'none', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
          color: tab === t.id ? '#1a2d4a' : 'rgba(0,0,0,0.35)',
          fontWeight: tab === t.id ? 700 : 400, fontSize: 11,
        }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          {t.label}
        </button>
      ))}
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
  if (flow === 'channels') return <ChannelManagementFlow onBack={() => setFlow(null)} />;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', paddingBottom: 60 }}>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Field App</div>
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>
            {user?.first_name ? `Hi ${user.first_name}` : 'What do you need to do?'}
          </div>
        </div>
        <button onClick={signOut} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer', paddingTop: 4 }}>
          Sign out
        </button>
      </div>

      {tab === 'actions' && <ActionGrid onSelect={handleSelect} />}
      {tab === 'tasks'   && <TaskList />}

      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
