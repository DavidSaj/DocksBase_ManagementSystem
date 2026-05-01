import { useState, useCallback } from 'react';
import { usePiers } from '../hooks/usePiers';
import { useBerths } from '../hooks/useBerths';
import DigitalTwinCanvas from '../components/harbor-map/DigitalTwinCanvas';
import BerthStatusSidebar from '../components/harbor-map/BerthStatusSidebar';
import UnmappedBerthsSidebar from '../components/harbor-map/UnmappedBerthsSidebar';
import DocksBerthsTab from '../components/harbor-map/DocksBerthsTab';

const tabStyle = (active) => ({
  padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
  color: active ? '#2563eb' : '#6b7280', background: 'none', border: 'none',
  borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
});

function BerthDetailPanel({ berth, onClose, onUpdateBerth }) {
  if (!berth) return null;
  return (
    <div style={{
      position: 'absolute', top: 16, right: 256, background: 'white',
      border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, width: 220,
      boxShadow: '0 4px 20px rgba(0,0,0,0.1)', zIndex: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{berth.code}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af' }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div><b>Status:</b> {berth.status}</div>
        <div><b>Dock:</b> {berth.pier_code}</div>
        {berth.length_m && <div><b>Length:</b> {berth.length_m}m</div>}
        {berth.max_beam_m && <div><b>Beam:</b> {berth.max_beam_m}m</div>}
        {berth.vessel_name && <div><b>Vessel:</b> {berth.vessel_name}</div>}
        {berth.price_per_night && <div><b>Rate:</b> €{berth.price_per_night}/night</div>}
      </div>
      <select
        value={berth.status}
        onChange={e => onUpdateBerth(berth.id, { status: e.target.value })}
        style={{ marginTop: 10, width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5 }}
      >
        {['available', 'occupied', 'reserved', 'maintenance'].map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}

export default function MarinaMap() {
  const [tab, setTab] = useState('live');
  const [selectedBerth, setSelectedBerth] = useState(null);

  const { piers, createPier, updatePier, deletePier, bulkGenerate } = usePiers();
  const { berths, updateBerth, deleteBerth, addBerths } = useBerths();

  const [pendingPositions, setPendingPositions] = useState({});
  const [saving, setSaving] = useState(false);

  const handleBerthDrop = useCallback((berthId, canvasX, canvasY) => {
    const berth = berths.find(b => b.id === berthId);
    if (!berth) return;
    setPendingPositions(prev => ({ ...prev, [berthId]: { canvas_x: canvasX, canvas_y: canvasY } }));
    updateBerth(berthId, {
      canvas_x: canvasX,
      canvas_y: canvasY,
      canvas_width: berth.canvas_width || 4,
      canvas_height: berth.canvas_height || 12,
      canvas_rotation: berth.canvas_rotation || 0,
    });
  }, [berths, updateBerth]);

  const handleSaveLayout = async () => {
    setSaving(true);
    try {
      setPendingPositions({});
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = Object.keys(pendingPositions).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid #e5e7eb', background: 'white', paddingLeft: 16, flexShrink: 0,
      }}>
        <button style={tabStyle(tab === 'live')}   onClick={() => setTab('live')}>Marina Map</button>
        <button style={tabStyle(tab === 'editor')} onClick={() => setTab('editor')}>Map Editor</button>
        <button style={tabStyle(tab === 'docks')}  onClick={() => setTab('docks')}>Docks & Berths</button>

        {tab === 'editor' && pendingCount > 0 && (
          <button
            onClick={handleSaveLayout}
            disabled={saving}
            style={{
              marginLeft: 'auto', marginRight: 16,
              background: '#2563eb', color: 'white', border: 'none',
              borderRadius: 6, padding: '6px 16px', fontSize: 12,
              fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : `Save Layout (${pendingCount} changes)`}
          </button>
        )}
      </div>

      {tab === 'live' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <DigitalTwinCanvas
              piers={piers}
              berths={berths}
              mode="view"
              selectedBerthId={selectedBerth?.id}
              onBerthClick={setSelectedBerth}
              showGrid={false}
            />
            <BerthDetailPanel
              berth={selectedBerth}
              onClose={() => setSelectedBerth(null)}
              onUpdateBerth={updateBerth}
            />
          </div>
          <BerthStatusSidebar
            berths={berths}
            selectedBerthId={selectedBerth?.id}
            onBerthClick={setSelectedBerth}
          />
        </div>
      )}

      {tab === 'editor' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <UnmappedBerthsSidebar berths={berths} piers={piers} />
          <div style={{ flex: 1, position: 'relative' }}>
            <DigitalTwinCanvas
              piers={piers}
              berths={berths}
              mode="edit"
              selectedBerthId={selectedBerth?.id}
              onBerthClick={setSelectedBerth}
              onBerthDrop={handleBerthDrop}
              showGrid={true}
            />
          </div>
        </div>
      )}

      {tab === 'docks' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DocksBerthsTab
            piers={piers}
            berths={berths}
            onCreatePier={createPier}
            onUpdatePier={updatePier}
            onDeletePier={deletePier}
            onBulkGenerate={async (pierId, data) => {
              const created = await bulkGenerate(pierId, data);
              addBerths(created);
              return created;
            }}
            onUpdateBerth={updateBerth}
            onDeleteBerth={deleteBerth}
          />
        </div>
      )}
    </div>
  );
}
