import '@docksbase/portal-ui/styles/tokens.css';
import '@docksbase/portal-ui/styles/components.css';
import './styles/field.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './context/AuthContext.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
