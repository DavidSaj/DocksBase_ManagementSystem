import { useState, useEffect } from 'react';
import { useUserContext } from '../../context/UserContext';
import { useTenant } from '../../context/TenantContext';
import BottomNav    from './BottomNav';
import BoardingPass from './BoardingPass';
import MemberShell  from './MemberShell';
import HomeTab     from '../../screens/tabs/HomeTab';
import ServicesTab from '../../screens/tabs/ServicesTab';
import BookTab     from '../../screens/tabs/BookTab';
import WalletTab   from '../../screens/tabs/WalletTab';
import AccountTab  from '../../screens/tabs/AccountTab';
import api from '../../api';

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
  const { capabilities, user } = useUserContext();
  const { appConfig } = useTenant();
  const [guestBooking, setGuestBooking] = useState(null);
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

  // Pre-fetch booking for guests so AppShell can decide which view to show
  useEffect(() => {
    if (!capabilities?.isGuest) return;
    const bookingId = localStorage.getItem('portal_booking_id')
      || (user?.bookingId ? user.bookingId : null);
    if (!bookingId) return;
    api.get(`/portal/checkin/bookings/${bookingId}/`)
      .then(r => setGuestBooking(r.data))
      .catch(() => {});
  }, [capabilities?.isGuest, user?.bookingId]);

  if (capabilities?.isGuest) {
    // After check-in, show BoardingPass. Before check-in, show the existing guest home flow.
    if (guestBooking?.marina_wallet) {
      return <BoardingPass booking={guestBooking} />;
    }
    // Fall through to existing guest pre-checkin rendering
    return <HomeTab />;
  }

  if (capabilities?.isMember) {
    return <MemberShell />;
  }

  return (
    <div className="p-shell">
      <TabComponent />
      <BottomNav tabs={DEFAULT_TABS} activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
