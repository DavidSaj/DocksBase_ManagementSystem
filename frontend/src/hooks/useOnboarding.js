import { useState, useEffect } from 'react';
import { getOnboarding, patchOnboarding } from '../api.js';

// Steps that are tracked locally (backend may not have these fields)
const LOCAL_STEPS = ['add_berths', 'add_member'];

function readLocal() {
  try { return JSON.parse(localStorage.getItem('onboarding_local') || '{}'); } catch { return {}; }
}
function writeLocal(data) {
  localStorage.setItem('onboarding_local', JSON.stringify(data));
}

export default function useOnboarding() {
  const [remote, setRemote] = useState(null);
  const [local, setLocal]   = useState(readLocal);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOnboarding()
      .then(data => setRemote(data))
      .catch(() => setRemote(null))
      .finally(() => setLoading(false));
  }, []);

  const onboarding = remote ? { ...remote, ...local } : null;

  async function markStep(key) {
    if (LOCAL_STEPS.includes(key)) {
      const next = { ...local, [key]: true };
      setLocal(next);
      writeLocal(next);
      return;
    }
    const snapshot = remote;
    setRemote(prev => prev ? { ...prev, [key]: true } : prev);
    try {
      const updated = await patchOnboarding({ [key]: true });
      setRemote(updated);
    } catch {
      setRemote(snapshot);
    }
  }

  const allDone = onboarding ? Object.values(onboarding).every(Boolean) : false;

  return { onboarding, loading, markStep, allDone };
}
