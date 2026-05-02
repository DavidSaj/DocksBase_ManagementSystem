import { useState } from 'react';
import { PIER_TYPE_COLORS } from './mapConstants';

function PrefabThumbnail({ polygonPoints, pierType }) {
  const W = 80, H = 48, PAD = 4;
  if (!polygonPoints?.length) return <div style={{ width: W, height: H, background: '#f3f4f6', borderRadius: 4 }} />;
  const xs = polygonPoints.map(p => p[0]);
  const ys = polygonPoints.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scaleX = (W - PAD * 2) / (maxX - minX || 1);
  const scaleY = (H - PAD * 2) / (maxY - minY || 1);
  const s = Math.min(scaleX, scaleY);
  const pts = polygonPoints.map(([x, y]) =>
    `${PAD + (x - minX) * s},${PAD + (y - minY) * s}`
  ).join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polygon points={pts} fill={PIER_TYPE_COLORS[pierType] || '#94a3b8'} stroke="#6b7280" strokeWidth={1} />
    </svg>
  );
}

export default function PrefabLibrary({
  prefabs = [],
  selectedPier,           // the currently selected pier object (or null)
  pierBerths = [],        // berths belonging to selectedPier
  onSavePrefab,           // async (data) => void
  onDeletePrefab,         // (id) => void
}) {
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName]         = useState('');
  const [saveTemplate, setSaveTemplate] = useState('');
  const [saving, setSaving]             = useState(false);

  async function handleSave() {
    if (!saveName.trim() || !selectedPier) return;
    // Normalize polygon_points to origin
    const pts = selectedPier.polygon_points;
    const minX = Math.min(...pts.map(p => p[0]));
    const minY = Math.min(...pts.map(p => p[1]));
    const normalizedPts = pts.map(([x, y]) => [x - minX, y - minY]);

    // Normalize berth slots to origin
    const slots = pierBerths
      .filter(b => b.canvas_x != null && b.canvas_y != null)
      .map(b => ({
        x:        b.canvas_x - minX,
        y:        b.canvas_y - minY,
        rotation: b.canvas_rotation || 0,
        width_m:  b.max_beam_m  || 4,
        height_m: b.length_m    || 12,
      }));

    setSaving(true);
    await onSavePrefab({
      name:           saveName.trim(),
      pier_type:      selectedPier.pier_type || 'concrete',
      polygon_points: normalizedPts,
      berth_slots:    slots,
      label_template: saveTemplate.trim(),
    });
    setSaving(false);
    setSaveName('');
    setSaveTemplate('');
    setShowSaveForm(false);
  }

  const inputStyle = {
    width: '100%', padding: '4px 6px', fontSize: 12,
    border: '1px solid #d1d5db', borderRadius: 4,
    boxSizing: 'border-box', marginBottom: 6,
  };

  return (
    <div>
      {/* Card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '6px 8px' }}>
        {prefabs.map(prefab => (
          <div
            key={prefab.id}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('prefabId', String(prefab.id));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            style={{
              background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
              padding: 6, cursor: 'grab', position: 'relative',
            }}
          >
            <PrefabThumbnail polygonPoints={prefab.polygon_points} pierType={prefab.pier_type} />
            <div style={{ fontSize: 10, fontWeight: 600, color: '#374151', marginTop: 4, lineHeight: 1.3 }}>
              {prefab.name}
            </div>
            {prefab.is_base ? (
              <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 10 }}>🔒</span>
            ) : (
              <button
                onClick={() => onDeletePrefab(prefab.id)}
                style={{
                  position: 'absolute', top: 2, right: 2,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: '#9ca3af', lineHeight: 1,
                }}
                title="Delete prefab"
              >×</button>
            )}
          </div>
        ))}
      </div>

      {/* Save current pier as prefab */}
      {selectedPier && !showSaveForm && (
        <div style={{ padding: '6px 8px' }}>
          <button
            onClick={() => { setShowSaveForm(true); setSaveTemplate(selectedPier.label || selectedPier.code); }}
            style={{
              width: '100%', background: '#f0fdf4', color: '#166534',
              border: '1px solid #bbf7d0', borderRadius: 5,
              padding: '5px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >+ Save Selected Pier as Prefab</button>
        </div>
      )}

      {selectedPier && showSaveForm && (
        <div style={{ padding: '6px 8px', background: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Save as Prefab</div>
          <input placeholder="Name (required)" value={saveName} onChange={e => setSaveName(e.target.value)} style={inputStyle} />
          <input placeholder="Label template (e.g. Pontoon {n})" value={saveTemplate} onChange={e => setSaveTemplate(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleSave} disabled={!saveName.trim() || saving}
              style={{ flex: 1, background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: saveName.trim() ? 'pointer' : 'not-allowed' }}
            >{saving ? 'Saving…' : 'Save'}</button>
            <button
              onClick={() => setShowSaveForm(false)}
              style={{ flex: 1, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
