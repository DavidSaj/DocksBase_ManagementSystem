import { useEffect, useRef, useState } from 'react';
import useLeaflet from '../hooks/useLeaflet.js';
import api from '../api.js';

const NM_TO_METERS = 1852;

export default function BasinPolygonEditor({ marina, onSaved }) {
  const { L, error: leafletError } = useLeaflet();
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const polygonRef = useRef(null);
  const markersRef = useRef([]);
  const [vertices, setVertices] = useState(marina.basin_polygon ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Keep a ref of vertices so the map click handler (bound once) sees the latest.
  const verticesRef = useRef(vertices);
  useEffect(() => { verticesRef.current = vertices; }, [vertices]);

  // Build the map once Leaflet is ready.
  useEffect(() => {
    if (!L || !containerRef.current || mapRef.current) return;

    const lat = Number(marina.lat);
    const lng = Number(marina.lng);
    const map = L.map(containerRef.current).setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    L.marker([lat, lng], { interactive: false }).addTo(map);
    L.circle([lat, lng], {
      radius: (marina.ais_poll_radius_nm ?? 10) * NM_TO_METERS,
      color: '#888', weight: 1, fillOpacity: 0.05, interactive: false,
    }).addTo(map);

    map.on('click', (e) => {
      setVertices([...verticesRef.current, [e.latlng.lat, e.latlng.lng]]);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [L, marina.lat, marina.lng, marina.ais_poll_radius_nm]);

  // Redraw polygon + draggable markers whenever vertices change.
  useEffect(() => {
    if (!L || !mapRef.current) return;
    const map = mapRef.current;

    if (polygonRef.current) { map.removeLayer(polygonRef.current); polygonRef.current = null; }
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    if (vertices.length >= 3) {
      polygonRef.current = L.polygon(vertices, { color: '#0075de', fillOpacity: 0.15 }).addTo(map);
    }

    vertices.forEach((v, i) => {
      const m = L.circleMarker(v, { radius: 6, color: '#0075de', fillOpacity: 1 })
        .addTo(map);
      m.on('contextmenu', (ev) => {
        ev.originalEvent.preventDefault();
        setVertices(vs => vs.filter((_, j) => j !== i));
      });
      m.on('mousedown', (downEvt) => {
        downEvt.originalEvent.preventDefault();
        map.dragging.disable();
        const moveHandler = (mvEvt) => {
          setVertices(vs => vs.map((x, j) => j === i ? [mvEvt.latlng.lat, mvEvt.latlng.lng] : x));
        };
        const upHandler = () => {
          map.off('mousemove', moveHandler);
          map.off('mouseup', upHandler);
          map.dragging.enable();
        };
        map.on('mousemove', moveHandler);
        map.on('mouseup', upHandler);
      });
      markersRef.current.push(m);
    });
  }, [L, vertices]);

  async function save() {
    setSaving(true); setErr('');
    try {
      await api.patch('/marina/profile/', { basin_polygon: vertices });
      onSaved?.(vertices);
    } catch (e) {
      const detail = e?.response?.data?.basin_polygon?.[0]
        ?? e?.response?.data?.detail
        ?? 'Save failed.';
      setErr(String(detail));
    } finally {
      setSaving(false);
    }
  }

  if (leafletError) {
    return (
      <div style={{ fontSize: 12, color: 'var(--red)' }}>
        Could not load the map. Edit the polygon JSON manually in marina settings.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 8 }}>
        Click on the map to add vertices. Drag a vertex to move it. Right-click a vertex to delete.
      </div>
      <div ref={containerRef} style={{ height: 400, borderRadius: 8, overflow: 'hidden', border: 'var(--border)' }} />
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, gap: 10 }}>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>Vertices: {vertices.length}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setVertices([])} disabled={!vertices.length}>
          Clear
        </button>
        <div style={{ flex: 1 }} />
        {err && <span style={{ fontSize: 11, color: 'var(--red)' }}>{err}</span>}
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || vertices.length < 3}>
          {saving ? 'Saving…' : 'Save Polygon'}
        </button>
      </div>
    </div>
  );
}
