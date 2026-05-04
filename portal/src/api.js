import axios from 'axios';
import { detectTenant } from './context/TenantContext';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

api.interceptors.request.use(cfg => {
  const tenant = detectTenant();
  if (tenant?.slug) {
    cfg.headers['X-Marina-Slug'] = tenant.slug;
  } else if (tenant?.customDomain) {
    cfg.headers['X-Marina-Domain'] = tenant.customDomain;
  }
  return cfg;
});

export default api;
