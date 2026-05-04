import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TenantProvider } from './context/TenantContext';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TenantProvider>
      <App />
    </TenantProvider>
  </StrictMode>
);
