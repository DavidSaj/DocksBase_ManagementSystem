import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);

  // Fetch initial list
  useEffect(() => {
    api.get('/notifications/').then(r => setNotifications(r.data)).catch(() => {});
  }, []);

  // WebSocket connection
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    const wsBase = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
    const ws = new WebSocket(`${wsBase}/ws/notifications/?token=${token}`);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'notification') {
          setNotifications(prev => [{
            id: data.id,
            kind: data.kind,
            title: data.title,
            body: data.body,
            link_screen: data.link_screen,
            link_id: data.link_id,
            read: false,
            created_at: data.created_at,
          }, ...prev]);
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const markRead = useCallback(async (id) => {
    await api.patch(`/notifications/${id}/read/`).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(async () => {
    await api.post('/notifications/mark-all-read/').catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, markRead, markAllRead };
}
