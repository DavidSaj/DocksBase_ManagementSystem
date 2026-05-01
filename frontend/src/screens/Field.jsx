import { useState } from 'react';
import TaskList from './field/TaskList.jsx';
import CheckInFlow from './field/CheckInFlow.jsx';
import CheckOutFlow from './field/CheckOutFlow.jsx';
import LogTaskFlow from './field/LogTaskFlow.jsx';
import CraneApprovalFlow from './field/CraneApprovalFlow.jsx';
import ArrivalsList from './field/ArrivalsList.jsx';

const ACTIONS = [
  { id: 'checkin',   label: 'Check in vessel',   icon: '✅', badge: null },
  { id: 'checkout',  label: 'Check out vessel',  icon: '🚪', badge: null },
  { id: 'logtask',   label: 'Log task',           icon: '🔧', badge: null },
  { id: 'crane',     label: 'Approve crane',      icon: '🏗️', badge: null },
  { id: 'arrivals',  label: "Today's arrivals",   icon: '🚢', badge: null },
  { id: 'mytasks',   label: 'My tasks',           icon: '📋', badge: null },
];

function ActionGrid({ onSelect }) {
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {ACTIONS.map(a => (
        <button
          key={a.id}
          onClick={() => onSelect(a.id)}
          style={{
            background: '#fff', border: 'none', borderRadius: 16, padding: '20px 12px',
            cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            position: 'relative',
          }}
        >
          {a.badge !== null && (
            <span style={{
              position: 'absolute', top: 8, right: 8,
              background: '#c0392b', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700,
              padding: '1px 6px',
            }}>{a.badge}</span>
          )}
          <span style={{ fontSize: 28 }}>{a.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1a2d4a', textAlign: 'center', lineHeight: 1.3 }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

const TAB_BAR = {
  position: 'fixed', bottom: 0, left: 0, right: 0,
  background: '#fff', borderTop: '1px solid rgba(0,0,0,0.1)',
  display: 'flex', height: 60,
};

function TabBar({ tab, setTab }) {
  return (
    <div style={TAB_BAR}>
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
  const [tab, setTab]   = useState('actions');
  const [flow, setFlow] = useState(null);

  function handleSelect(id) {
    if (id === 'mytasks') {
      setTab('tasks');
      return;
    }
    setFlow(id);
  }

  function handleBack() {
    setFlow(null);
  }

  if (flow === 'checkin')  return <CheckInFlow onBack={handleBack} />;
  if (flow === 'checkout') return <CheckOutFlow onBack={handleBack} />;
  if (flow === 'logtask')  return <LogTaskFlow onBack={handleBack} />;
  if (flow === 'crane')    return <CraneApprovalFlow onBack={handleBack} />;
  if (flow === 'arrivals') return <ArrivalsList onBack={handleBack} />;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', paddingBottom: 60 }}>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Field App</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>What do you need to do?</div>
      </div>

      {tab === 'actions' && <ActionGrid onSelect={handleSelect} />}
      {tab === 'tasks'   && <TaskList />}

      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
