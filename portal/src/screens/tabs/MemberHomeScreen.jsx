// portal/src/screens/tabs/MemberHomeScreen.jsx
import { useUserContext } from '../../context/UserContext';
import { useTenant } from '../../context/TenantContext';
import QuickActions from '../../components/feed/QuickActions';
import DynamicFeed  from '../../components/feed/DynamicFeed';

export default function MemberHomeScreen() {
  const { user }   = useUserContext();
  const { marina } = useTenant();
  const memberName = user?.email?.split('@')[0] || '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 16 }}>
      <div className="p-member-header">
        <span className="p-member-header__marina">{marina?.name || 'My Marina'}</span>
        <span className="p-member-header__name">{memberName}</span>
      </div>
      <QuickActions wallet={null} />
      <DynamicFeed />
    </div>
  );
}
