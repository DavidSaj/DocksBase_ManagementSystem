import { useTenant } from './context/TenantContext';

export default function App() {
  const { marina, isLoading, tenantSlug, customDomain } = useTenant();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading…</p>
      </div>
    );
  }

  if (!marina) {
    const identifier = tenantSlug || customDomain || 'this marina';
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Marina &quot;{identifier}&quot; not found.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
      <h1>{marina.name}</h1>
      <p>Online booking coming soon.</p>
    </div>
  );
}
