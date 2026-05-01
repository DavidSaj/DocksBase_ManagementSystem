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
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('refresh_token');
      if (refresh) {
        try {
          const { data } = await axios.post(
            `${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/auth/token/refresh/`,
            { refresh }
          );
          localStorage.setItem('access_token', data.access);
          original.headers.Authorization = `Bearer ${data.access}`;
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
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data.user;
}

export function logout() {
  clearAuth();
}

export function isAuthenticated() {
  return !!localStorage.getItem('access_token');
}

export async function exchangeMagicToken(token) {
  const { data } = await api.post('/auth/magic/exchange/', { token });
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
  const { data } = await api.get(`/auth/verify-email/?token=${token}`);
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
