import { useEffect, useState } from 'react';

const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

let _loadPromise = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload  = () => resolve(window.L);
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.head.appendChild(script);
  });
  return _loadPromise;
}

export default function useLeaflet() {
  const [L, setL]       = useState(window.L ?? null);
  const [error, setErr] = useState(null);

  useEffect(() => {
    if (L) return;
    loadLeaflet().then(setL).catch(setErr);
  }, [L]);

  return { L, error };
}
