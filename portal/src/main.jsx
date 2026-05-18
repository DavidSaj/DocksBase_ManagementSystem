import { StrictMode } from 'react';
import '@docksbase/portal-ui/styles/tokens.css';
import './styles/portal.css';
import '@docksbase/portal-ui/styles/components.css';
import './styles/portal-redesign.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TenantProvider } from '@docksbase/portal-ui/context/TenantContext';
import { UserContextProvider } from '@docksbase/portal-ui/context/UserContext';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <TenantProvider>
        <UserContextProvider>
          <App />
        </UserContextProvider>
      </TenantProvider>
    </BrowserRouter>
  </StrictMode>
);
