// portal/src/components/shell/MemberShell.jsx
import { useState, useEffect } from 'react';
import { useTenant } from '../../context/TenantContext';
import BottomNav from './BottomNav';
import MemberHomeTab from '../../screens/tabs/MemberHomeTab';
import UtilitiesTab  from '../../screens/tabs/UtilitiesTab';
import ServicesTab   from '../../screens/tabs/ServicesTab';
import AccountTab    from '../../screens/tabs/AccountTab';

const TAB_COMPONENTS = {
  home:      MemberHomeTab,
  utilities: UtilitiesTab,
  services:  ServicesTab,
  account:   AccountTab,
};

export default function MemberShell() {
  const { appConfig } = useTenant();
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    function handleNav(e) {
      if (e.detail?.tab) setActiveTab(e.detail.tab);
    }
    window.addEventListener('portal:navigate', handleNav);
    return () => window.removeEventListener('portal:navigate', handleNav);
  }, []);

  const tabs = [
    { id: 'home',      label: 'Home',      always: true },
    { id: 'utilities', label: 'Utilities', enabled: appConfig?.enable_utilities !== false },
    { id: 'services',  label: 'Services',  enabled: appConfig?.enable_boatyard  !== false },
    { id: 'account',   label: 'Account',   always: true },
  ].filter(t => t.always || t.enabled);

  const TabComponent = TAB_COMPONENTS[activeTab] || MemberHomeTab;

  return (
    <div className="p-shell">
      <TabComponent />
      <BottomNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
