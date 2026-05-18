import { StrictMode } from 'react';
import './styles/booking.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TenantProvider } from '@docksbase/portal-ui/context/TenantContext';
import App from './App';

// Defensive: if a user previously installed the portal PWA on the SAME host
// (e.g. before the subdomain split), proactively unregister any service worker
// that might intercept booking requests for a different marina.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister().catch(() => {}));
  }).catch(() => {});
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <TenantProvider>
        <App />
      </TenantProvider>
    </BrowserRouter>
  </StrictMode>
);
