import axios from 'axios';
import { detectTenant } from './context/TenantContext';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

api.interceptors.request.use(cfg => {
  const sessionToken = localStorage.getItem('portal_session_token');
  const tokenType    = localStorage.getItem('portal_token_type'); // 'guest' | 'member'

  if (sessionToken) {
    cfg.headers['Authorization'] =
      tokenType === 'member'
        ? `MemberBearer ${sessionToken}`
        : `Bearer ${sessionToken}`;
  }

  const marinaSlug = localStorage.getItem('portal_marina_slug');
  if (marinaSlug) {
    cfg.headers['X-Marina-Slug'] = marinaSlug;
  } else {
    const tenant = detectTenant();
    if (tenant?.slug) {
      cfg.headers['X-Marina-Slug'] = tenant.slug;
    } else if (tenant?.customDomain) {
      cfg.headers['X-Marina-Domain'] = tenant.customDomain;
    }
  }

  return cfg;
});

// Token refresh interceptor — fires on 401 for member sessions only
api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    const tokenType = localStorage.getItem('portal_token_type');
    if (
      err.response?.status === 401 &&
      tokenType === 'member' &&
      !original._retried
    ) {
      original._retried = true;
      const refreshToken = localStorage.getItem('portal_refresh_token');
      if (!refreshToken) return Promise.reject(err);
      try {
        const { data } = await axios.post(
          `${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/portal/auth/member-magic/refresh/`,
          { refresh_token: refreshToken },
        );
        localStorage.setItem('portal_session_token', data.session_token);
        localStorage.setItem('portal_refresh_token', data.refresh_token);
        original.headers['Authorization'] = `MemberBearer ${data.session_token}`;
        return api(original);
      } catch {
        // Refresh failed — clear session, caller will redirect to login
        localStorage.removeItem('portal_session_token');
        localStorage.removeItem('portal_refresh_token');
        localStorage.removeItem('portal_token_type');
        localStorage.removeItem('portal_marina_slug');
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);

export default api;

export function fetchMemberGate() {
  return api.get('/portal/member/gate/');
}

export function fetchMemberUtilities() {
  return api.get('/portal/member/utilities/');
}

export function fetchWorkOrders() {
  return api.get('/portal/member/work-orders/');
}

export function submitWorkOrder(data) {
  return api.post('/portal/member/work-orders/', data);
}

export function fetchInvoices() {
  return api.get('/portal/invoices/');
}

export function fetchDocuments() {
  return api.get('/portal/member/documents/');
}

export function uploadDocument(docType, file) {
  const form = new FormData();
  form.append('doc_type', docType);
  form.append('file', file);
  return api.post('/portal/member/documents/', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function deleteDocument(id) {
  return api.delete(`/portal/member/documents/${id}/`);
}

export function createReservationIntent(marinaSlug, payload) {
  return api.post('/public/reservations/intent/', payload, {
    headers: { 'X-Marina-Slug': marinaSlug },
  });
}

export function confirmReservation(marinaSlug, reservationId, paymentIntentId) {
  return api.post('/public/reservations/confirm/', {
    reservation_id: reservationId,
    payment_intent_id: paymentIntentId,
  }, {
    headers: { 'X-Marina-Slug': marinaSlug },
  });
}
