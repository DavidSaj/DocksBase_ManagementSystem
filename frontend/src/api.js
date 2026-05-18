import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

// --- Auth helpers (defined early so interceptor and login/logout can use them) ---

export function storeUser(user) {
  localStorage.setItem('db_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('db_user');
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('db_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// --- Interceptors ---

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Module-level shared in-flight refresh promise. While a refresh is in
// flight, all other 401 handlers await this same promise instead of
// firing additional /auth/token/refresh/ calls. This prevents the race
// where the second call uses an already-blacklisted refresh token
// (rotation + blacklist-after-rotation is enabled server-side).
let refreshTokenPromise = null;

// Exported for tests — lets test setup reset the module-level state.
export function _resetRefreshState() {
  refreshTokenPromise = null;
}

function isRefreshEndpoint(url) {
  if (!url) return false;
  return url.includes('/auth/token/refresh/');
}

function performRefresh() {
  const refresh = localStorage.getItem('refresh_token');
  if (!refresh) {
    return Promise.reject(new Error('no_refresh_token'));
  }
  const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
  // Use a bare axios call so this request does NOT go through our
  // interceptor (avoids recursive 401 handling on the refresh itself).
  return axios
    .post(`${baseURL}/auth/token/refresh/`, { refresh })
    .then(({ data: refreshData }) => {
      localStorage.setItem('access_token', refreshData.access);
      if (refreshData.refresh) {
        // Server rotates refresh tokens — store the new one so
        // subsequent refreshes use a non-blacklisted token.
        localStorage.setItem('refresh_token', refreshData.refresh);
      }
      api.defaults.headers.common.Authorization = `Bearer ${refreshData.access}`;
      return refreshData.access;
    });
}

api.interceptors.response.use(
  res => {
    if (res.headers['x-email-reverify'] === 'warning') {
      window.dispatchEvent(new CustomEvent('email-reverify-warning'));
    }
    return res;
  },
  async err => {
    const original = err.config;
    const data = err.response?.data;

    if (err.response?.status === 403 && data?.code === 'email_reverify_required') {
      window.dispatchEvent(new CustomEvent('email-reverify-required'));
    }
    if (err.response?.status === 403 && data?.code === 'ip_not_allowed') {
      window.dispatchEvent(new CustomEvent('ip-not-allowed'));
    }

    // Don't try to refresh on the refresh endpoint itself — that would
    // cause infinite recursion when the refresh token is invalid.
    if (
      err.response?.status === 401 &&
      original &&
      !original._retry &&
      !isRefreshEndpoint(original.url)
    ) {
      original._retry = true;
      const hasRefresh = !!localStorage.getItem('refresh_token');
      if (hasRefresh) {
        try {
          // Share a single in-flight refresh across all concurrent 401s.
          if (!refreshTokenPromise) {
            refreshTokenPromise = performRefresh().finally(() => {
              // Clear after settle so the next expiry can refresh again.
              refreshTokenPromise = null;
            });
          }
          const newAccess = await refreshTokenPromise;
          // Replay the original request with the new token. Preserve
          // _retry so we don't loop on a stale 401.
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${newAccess}`;
          return api(original);
        } catch {
          clearAuth();
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(err);
  }
);

// --- Auth functions ---

export async function login(email, password) {
  const { data } = await api.post('/auth/token/', { email, password });
  if (data.mfa_required || data.mfa_enrollment_required) {
    return data;   // caller will handle the next step
  }
  // Security note: tokens are stored in localStorage (XSS-accessible).
  // Future hardening: migrate to httpOnly cookies set by the server.
  // Until then, CSP headers on the backend reduce XSS exposure.
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data;
}

export async function mfaLoginVerify({ mfa_challenge_token, code, trust_device }) {
  const { data } = await api.post('/auth/token/mfa-verify/', { mfa_challenge_token, code, trust_device });
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data;
}

export async function mfaEnrollComplete({ mfa_enrollment_token, code }) {
  const { data } = await api.post('/auth/token/mfa-enroll-complete/', { mfa_enrollment_token, code });
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data;   // includes backup_codes
}

export function logout() {
  clearAuth();
}

export function isAuthenticated() {
  return !!localStorage.getItem('access_token');
}

export async function exchangeMagicToken(token) {
  const { data } = await api.post('/auth/magic/exchange/', { token });
  // Security note: tokens are stored in localStorage (XSS-accessible).
  // Future hardening: migrate to httpOnly cookies set by the server.
  // Until then, CSP headers on the backend reduce XSS exposure.
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data.user;
}

export async function sendMagicLink(memberId) {
  await api.post('/auth/magic/send/', { member_id: memberId });
}

export async function signup(firstName, lastName, email, password, marinaName) {
  const { data } = await api.post('/auth/signup/', {
    first_name: firstName,
    last_name: lastName,
    email,
    password,
    marina_name: marinaName,
  });
  return data;
}

export async function verifyEmail(token) {
  // FIX 6: changed from GET (token in query param) to POST (token in request body)
  const { data } = await api.post('/auth/verify-email/', { token });
  // Security note: tokens are stored in localStorage (XSS-accessible).
  // Future hardening: migrate to httpOnly cookies set by the server.
  // Until then, CSP headers on the backend reduce XSS exposure.
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data.user;
}

export async function resendVerification(email) {
  const { data } = await api.post('/auth/resend-verification/', { email });
  return data;
}

export async function getOnboarding() {
  const { data } = await api.get('/auth/marina/onboarding/');
  return data;
}

export async function patchOnboarding(updates) {
  const { data } = await api.patch('/auth/marina/onboarding/', updates);
  return data;
}

export default api;
