import { useState } from 'react';
import BottomNav from './BottomNav';
import HomeTab from '../../screens/tabs/HomeTab';
import ServicesTab from '../../screens/tabs/ServicesTab';
import BookTab from '../../screens/tabs/BookTab';
import WalletTab from '../../screens/tabs/WalletTab';
import AccountTab from '../../screens/tabs/AccountTab';

const TAB_COMPONENTS = {
  home: HomeTab,
  services: ServicesTab,
  book: BookTab,
  wallet: WalletTab,
  account: AccountTab,
};

export default function AppShell({ initialTab = 'home' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const TabComponent = TAB_COMPONENTS[activeTab] || HomeTab;

  return (
    <div className="p-shell">
      <TabComponent />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
