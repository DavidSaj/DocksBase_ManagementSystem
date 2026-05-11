import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

export function storeTokens(access, refresh) {
  localStorage.setItem('admin_access_token', access);
  localStorage.setItem('admin_refresh_token', refresh);
}

export function clearAuth() {
  localStorage.removeItem('admin_access_token');
  localStorage.removeItem('admin_refresh_token');
}

export function getAccessToken() {
  return localStorage.getItem('admin_access_token');
}

export function isAuthenticated() {
  return !!getAccessToken();
}

export function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return {};
  }
}

export async function login(email, password) {
  const { data } = await api.post('/auth/token/', { email, password });
  storeTokens(data.access, data.refresh);
  return decodeJwtPayload(data.access);
}

api.interceptors.request.use(cfg => {
  const token = getAccessToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('admin_refresh_token');
      if (refresh) {
        try {
          const { data } = await axios.post(
            `${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/auth/token/refresh/`,
            { refresh }
          );
          storeTokens(data.access, refresh);
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

export default api;
