import { useState } from 'react';

import CatalogueTab    from './activities/CatalogueTab.jsx';
import BookingsTab     from './activities/BookingsTab.jsx';
import ResourcesTab    from './activities/ResourcesTab.jsx';
import ScheduleTab     from './activities/ScheduleTab.jsx';
import RequestsInbox   from './activities/RequestsInbox.jsx';
import ShareEmbedTab   from './activities/ShareEmbedTab.jsx';

import MatrixTab       from './housekeeping/MatrixTab.jsx';
import TasksTab        from './housekeeping/TasksTab.jsx';
import SchedulesTab    from './housekeeping/SchedulesTab.jsx';
import ChecklistsTab   from './housekeeping/ChecklistsTab.jsx';
import LogTab          from './housekeeping/LogTab.jsx';
import StaffBoardTab   from './housekeeping/StaffBoardTab.jsx';
import TaskDetailDrawer from './housekeeping/TaskDetailDrawer.jsx';

import { Drawer } from './shared.jsx';

// ─── Sub-tab bar ─────────────────────────────────────────────────────────────

function SubTabBar({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map(t => (
        <div key={t.key} className={`tab${active === t.key ? ' active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </div>
      ))}
    </div>
  );
}

// ─── Activities section ───────────────────────────────────────────────────────

const ACT_TABS = [
  { key: 'types',    label: 'Activity Types' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'resources', label: 'Resources' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'requests', label: 'Requests' },
  { key: 'share',    label: 'Share & Embed' },
];

function ActivitiesSection() {
  const [tab, setTab] = useState('types');
  return (
    <div>
      <SubTabBar tabs={ACT_TABS} active={tab} onChange={setTab} />
      <div style={{ marginTop: 20 }}>
        {tab === 'types'     && <CatalogueTab />}
        {tab === 'bookings'  && <BookingsTab />}
        {tab === 'resources' && <ResourcesTab />}
        {tab === 'schedule'  && <ScheduleTab />}
        {tab === 'requests'  && <RequestsInbox />}
        {tab === 'share'     && <ShareEmbedTab />}
      </div>
    </div>
  );
}

// ─── Housekeeping section ─────────────────────────────────────────────────────

const HK_TABS = [
  { key: 'matrix',      label: 'Matrix' },
  { key: 'tasks',       label: 'Tasks' },
  { key: 'schedules',   label: 'Schedules' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'log',         label: 'Log' },
  { key: 'staff',       label: 'Staff Board' },
];

function HousekeepingSection() {
  const [tab, setTab] = useState('matrix');
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  return (
    <div>
      <SubTabBar tabs={HK_TABS} active={tab} onChange={setTab} />
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

// ─── Top-level screen ─────────────────────────────────────────────────────────

const TOP_TABS = [
  { key: 'activities',   label: 'Activities' },
  { key: 'housekeeping', label: 'Housekeeping' },
];

export default function ActivitiesHousekeeping() {
  const [topTab, setTopTab] = useState('activities');

  return (
    <div>
      {/* Top-level tab bar */}
      <div className="tabs">
        {TOP_TABS.map(t => (
          <div key={t.key} className={`tab${topTab === t.key ? ' active' : ''}`} onClick={() => setTopTab(t.key)}>
            {t.label}
          </div>
        ))}
      </div>

      {topTab === 'activities'   && <ActivitiesSection />}
      {topTab === 'housekeeping' && <HousekeepingSection />}
    </div>
  );
}
