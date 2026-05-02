import { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Line, Circle, Rect } from 'react-konva';
import { CELL, GRID_MINOR, GRID_MAJOR, PIER_TYPE_COLORS, PIER_TYPES } from './mapConstants';
import { snapPointToGrid, snapToGrid } from './gridSnap';
import { findNearestEdge } from './edgeSnap';
import PierLayer from './PierLayer';
import BerthLayer from './BerthLayer';
import AmenityLayer from './AmenityLayer';

const CANVAS_W = 2000;
const CANVAS_H = 1500;

const EMPTY_DRAFT = {
  piers:             {},
  newPiers:          [],
  deletedPierIds:    [],
  berths:            {},
  amenities:         {},
  newAmenities:      [],
  deletedAmenityIds: [],
};

// ---------------------------------------------------------------------------
// GridLayer — two-tier: minor lines every 1m, major lines every 5m
// ---------------------------------------------------------------------------
function GridLayer({ width, height, scale }) {
  const lines = [];
  for (let x = 0; x <= width; x += GRID_MINOR) {
    const isMajor = x % GRID_MAJOR === 0;
    lines.push(
      <Line key={'v' + x} points={[x, 0, x, height]}
        stroke={isMajor ? '#cbd5e1' : '#e5e7eb'}
        strokeWidth={(isMajor ? 1 : 0.5) / scale}
        listening={false} />
    );
  }
  for (let y = 0; y <= height; y += GRID_MINOR) {
    const isMajor = y % GRID_MAJOR === 0;
    lines.push(
      <Line key={'h' + y} points={[0, y, width, y]}
        stroke={isMajor ? '#cbd5e1' : '#e5e7eb'}
        strokeWidth={(isMajor ? 1 : 0.5) / scale}
        listening={false} />
    );
  }
  return <Layer listening={false}>{lines}</Layer>;
}

