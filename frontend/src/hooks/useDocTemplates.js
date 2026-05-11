import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useDocTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api.get('/doc-templates/').then(r => {
      setTemplates(r.data.results ?? r.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function uploadTemplate(formData) {
    const { data } = await api.post('/doc-templates/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setTemplates(prev => [data, ...prev]);
    return data;
  }

  async function prepareTemplate(id) {
    const { data } = await api.post(`/doc-templates/${id}/prepare/`);
    return data.edit_url;
  }

  async function setWaiver(id) {
    await api.post(`/doc-templates/${id}/set-waiver/`);
    reload();
  }

  async function clearWaiver(id) {
    await api.delete(`/doc-templates/${id}/set-waiver/`);
    reload();
  }

  return { templates, loading, uploadTemplate, prepareTemplate, setWaiver, clearWaiver };
}
