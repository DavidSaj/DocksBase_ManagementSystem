import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useMapConfig() {
  const [config,  setConfig]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/map/config/')
      .then(({ data }) => setConfig(data.config))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  async function saveConfig(newConfig) {
    setSaving(true);
    try {
      const { data } = await api.put('/map/config/', { config: newConfig });
      setConfig(data.config);
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { config, loading, saving, error, saveConfig };
}
