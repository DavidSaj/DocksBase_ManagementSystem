import { useState } from 'react';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';

import CatalogueTab    from './ActivitiesHousekeeping/activities/CatalogueTab.jsx';
import BookingsTab     from './ActivitiesHousekeeping/activities/BookingsTab.jsx';
import ResourcesTab    from './ActivitiesHousekeeping/activities/ResourcesTab.jsx';
import ScheduleTab     from './ActivitiesHousekeeping/activities/ScheduleTab.jsx';
import WeeklySlotsTab  from './ActivitiesHousekeeping/activities/WeeklySlotsTab.jsx';
import RequestsInbox   from './ActivitiesHousekeeping/activities/RequestsInbox.jsx';
import ShareEmbedTab   from './ActivitiesHousekeeping/activities/ShareEmbedTab.jsx';

const ACT_TABS = [
  { key: 'types',     label: 'Activity Types' },
  { key: 'bookings',  label: 'Bookings' },
  { key: 'resources', label: 'Resources' },
  { key: 'schedule',  label: 'Today' },
  { key: 'slots',     label: 'Weekly Slots' },
  { key: 'requests',  label: 'Requests' },
  { key: 'share',     label: 'Share & Embed' },
];

export default function Activities() {
  const [tab, setTab] = useState('types');
  return (
    <div>
      <PageHeader
        title="Activities"
        subtitle="Bookable boater activities — paddleboard rentals, lessons, guided trips."
        infoBody={SCREEN_INFO.activities}
      />
      <div className="tabs">
        {ACT_TABS.map(t => (
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
        {tab === 'types'     && <CatalogueTab />}
        {tab === 'bookings'  && <BookingsTab />}
        {tab === 'resources' && <ResourcesTab />}
        {tab === 'schedule'  && <ScheduleTab />}
        {tab === 'slots'     && <WeeklySlotsTab />}
        {tab === 'requests'  && <RequestsInbox />}
        {tab === 'share'     && <ShareEmbedTab />}
      </div>
    </div>
  );
}
