import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useDocTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/doc-templates/').then(r => {
      setTemplates(r.data.results ?? r.data);
    }).finally(() => setLoading(false));
  }, []);

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

  return { templates, loading, uploadTemplate, prepareTemplate };
}
