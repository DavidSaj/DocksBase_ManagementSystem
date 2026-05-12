import { useState, useEffect } from 'react';
import { useUserContext } from '../../context/UserContext';
import { useTenant } from '../../context/TenantContext';
import BottomNav   from './BottomNav';
import HomeTab     from '../../screens/tabs/HomeTab';
import ServicesTab from '../../screens/tabs/ServicesTab';
import BookTab     from '../../screens/tabs/BookTab';
import WalletTab   from '../../screens/tabs/WalletTab';
import AccountTab  from '../../screens/tabs/AccountTab';

const TAB_COMPONENTS = {
  home:     HomeTab,
  services: ServicesTab,
  book:     BookTab,
  wallet:   WalletTab,
  account:  AccountTab,
};

const DEFAULT_TABS = [
  { id: 'home',    label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'book',    label: 'Book' },
  { id: 'wallet',  label: 'Wallet' },
  { id: 'account', label: 'Account' },
];

export default function AppShell({ initialTab = 'home' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const { capabilities } = useUserContext();
  const { appConfig } = useTenant();
  const TabComponent = TAB_COMPONENTS[activeTab] || HomeTab;

  useEffect(() => {
    if (appConfig?.brand_color) {
      document.documentElement.style.setProperty('--color-primary', appConfig.brand_color);
    }
  }, [appConfig?.brand_color]);

  useEffect(() => {
    function handleNav(e) { setActiveTab(e.detail.tab); }
    window.addEventListener('portal:navigate', handleNav);
    return () => window.removeEventListener('portal:navigate', handleNav);
  }, []);

  // Guests see the full-screen checkin flow — no shell chrome
  if (capabilities?.isGuest) {
    return <HomeTab />;
  }

  return (
    <div className="p-shell">
      <TabComponent />
      <BottomNav tabs={DEFAULT_TABS} activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
