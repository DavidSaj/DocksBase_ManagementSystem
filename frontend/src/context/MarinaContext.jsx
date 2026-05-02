import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api.js';

const MarinaContext = createContext(null);

export function MarinaProvider({ children }) {
  const [marina, setMarina] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/marina/profile/')
      .then(r => setMarina(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function updateMarina(payload) {
    const { data } = await api.patch('/marina/profile/', payload);
    setMarina(data);
    return data;
  }

  return (
    <MarinaContext.Provider value={{ marina, loading, updateMarina }}>
      {children}
    </MarinaContext.Provider>
  );
}

export function useMarinaContext() {
  const ctx = useContext(MarinaContext);
  if (!ctx) throw new Error('useMarinaContext must be used inside MarinaProvider');
  return ctx;
}
