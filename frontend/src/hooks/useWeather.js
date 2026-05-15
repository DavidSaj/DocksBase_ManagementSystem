import { useState, useEffect } from 'react';
import api from '../api.js';

/**
 * Fetches current weather from the backend, which proxies OpenWeatherMap
 * if the marina has configured an API key, or Open-Meteo as a free fallback.
 * The hook keeps the `weather` shape consistent with what Overview.jsx renders.
 *
 * The `lat`/`lng` args are kept for backward compatibility / gating only —
 * the backend reads the marina's location from the authenticated user, but
 * skipping the fetch when no location is set spares a 400 round-trip.
 */
export default function useWeather(lat, lng) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!lat || !lng) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.get('/marina/weather/')
      .then(({ data }) => {
        if (cancelled) return;
        setWeather({
          temp: `${data.temp_c}°C`,
          wind: `${data.wind_kn}kn${data.wind_dir ? ` ${data.wind_dir}` : ''}`,
          swell: data.wave_height_m != null ? `${data.wave_height_m}m` : '—',
          condition: data.condition || 'Unknown',
          source: data.source,
          updatedAt: data.updated_at
            ? new Date(data.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '',
        });
      })
      .catch(e => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [lat, lng]);

  return { weather, loading, error };
}
