import { createContext, useContext, useState, useEffect } from 'react';
import { isAuthenticated, getAccessToken, decodeJwtPayload, clearAuth } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      setLoading(false);
      return;
    }
    const token = getAccessToken();
    const payload = decodeJwtPayload(token);
    if (!payload.is_platform_admin) {
      clearAuth();
      setLoading(false);
      return;
    }
    setUser(payload);
    setLoading(false);
  }, []);

  function signIn(payload) {
    if (!payload.is_platform_admin) {
      clearAuth();
      throw new Error('This account does not have platform admin access.');
    }
    setUser(payload);
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
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
