import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useMaintenanceTasks({ assignedTo } = {}) {
  const [tasks, setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (assignedTo) params.assigned_to = assignedTo;
      const r = await api.get('/maintenance-tasks/', { params });
      setTasks(r.data.results ?? r.data);
    } finally {
      setLoading(false);
    }
  }, [assignedTo]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function updateTask(id, payload) {
    const { data } = await api.patch(`/maintenance-tasks/${id}/`, payload);
    setTasks(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }

  async function completeTask(id, notes, photo) {
    const form = new FormData();
    form.append('status', 'completed');
    form.append('completion_notes', notes);
    if (photo) form.append('completion_photo', photo);
    const { data } = await api.patch(`/maintenance-tasks/${id}/`, form);
    setTasks(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }

  return { tasks, loading, fetchTasks, updateTask, completeTask };
}
