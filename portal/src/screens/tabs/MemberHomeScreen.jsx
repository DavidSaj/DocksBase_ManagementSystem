// portal/src/screens/tabs/MemberHomeScreen.jsx
// Redesigned with the Astro mobile-preview visual language (navy + gold + serif).
import { useUserContext } from '@docksbase/portal-ui/context/UserContext';
import { useTenant } from '@docksbase/portal-ui/context/TenantContext';
import { BrandMark, Badge } from '@docksbase/portal-ui/components/primitives';
import QuickActions from '../../components/feed/QuickActions';
import DynamicFeed  from '../../components/feed/DynamicFeed';

export default function MemberHomeScreen() {
  const { user }   = useUserContext();
  const { marina } = useTenant();
  const memberName = user?.email?.split('@')[0] ?? '';
  const displayName = memberName
    ? memberName.charAt(0).toUpperCase() + memberName.slice(1)
    : 'Member';

  return (
    <div className="p-home-root">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 20px 0',
        }}
      >
        <BrandMark />
        <Badge variant="live">Live</Badge>
      </header>

      <h1 className="p-greet">Welcome back, {displayName}</h1>
      <div className="p-greet-sub">{marina?.name || 'My Marina'}</div>

      <QuickActions wallet={null} />
      <DynamicFeed />
    </div>
  );
}
