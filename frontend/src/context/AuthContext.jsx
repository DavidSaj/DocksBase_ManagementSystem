import { createContext, useContext, useState, useEffect } from 'react';
import { getStoredUser, clearAuth, isAuthenticated, storeUser } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    if (isAuthenticated()) {
      const stored = getStoredUser();
      if (stored) {
        setUser(stored);
      } else {
        // Token exists but no user object — clear stale state
        clearAuth();
      }
    }
    setLoading(false);
  }, []);

  function signIn(userObj) {
    storeUser(userObj);
    setUser(userObj);
  }

  function signOut() {
    clearAuth();
    setUser(null);
  }

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
