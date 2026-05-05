import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

export function storeUser(user) {
  localStorage.setItem('field_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('field_access_token');
  localStorage.removeItem('field_refresh_token');
  localStorage.removeItem('field_user');
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('field_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return !!localStorage.getItem('field_access_token');
}

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('field_access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('field_refresh_token');
      if (refresh) {
        try {
          const { data } = await axios.post(
            `${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/auth/token/refresh/`,
            { refresh }
          );
          localStorage.setItem('field_access_token', data.access);
          original.headers.Authorization = `Bearer ${data.access}`;
          return api(original);
        } catch {
          clearAuth();
          window.location.reload();
        }
      }
    }
    return Promise.reject(err);
  }
);

export async function login(email, password) {
  const { data } = await api.post('/auth/token/', { email, password });
  localStorage.setItem('field_access_token', data.access);
  localStorage.setItem('field_refresh_token', data.refresh);
  storeUser(data.user);
  return data.user;
}

export default api;
