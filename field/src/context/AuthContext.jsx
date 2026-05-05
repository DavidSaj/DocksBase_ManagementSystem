import { createContext, useContext, useState, useEffect } from 'react';
import api, { getStoredUser, clearAuth, isAuthenticated, storeUser } from '../api.js';

const AuthContext = createContext(null);

const ALLOWED_ROLES = new Set(['staff', 'manager', 'owner']);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated()) {
      const stored = getStoredUser();
      if (stored) {
        setUser(stored);
        api.get('auth/me/')
          .then(r => { storeUser(r.data); setUser(r.data); })
          .catch(() => { clearAuth(); setUser(null); })
          .finally(() => setLoading(false));
      } else {
        clearAuth();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  function signIn(userObj) { storeUser(userObj); setUser(userObj); }
  function signOut() { clearAuth(); setUser(null); }

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export { ALLOWED_ROLES };
