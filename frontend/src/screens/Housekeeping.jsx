import { useState } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

import MatrixTab        from './ActivitiesHousekeeping/housekeeping/MatrixTab.jsx';
import TasksTab         from './ActivitiesHousekeeping/housekeeping/TasksTab.jsx';
import SchedulesTab     from './ActivitiesHousekeeping/housekeeping/SchedulesTab.jsx';
import ChecklistsTab    from './ActivitiesHousekeeping/housekeeping/ChecklistsTab.jsx';
import LogTab           from './ActivitiesHousekeeping/housekeeping/LogTab.jsx';
import StaffBoardTab    from './ActivitiesHousekeeping/housekeeping/StaffBoardTab.jsx';
import TaskDetailDrawer from './ActivitiesHousekeeping/housekeeping/TaskDetailDrawer.jsx';

import { Drawer } from './ActivitiesHousekeeping/shared.jsx';

const HK_TABS = [
  { key: 'matrix',      label: 'Matrix' },
  { key: 'tasks',       label: 'Tasks' },
  { key: 'schedules',   label: 'Schedules' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'log',         label: 'Log' },
  { key: 'staff',       label: 'Staff Board' },
];

export default function Housekeeping() {
  const [tab, setTab] = useState('matrix');
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  return (
    <div>
      <PageHeader
        title="Housekeeping"
        subtitle="Cleaning tasks, schedules, inspections, and the staff board."
        infoBody={SCREEN_INFO.housekeeping}
      />
      <div className="tabs">
        {HK_TABS.map(t => (
          <div
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20 }}>
        {tab === 'matrix'      && <MatrixTab onSelectTaskId={setSelectedTaskId} />}
        {tab === 'tasks'       && <TasksTab onSelectTask={t => setSelectedTaskId(t.id)} />}
        {tab === 'schedules'   && <SchedulesTab />}
        {tab === 'inspections' && <ChecklistsTab />}
        {tab === 'log'         && <LogTab />}
        {tab === 'staff'       && <StaffBoardTab />}
      </div>

      <Drawer open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} title="Task Details" width={500}>
        {selectedTaskId && (
          <TaskDetailDrawer taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}
      </Drawer>
    </div>
  );
}
