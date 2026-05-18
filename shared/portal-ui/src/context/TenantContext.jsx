import { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';

const TenantContext = createContext(null);

const BOOKING_HOSTNAME = 'booking.docksbase.com';
const DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const APP_HOSTNAMES = new Set(['app.docksbase.com', 'www.docksbase.com', 'docksbase.com']);

// Returns { slug, customDomain, prefill } or null (= not a portal host)
export function detectTenant() {
  const { hostname, pathname, search } = window.location;

  if (APP_HOSTNAMES.has(hostname)) return null;
  // Preview iframe — bypass tenant detection entirely.
  if (pathname.startsWith('/__preview')) return null;

  const params = new URLSearchParams(search);
  const prefill = {};
  if (params.get('arrival'))   prefill.arrival   = params.get('arrival');
  if (params.get('departure')) prefill.departure = params.get('departure');
  if (params.get('category'))  prefill.category  = params.get('category');

  // booking.docksbase.com/:slug  OR  localhost/:slug (dev)
  if (hostname === BOOKING_HOSTNAME || DEV_HOSTNAMES.has(hostname)) {
    const slug = pathname.split('/').filter(Boolean)[0] ?? null;
    return slug ? { slug, customDomain: null, prefill } : null;
  }

  // Option 3: marina's own custom domain
  return { slug: null, customDomain: hostname, prefill };
}

export function TenantProvider({ children }) {
  const tenant = detectTenant();
  const [marina, setMarina] = useState(null);
  const [appConfig, setAppConfig] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tenant) { setIsLoading(false); return; }
    const headers = tenant.slug
      ? { 'X-Marina-Slug': tenant.slug }
      : { 'X-Marina-Domain': tenant.customDomain };
    const base = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
    axios.get(`${base}/public/marina/`, { headers })
      .then(res => {
        setMarina(res.data);
        setAppConfig(res.data.app_config || {});
      })
      .catch(() => setMarina(null))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <TenantContext.Provider value={{
      tenantSlug:   tenant?.slug         ?? null,
      customDomain: tenant?.customDomain ?? null,
      prefill:      tenant?.prefill      ?? {},
      marina,
      appConfig,
      isLoading,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
