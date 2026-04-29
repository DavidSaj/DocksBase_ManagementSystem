import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useMemberDocuments() {
  const [memberDocs, setMemberDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/member-documents/').then(r => {
      setMemberDocs(r.data.results ?? r.data);
    }).finally(() => setLoading(false));
  }, []);

  async function uploadDoc(formData) {
    const { data } = await api.post('/member-documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setMemberDocs(prev => [data, ...prev]);
    return data;
  }

  async function updateDoc(id, payload) {
    const { data } = await api.patch(`/member-documents/${id}/`, payload);
    setMemberDocs(prev => prev.map(d => d.id === id ? data : d));
    return data;
  }

  return { memberDocs, loading, uploadDoc, updateDoc };
}
