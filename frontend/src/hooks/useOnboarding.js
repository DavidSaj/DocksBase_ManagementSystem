import { useState, useEffect } from 'react';
import { getOnboarding, patchOnboarding } from '../api.js';

export default function useOnboarding() {
  const [onboarding, setOnboarding] = useState(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    getOnboarding()
      .then(data => setOnboarding(data))
      .catch(() => setOnboarding(null))
      .finally(() => setLoading(false));
  }, []);

  async function markStep(key) {
    setOnboarding(prev => prev ? { ...prev, [key]: true } : prev);
    try {
      const updated = await patchOnboarding({ [key]: true });
      setOnboarding(updated);
    } catch {
      setOnboarding(prev => prev ? { ...prev, [key]: false } : prev);
    }
  }

  const allDone = onboarding
    ? Object.values(onboarding).every(Boolean)
    : false;

  return { onboarding, loading, markStep, allDone };
}
