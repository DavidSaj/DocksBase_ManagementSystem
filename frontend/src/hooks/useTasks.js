import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tasks/').then(r => setTasks(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createTask(payload) {
    const { data } = await api.post('/tasks/', payload);
    setTasks(prev => [...prev, data]);
    return data;
  }

  async function updateTask(id, payload) {
    const { data } = await api.patch(`/tasks/${id}/`, payload);
    setTasks(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }

  async function deleteTask(id) {
    await api.delete(`/tasks/${id}/`);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  return { tasks, loading, createTask, updateTask, deleteTask };
}
