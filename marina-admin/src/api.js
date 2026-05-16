import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1/' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('ma_access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let refreshInFlight = null;

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  const refresh = localStorage.getItem('ma_refresh_token');
  if (!refresh) throw new Error('no_refresh_token');
  refreshInFlight = axios
    .post('/api/v1/auth/token/refresh/', { refresh })
    .then(r => {
      localStorage.setItem('ma_access_token', r.data.access);
      return r.data.access;
    })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

api.interceptors.response.use(
  r => r,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && original && !original._retried) {
      original._retried = true;
      try {
        const access = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      } catch {
        logout();
        window.location.reload();
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);

export function isAuthenticated() {
  return !!localStorage.getItem('ma_access_token');
}

export function getStoredGroup() {
  try { return JSON.parse(localStorage.getItem('ma_group')); } catch { return null; }
}

export function storeTokens(data) {
  if (data.access)  localStorage.setItem('ma_access_token',  data.access);
  if (data.refresh) localStorage.setItem('ma_refresh_token', data.refresh);
}

export async function login(email, password) {
  const { data } = await api.post('auth/token/', { email, password });
  if (data.mfa_required || data.mfa_enrollment_required) return data;
  storeTokens(data);
  return data;
}

export async function mfaLoginVerify({ mfa_challenge_token, code, trust_device }) {
  const { data } = await api.post('auth/token/mfa-verify/', {
    mfa_challenge_token, code, trust_device,
  });
  storeTokens(data);
  return data;
}

export function logout() {
  localStorage.removeItem('ma_access_token');
  localStorage.removeItem('ma_refresh_token');
  localStorage.removeItem('ma_group');
  localStorage.removeItem('ma_screen');
}

export default api;
