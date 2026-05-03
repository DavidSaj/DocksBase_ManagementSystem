import { useState, useEffect } from 'react';

const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Showers', 81: 'Heavy showers', 82: 'Violent showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Thunderstorm + heavy hail',
};

function degToCompass(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

export default function useWeather(lat, lng) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!lat || !lng) return;
    setLoading(true);
    setError(null);

    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weathercode&wind_speed_unit=kn`;
    const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=wave_height`;

    Promise.all([
      fetch(wUrl).then(r => r.json()),
      fetch(mUrl).then(r => r.json()).catch(() => null),
    ])
      .then(([w, m]) => {
        const c = w.current;
        setWeather({
          temp: `${Math.round(c.temperature_2m)}°C`,
          wind: `${Math.round(c.wind_speed_10m)}kn ${degToCompass(c.wind_direction_10m)}`,
          swell: m?.current?.wave_height != null ? `${m.current.wave_height}m` : '—',
          condition: WMO[c.weathercode] ?? 'Unknown',
          updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, [lat, lng]);

  return { weather, loading, error };
}
