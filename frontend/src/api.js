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

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('refresh_token');
      if (refresh) {
        try {
          const { data: refreshData } = await axios.post(
            `${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/auth/token/refresh/`,
            { refresh }
          );
          localStorage.setItem('access_token', refreshData.access);
          original.headers.Authorization = `Bearer ${refreshData.access}`;
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
