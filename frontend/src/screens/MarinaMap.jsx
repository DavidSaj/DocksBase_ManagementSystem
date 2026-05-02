import { useState, useCallback } from 'react';
import { usePiers }    from '../hooks/usePiers';
import { useBerths }   from '../hooks/useBerths';
import { useAmenities } from '../hooks/useAmenities';
import { usePrefabs }  from '../hooks/usePrefabs';
import LiveCanvas      from '../components/harbor-map/LiveCanvas';
import EditorCanvas    from '../components/harbor-map/EditorCanvas';
import AssetPanel      from '../components/harbor-map/AssetPanel';
import BerthStatusSidebar from '../components/harbor-map/BerthStatusSidebar';
import DocksBerthsTab  from '../components/harbor-map/DocksBerthsTab';
import MapBuilder      from '../components/harbor-map/MapBuilder';

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
  const [tab, setTab]               = useState('live');
  const [selectedBerth, setSelectedBerth] = useState(null);
  const [activePierType, setActivePierType] = useState('concrete');
  const [selectedPierId, setSelectedPierId] = useState(null);

  const { piers, createPier, updatePier, deletePier, bulkGenerate } = usePiers();
  const { berths, updateBerth, deleteBerth, addBerths, removeBerthsByPier } = useBerths();
  const { amenities, createAmenity, updateAmenity, deleteAmenity } = useAmenities();
  const { prefabs, createPrefab, deletePrefab } = usePrefabs();

  const selectedPier  = piers.find(p => p.id === selectedPierId) || null;
  const pierBerths    = selectedPierId ? berths.filter(b => b.pier === selectedPierId) : [];

  async function handleEditorSave(draft) {
    const berthUpdates   = Object.entries(draft.berths).map(([id, data]) => updateBerth(Number(id), data));
    const amenityUpdates = Object.entries(draft.amenities).map(([id, data]) => updateAmenity(Number(id), data));
    const amenityCreates = draft.newAmenities.map(data => createAmenity(data));
    const amenityDeletes = draft.deletedAmenityIds.map(id => deleteAmenity(id));
    const pierUpdates    = Object.entries(draft.piers).map(([id, data]) => updatePier(Number(id), data));
    await Promise.allSettled([...berthUpdates, ...amenityUpdates, ...amenityCreates, ...amenityDeletes, ...pierUpdates]);
  }

  function handlePierCreate(pierData) {
    createPier(pierData);
  }

  function handlePierDelete(pierId) {
    deletePier(pierId);
    removeBerthsByPier(pierId);
  }

  const handleGhostSlotRemove = useCallback((pierId, slotIndex) => {
    const pier = piers.find(p => p.id === pierId);
    if (!pier) return;
    const newSlots = pier.ghost_slots.filter((_, i) => i !== slotIndex);
    updatePier(pierId, { ghost_slots: newSlots });
  }, [piers, updatePier]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e7eb', background: 'white', paddingLeft: 16, flexShrink: 0 }}>
        <button style={tabStyle(tab === 'live')}    onClick={() => setTab('live')}>Marina Map</button>
        <button style={tabStyle(tab === 'editor')}  onClick={() => setTab('editor')}>Map Editor</button>
        <button style={tabStyle(tab === 'docks')}   onClick={() => setTab('docks')}>Docks & Berths</button>
        <button style={tabStyle(tab === 'creator')} onClick={() => setTab('creator')}>Map Builder</button>
      </div>

      {tab === 'live' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <LiveCanvas piers={piers} berths={berths} amenities={amenities} selectedBerthId={selectedBerth?.id} onBerthClick={setSelectedBerth} onAmenityClick={() => {}} />
            <BerthDetailPanel berth={selectedBerth} onClose={() => setSelectedBerth(null)} onUpdateBerth={updateBerth} />
          </div>
          <BerthStatusSidebar berths={berths} selectedBerthId={selectedBerth?.id} onBerthClick={setSelectedBerth} />
        </div>
      )}

      {tab === 'editor' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <AssetPanel
            activePierType={activePierType}
            onMaterialSelect={(pierType) => { setActivePierType(pierType); }}
            prefabs={prefabs}
            selectedPier={selectedPier}
            pierBerths={pierBerths}
            onSavePrefab={createPrefab}
            onDeletePrefab={deletePrefab}
            berths={berths}
            piers={piers}
          />
          <div style={{ flex: 1, position: 'relative' }}>
            <EditorCanvas
              piers={piers}
              berths={berths}
              amenities={amenities}
              prefabs={prefabs}
              activePierType={activePierType}
              onSave={handleEditorSave}
              onPierCreate={handlePierCreate}
              onPierDelete={(id) => handlePierDelete(id)}
              onGhostSlotRemove={handleGhostSlotRemove}
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
            onDeletePier={(id) => handlePierDelete(id)}
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

      {tab === 'creator' && <MapBuilder />}
    </div>
  );
}
