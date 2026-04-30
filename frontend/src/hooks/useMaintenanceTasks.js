import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useMaintenanceTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/maintenance-tasks/');
      setTasks(r.data.results ?? r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function createTask(payload) {
    const { data } = await api.post('/maintenance-tasks/', payload);
    setTasks(prev => [...prev, data]);
    return data;
  }

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

  return { tasks, loading, fetchTasks, createTask, updateTask, completeTask };
}
