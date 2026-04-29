import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useWorkOrders() {
  const [workOrders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/work-orders/').then(r => setWorkOrders(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createWorkOrder(payload) {
    const { data } = await api.post('/work-orders/', payload);
    setWorkOrders(prev => [data, ...prev]);
    return data;
  }

  async function updateWorkOrder(id, payload) {
    const { data } = await api.patch(`/work-orders/${id}/`, payload);
    setWorkOrders(prev => prev.map(w => w.id === id ? data : w));
    return data;
  }

  return { workOrders, loading, createWorkOrder, updateWorkOrder };
}
