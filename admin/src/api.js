import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1/' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('admin_access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_access_token');
      localStorage.removeItem('admin_refresh_token');
      localStorage.removeItem('admin_user');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export async function adminLogin(email, password) {
  const { data } = await api.post('auth/token/', { email, password });
  localStorage.setItem('admin_access_token', data.access);
  localStorage.setItem('admin_refresh_token', data.refresh);
  localStorage.setItem('admin_user', JSON.stringify(data.user));
  return data.user;
}

export function adminLogout() {
  localStorage.removeItem('admin_access_token');
  localStorage.removeItem('admin_refresh_token');
  localStorage.removeItem('admin_user');
}

export function getAdminUser() {
  try {
    const raw = localStorage.getItem('admin_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAdminAuthenticated() {
  return !!localStorage.getItem('admin_access_token');
}

export default api;
