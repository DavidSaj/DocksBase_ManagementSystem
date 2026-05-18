import { createContext, useContext, useState, useEffect } from 'react';
import api, { getStoredUser, clearAuth, isAuthenticated, storeUser } from '../api.js';

const AuthContext = createContext(null);

// Fetch /auth/me/ with a single 1s retry to absorb a slow backend cold
// start. Only retries on transient (non-401) failures.
function fetchMeWithRetry() {
  return api.get('auth/me/').catch(err => {
    if (err?.response?.status === 401) {
      // Real auth failure — don't retry, surface immediately.
      throw err;
    }
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        api.get('auth/me/').then(resolve).catch(reject);
      }, 1000);
    });
  });
}

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (isAuthenticated()) {
      const stored = getStoredUser();
      if (stored) {
        setUser(stored);
        // Validate token server-side and refresh the user object with
        // authoritative data — prevents a tampered localStorage role from
        // granting elevated access.
        fetchMeWithRetry()
          .then(r => {
            storeUser(r.data);
            setUser(r.data);
            setAuthError(null);
          })
          .catch(err => {
            // Only force logout on a real auth failure (401). Network
            // errors, 500s, CORS issues, or aborted requests should
            // leave the user logged in with a recoverable error state —
            // otherwise a transient backend hiccup boots them out.
            if (err?.response?.status === 401) {
              clearAuth();
              setUser(null);
            } else {
              setAuthError(err);
            }
          })
          .finally(() => setLoading(false));
      } else {
        // Token exists but no user object — clear stale state
        clearAuth();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  // Cross-tab logout safety: if another tab clears the access_token
  // (e.g. user logged out elsewhere), reflect that in this tab.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'access_token' && !e.newValue) {
        setUser(null);
      } else if (e.key === 'db_user' && e.newValue) {
        try {
          setUser(JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
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
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
