import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useCertifications(staffId = null) {
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchCerts = useCallback(async () => {
    try {
      setLoading(true);
      const params = staffId ? { staff_member: staffId } : {};
      const { data } = await api.get('/certifications/', { params });
      setCerts(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [staffId]);

  useEffect(() => { fetchCerts(); }, [fetchCerts]);

  async function createCert(formData) {
    const { data } = await api.post('/certifications/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setCerts(prev => [...prev, data]);
    return data;
  }

  async function updateCert(id, formData) {
    const { data } = await api.patch(`/certifications/${id}/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setCerts(prev => prev.map(c => c.id === id ? data : c));
    return data;
  }

  async function deleteCert(id) {
    await api.delete(`/certifications/${id}/`);
    setCerts(prev => prev.filter(c => c.id !== id));
  }

  return { certs, loading, error, refetch: fetchCerts, createCert, updateCert, deleteCert };
}