// ---------------------------------------------------------------------------
// FloatingConfirmPanel — replaces window.prompt after polygon close
// ---------------------------------------------------------------------------
function FloatingConfirmPanel({ position, pierType, onConfirm, onCancel }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');

  return (
    <div style={{
      position: 'absolute',
      left: position.x + 10,
      top: position.y + 10,
      background: 'white',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: 12,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      zIndex: 20,
      width: 200,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: '#374151' }}>
        New {PIER_TYPES.find(t => t.value === pierType)?.label || 'Pier'}
      </div>
      <input
        autoFocus
        placeholder="Code (e.g. A)"
        value={code}
        onChange={e => setCode(e.target.value)}
        style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 6, boxSizing: 'border-box' }}
        onKeyDown={e => { if (e.key === 'Enter') onConfirm(code.trim(), label.trim()); if (e.key === 'Escape') onCancel(); }}
      />
      <input
        placeholder="Label (optional)"
        value={label}
        onChange={e => setLabel(e.target.value)}
        style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
        onKeyDown={e => { if (e.key === 'Enter') onConfirm(code.trim(), label.trim()); if (e.key === 'Escape') onCancel(); }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onConfirm(code.trim(), label.trim())}
          disabled={!code.trim()}
          style={{ flex: 1, background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 12, cursor: code.trim() ? 'pointer' : 'not-allowed' }}
        >Confirm</button>
        <button
          onClick={onCancel}
          style={{ flex: 1, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, padding: '5px 0', fontSize: 12, cursor: 'pointer' }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// findNearestGhostSlot — returns { pierId, slotIndex, slot } or null
// ---------------------------------------------------------------------------
function findNearestGhostSlot(piers, berthX, berthY, thresholdM = 1) {
  let best = null;
  for (const pier of piers) {
    for (let i = 0; i < (pier.ghost_slots?.length || 0); i++) {
      const slot = pier.ghost_slots[i];
      const dist = Math.hypot(slot.x - berthX, slot.y - berthY);
      if (dist <= thresholdM && (!best || dist < best.dist)) {
        best = { pierId: pier.id, slotIndex: i, slot, dist };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// EditorCanvas
// ---------------------------------------------------------------------------
export default function EditorCanvas({
  piers = [], berths = [], amenities = [],
  onSave, onPierCreate, onPierDelete, onGhostSlotRemove,
  activePierType = 'concrete',
  prefabs = [],
}) {
  const [activeTool, setActiveTool]       = useState('select');
  const [gridOn, setGridOn]               = useState(true);
  const [selectedBerthId, setSelectedBerthId]     = useState(null);
  const [selectedAmenityId, setSelectedAmenityId] = useState(null);
  const [selectedPierId, setSelectedPierId]       = useState(null);
  const [draft, setDraft]                 = useState(EMPTY_DRAFT);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [cursorPos, setCursorPos]         = useState(null);
  const [confirmPanel, setConfirmPanel]   = useState(null); // { screenX, screenY, points }
  const [stageScale, setStageScale]       = useState(1);
  const [stagePos, setStagePos]           = useState({ x: 0, y: 0 });
  const isPanning    = useRef(false);
  const lastPointer  = useRef(null);
  const stageRef     = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setDrawingPoints([]);
        setCursorPos(null);
        setConfirmPanel(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // When parent selects a material type, switch to draw-pier mode automatically
  const prevPierTypeRef = useRef(activePierType);
  useEffect(() => {
    if (activePierType !== prevPierTypeRef.current) {
      prevPierTypeRef.current = activePierType;
      setActiveTool('draw-pier');
    }
  }, [activePierType]);

  const pendingCount =
    Object.keys(draft.piers).length + draft.newPiers.length + draft.deletedPierIds.length +
    Object.keys(draft.berths).length + Object.keys(draft.amenities).length +
    draft.newAmenities.length + draft.deletedAmenityIds.length;

  const mergedBerths = berths.map(b => {
    const override = draft.berths[b.id];
    return override ? { ...b, ...override } : b;
  });
  const mergedAmenities = [
    ...amenities.map(a => { const o = draft.amenities[a.id]; return o ? { ...a, ...o } : a; }),
    ...draft.newAmenities.map((a, i) => ({ ...a, id: `new-amenity-${i}` })),
  ];
  const mergedPiers = piers
    .filter(p => !draft.deletedPierIds.includes(p.id))
    .map(p => { const o = draft.piers[p.id]; return o ? { ...p, ...o } : p; });

  // --- Zoom / pan ---
  function handleWheel(e) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    const scaleBy = 1.08;
    const newScale = Math.max(0.2, Math.min(5, e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy));
    const mousePointTo = { x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale };
    setStageScale(newScale);
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  }
  function handleMouseDown(e) {
    if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.altKey)) {
      isPanning.current = true;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      e.evt.preventDefault();
    }
  }
  function handleMouseMove(e) {
    if (isPanning.current) {
      const dx = e.evt.clientX - lastPointer.current.x;
      const dy = e.evt.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (activeTool === 'draw-pier' && drawingPoints.length > 0) {
      const pos = stageRef.current.getRelativePointerPosition();
      const rawX = pos.x / CELL, rawY = pos.y / CELL;
      setCursorPos({ x: snapToGrid(rawX), y: snapToGrid(rawY) });
    }
  }
  function handleMouseUp() { isPanning.current = false; }

  // --- Stage click ---
  function handleStageClick(e) {
    if (isPanning.current) return;
    if (e.target !== e.target.getStage() && e.target.name() !== 'background') return;
    if (activeTool === 'select') {
      setSelectedBerthId(null); setSelectedAmenityId(null); setSelectedPierId(null);
      return;
    }
    if (activeTool === 'draw-pier') {
      const pos = stageRef.current.getRelativePointerPosition();
      const [sx, sy] = snapPointToGrid(pos.x / CELL, pos.y / CELL);
      setDrawingPoints(prev => [...prev, [sx, sy]]);
    }
  }

  // --- Double-click: close polygon, show floating confirm panel ---
  function handleStageDblClick(e) {
    if (activeTool !== 'draw-pier' || drawingPoints.length < 3) return;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const lastPt = drawingPoints[drawingPoints.length - 1];
    const screenX = lastPt[0] * CELL * stageScale + stagePos.x + rect.left - rect.left;
    const screenY = lastPt[1] * CELL * stageScale + stagePos.y;
    setConfirmPanel({ screenX, screenY, points: drawingPoints });
    setDrawingPoints([]);
    setCursorPos(null);
  }

  function handleConfirmPier(code, label) {
    if (!code || !confirmPanel) return;
    onPierCreate?.({
      code,
      label,
      pier_type: activePierType,
      polygon_points: confirmPanel.points,
      ghost_slots: [],
    });
    setConfirmPanel(null);
  }

  // --- Select callbacks ---
  function handleBerthClick(berth)   { if (activeTool !== 'select') return; setSelectedBerthId(berth.id); setSelectedAmenityId(null); setSelectedPierId(null); }
  function handleAmenityClick(a)     { if (activeTool !== 'select') return; setSelectedAmenityId(a.id); setSelectedBerthId(null); setSelectedPierId(null); }
  function handlePierClick(pier)     { if (activeTool !== 'select') return; setSelectedPierId(pier.id); setSelectedBerthId(null); setSelectedAmenityId(null); }

  // --- Berth drag on canvas → snap to grid, check ghost slots ---
  function handleBerthDragEnd(id, x, y) {
    const [sx, sy] = snapPointToGrid(x, y);
    let finalX = sx, finalY = sy, finalRot = null;
    const ghostSnap = findNearestGhostSlot(mergedPiers, sx, sy);
    if (ghostSnap) {
      finalX = ghostSnap.slot.x;
      finalY = ghostSnap.slot.y;
      finalRot = ghostSnap.slot.rotation;
      onGhostSlotRemove?.(ghostSnap.pierId, ghostSnap.slotIndex);
    }
    setDraft(prev => ({
      ...prev,
      berths: {
        ...prev.berths,
        [id]: {
          ...(prev.berths[id] || {}),
          canvas_x: finalX,
          canvas_y: finalY,
          ...(finalRot !== null ? { canvas_rotation: finalRot } : {}),
        },
      },
    }));
  }

  // --- Amenity drag on canvas → snap to grid ---
  function handleAmenityDragEnd(id, x, y) {
    const [sx, sy] = snapPointToGrid(x, y);
    if (String(id).startsWith('new-amenity-')) {
      const idx = parseInt(id.replace('new-amenity-', ''), 10);
      setDraft(prev => { const arr = [...prev.newAmenities]; arr[idx] = { ...arr[idx], canvas_x: sx, canvas_y: sy }; return { ...prev, newAmenities: arr }; });
    } else {
      setDraft(prev => ({ ...prev, amenities: { ...prev.amenities, [id]: { ...(prev.amenities[id] || {}), canvas_x: sx, canvas_y: sy } } }));
    }
  }
  function handleAmenityTransformEnd(id, { canvas_x, canvas_y, rotation, scale }) {
    const [sx, sy] = snapPointToGrid(canvas_x, canvas_y);
    if (String(id).startsWith('new-amenity-')) {
      const idx = parseInt(id.replace('new-amenity-', ''), 10);
      setDraft(prev => { const arr = [...prev.newAmenities]; arr[idx] = { ...arr[idx], canvas_x: sx, canvas_y: sy, rotation, scale }; return { ...prev, newAmenities: arr }; });
    } else {
      setDraft(prev => ({ ...prev, amenities: { ...prev.amenities, [id]: { ...(prev.amenities[id] || {}), canvas_x: sx, canvas_y: sy, rotation, scale } } }));
    }
  }

  function handleDeletePier() {
    if (!selectedPierId) return;
    onPierDelete?.(selectedPierId);
    setSelectedPierId(null);
  }

  // --- HTML DnD: berth from sidebar, amenity from sidebar, prefab from sidebar ---
  function handleDragOver(e) { e.preventDefault(); }

  function handleDrop(e) {
    e.preventDefault();
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const dropPixelX = (e.clientX - rect.left - stagePos.x) / stageScale;
    const dropPixelY = (e.clientY - rect.top  - stagePos.y) / stageScale;
    const [dropMetreX, dropMetreY] = snapPointToGrid(dropPixelX / CELL, dropPixelY / CELL);

    const berthId     = e.dataTransfer.getData('berthId');
    const amenityType = e.dataTransfer.getData('amenityType');
    const prefabId    = e.dataTransfer.getData('prefabId');

    if (berthId) {
      // Edge snap first, fallback to grid snap
      let canvas_x = dropMetreX, canvas_y = dropMetreY, canvas_rotation = 0;
      for (const pier of mergedPiers) {
        const snap = findNearestEdge(pier.polygon_points, dropMetreX, dropMetreY, 2);
        if (snap) { canvas_x = snap.x; canvas_y = snap.y; canvas_rotation = snap.rotation; break; }
      }
      // Check ghost slot proximity
      const ghostSnap = findNearestGhostSlot(mergedPiers, canvas_x, canvas_y);
      if (ghostSnap) {
        canvas_x = ghostSnap.slot.x;
        canvas_y = ghostSnap.slot.y;
        canvas_rotation = ghostSnap.slot.rotation;
        onGhostSlotRemove?.(ghostSnap.pierId, ghostSnap.slotIndex);
      }
      setDraft(prev => ({ ...prev, berths: { ...prev.berths, [berthId]: { canvas_x, canvas_y, canvas_rotation } } }));
    }

    if (amenityType) {
      setDraft(prev => ({
        ...prev,
        newAmenities: [...prev.newAmenities, {
          type: amenityType, label: '',
          canvas_x: dropMetreX, canvas_y: dropMetreY,
          scale: 1, rotation: 0,
        }],
      }));
    }

    if (prefabId) {
      const prefab = prefabs.find(p => String(p.id) === prefabId);
      if (!prefab) return;
      const offsetPoints = prefab.polygon_points.map(([x, y]) => [x + dropMetreX, y + dropMetreY]);
      const offsetSlots  = prefab.berth_slots.map(s => ({ ...s, x: s.x + dropMetreX, y: s.y + dropMetreY }));
      onPierCreate?.({
        code:           prefab.label_template || prefab.name,
        label:          '',
        pier_type:      prefab.pier_type,
        polygon_points: offsetPoints,
        ghost_slots:    offsetSlots,
      });
    }
  }

  // --- Save / Discard ---
  async function handleSave()    { await onSave?.(draft); }
  function handleDiscard()       { setDraft(EMPTY_DRAFT); setSelectedBerthId(null); setSelectedAmenityId(null); setSelectedPierId(null); }

  // --- Draw-pier preview ---
  const previewPoints = (() => {
    if (activeTool !== 'draw-pier' || drawingPoints.length === 0 || !cursorPos) return null;
    const last = drawingPoints[drawingPoints.length - 1];
    return [last[0] * CELL, last[1] * CELL, cursorPos.x * CELL, cursorPos.y * CELL];
  })();
  const drawnPolyPoints = drawingPoints.flatMap(([x, y]) => [x * CELL, y * CELL]);

  function toolBtn(tool) {
    const active = activeTool === tool;
    return { padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13, background: active ? '#2563eb' : '#ffffff', color: active ? '#ffffff' : '#1e293b', fontWeight: active ? 600 : 400 };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Simplified toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
        <button style={toolBtn('select')} onClick={() => setActiveTool('select')}>Select</button>

        {selectedPierId && (
          <button
            style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #ef4444', cursor: 'pointer', fontSize: 13, background: '#fee2e2', color: '#dc2626' }}
            onClick={handleDeletePier}
          >Delete Pier</button>
        )}

        <div style={{ width: 1, height: 24, background: '#e2e8f0', margin: '0 4px' }} />

        <button
          style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13, background: gridOn ? '#f0fdf4' : '#ffffff', color: gridOn ? '#166534' : '#1e293b' }}
          onClick={() => setGridOn(g => !g)}
        >Grid: {gridOn ? 'ON' : 'OFF'}</button>

        <div style={{ flex: 1 }} />

        <button
          style={{ padding: '4px 14px', borderRadius: 4, border: '1px solid #2563eb', cursor: 'pointer', fontSize: 13, background: '#2563eb', color: '#ffffff', fontWeight: 600 }}
          onClick={handleSave}
        >Save{pendingCount > 0 ? ` (${pendingCount} changes)` : ''}</button>
        <button
          style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13 }}
          onClick={handleDiscard}
        >Discard</button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: activeTool === 'draw-pier' ? 'crosshair' : 'default' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <Stage
          ref={stageRef}
          width={containerRef.current?.clientWidth || 900}
          height={containerRef.current?.clientHeight || 600}
          scaleX={stageScale} scaleY={stageScale}
          x={stagePos.x} y={stagePos.y}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          onDblClick={handleStageDblClick}
        >
          <Layer>
            <Rect name="background" x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#deeef7" listening={true} />
          </Layer>
          {gridOn && <GridLayer width={CANVAS_W} height={CANVAS_H} scale={stageScale} />}
          <PierLayer piers={mergedPiers} selectedPierId={selectedPierId} onPierClick={handlePierClick} />
          <BerthLayer berths={mergedBerths} selectedBerthId={selectedBerthId} onBerthClick={handleBerthClick} draggable={activeTool === 'select'} onBerthDragEnd={handleBerthDragEnd} />
          <AmenityLayer amenities={mergedAmenities} selectedAmenityId={selectedAmenityId} onAmenityClick={handleAmenityClick} draggable={activeTool === 'select'} onAmenityDragEnd={handleAmenityDragEnd} onAmenityTransformEnd={handleAmenityTransformEnd} />
          {activeTool === 'draw-pier' && (
            <Layer>
              {drawnPolyPoints.length >= 4 && (
                <Line points={drawnPolyPoints} stroke={PIER_TYPE_COLORS[activePierType] || '#2563eb'} strokeWidth={2 / stageScale} dash={[6 / stageScale, 3 / stageScale]} listening={false} />
              )}
              {previewPoints && (
                <Line points={previewPoints} stroke={PIER_TYPE_COLORS[activePierType] || '#2563eb'} strokeWidth={1.5 / stageScale} dash={[4 / stageScale, 4 / stageScale]} listening={false} />
              )}
              {drawingPoints.map(([x, y], i) => (
                <Circle key={i} x={x * CELL} y={y * CELL} radius={4 / stageScale} fill={PIER_TYPE_COLORS[activePierType] || '#2563eb'} listening={false} />
              ))}
            </Layer>
          )}
        </Stage>

        {/* Floating confirm panel after polygon close */}
        {confirmPanel && (
          <FloatingConfirmPanel
            position={{ x: confirmPanel.screenX, y: confirmPanel.screenY }}
            pierType={activePierType}
            onConfirm={handleConfirmPier}
            onCancel={() => setConfirmPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
