import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1/' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('ma_access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ma_access_token');
      localStorage.removeItem('ma_group');
      window.location.reload();
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

export function logout() {
  localStorage.removeItem('ma_access_token');
  localStorage.removeItem('ma_group');
  localStorage.removeItem('ma_screen');
}

export default api;
