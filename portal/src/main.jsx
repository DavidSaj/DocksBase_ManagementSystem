import { StrictMode } from 'react';
import './styles/portal.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TenantProvider } from './context/TenantContext';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <TenantProvider>
        <App />
      </TenantProvider>
    </BrowserRouter>
  </StrictMode>
);
