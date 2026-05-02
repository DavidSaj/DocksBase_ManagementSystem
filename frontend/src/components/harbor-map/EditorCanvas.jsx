import { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Line, Circle, Rect } from 'react-konva';
import { CELL, AMENITY_TYPES } from './mapConstants';
import PierLayer from './PierLayer';
import BerthLayer from './BerthLayer';
import AmenityLayer from './AmenityLayer';
import { findNearestEdge } from './edgeSnap';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
// GridLayer
// ---------------------------------------------------------------------------

function GridLayer({ width, height, scale }) {
  const step = CELL * 5;
  const lines = [];
  for (let x = 0; x <= width; x += step) {
    lines.push(
      <Line key={'v' + x} points={[x, 0, x, height]} stroke="#e5e7eb" strokeWidth={1 / scale} listening={false} />
    );
  }
  for (let y = 0; y <= height; y += step) {
    lines.push(
      <Line key={'h' + y} points={[0, y, width, y]} stroke="#e5e7eb" strokeWidth={1 / scale} listening={false} />
    );
  }
  return <Layer listening={false}>{lines}</Layer>;
}

// ---------------------------------------------------------------------------
// EditorCanvas
// ---------------------------------------------------------------------------

export default function EditorCanvas({ piers = [], berths = [], amenities = [], onSave, onPierCreate, onPierDelete }) {
  // --- Tool state ---
  const [activeTool, setActiveTool] = useState('select');

  // --- Grid ---
  const [gridOn, setGridOn] = useState(true);

  // --- Selection ---
  const [selectedBerthId, setSelectedBerthId]   = useState(null);
  const [selectedAmenityId, setSelectedAmenityId] = useState(null);
  const [selectedPierId, setSelectedPierId]     = useState(null);

  // --- Draft ---
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  // --- Draw Pier ---
  const [drawingPoints, setDrawingPoints] = useState([]); // [[x,y], ...] in metres
  const [cursorPos, setCursorPos]         = useState(null); // {x,y} in metres

  // --- Stage zoom/pan ---
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos]     = useState({ x: 0, y: 0 });
  const isPanning                   = useRef(false);
  const lastPointer                 = useRef(null);
  const stageRef                    = useRef(null);
  const containerRef                = useRef(null);

  // ---------------------------------------------------------------------------
  // Keyboard: Escape cancels draw-pier
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setDrawingPoints([]);
        setCursorPos(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---------------------------------------------------------------------------
  // Pending count
  // ---------------------------------------------------------------------------
  const pendingCount =
    Object.keys(draft.piers).length +
    draft.newPiers.length +
    draft.deletedPierIds.length +
    Object.keys(draft.berths).length +
    Object.keys(draft.amenities).length +
    draft.newAmenities.length +
    draft.deletedAmenityIds.length;

  // ---------------------------------------------------------------------------
  // Merge API data with draft overrides for rendering
  // ---------------------------------------------------------------------------
  const mergedBerths = berths.map(b => {
    const override = draft.berths[b.id];
    return override ? { ...b, ...override } : b;
  });

  const mergedAmenities = [
    ...amenities.map(a => {
      const override = draft.amenities[a.id];
      return override ? { ...a, ...override } : a;
    }),
    ...draft.newAmenities.map((a, i) => ({ ...a, id: `new-amenity-${i}` })),
  ];

  const mergedPiers = piers.filter(p => !draft.deletedPierIds.includes(p.id)).map(p => {
    const override = draft.piers[p.id];
    return override ? { ...p, ...override } : p;
  });

  // ---------------------------------------------------------------------------
  // Zoom / pan handlers
  // ---------------------------------------------------------------------------
  function handleWheel(e) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    const scaleBy = 1.08;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.2, Math.min(5, newScale));
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    setStageScale(clampedScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  }

  function handleMouseDown(e) {
    // Middle-click OR alt+left-click → pan
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
      const stage = stageRef.current;
      const pos = stage.getRelativePointerPosition();
      setCursorPos({ x: pos.x / CELL, y: pos.y / CELL });
    }
  }

  function handleMouseUp(e) {
    if (isPanning.current) {
      isPanning.current = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Stage click (background)
  // ---------------------------------------------------------------------------
  function handleStageClick(e) {
    if (isPanning.current) return;
    // Only react to clicks on the background rect
    if (e.target !== e.target.getStage() && e.target.name() !== 'background') return;

    if (activeTool === 'select') {
      setSelectedBerthId(null);
      setSelectedAmenityId(null);
      setSelectedPierId(null);
      return;
    }

    if (activeTool === 'draw-pier') {
      const stage = stageRef.current;
      const pos = stage.getRelativePointerPosition();
      const ptMetres = [pos.x / CELL, pos.y / CELL];
      setDrawingPoints(prev => [...prev, ptMetres]);
    }
  }

  function handleStageDblClick(e) {
    if (activeTool !== 'draw-pier') return;
    if (drawingPoints.length < 3) return;
    const code = window.prompt('Pier code (e.g. A):');
    if (!code) return;
    const label = window.prompt('Pier label (optional):') || '';
    const pierData = { code: code.trim(), label: label.trim(), polygon_points: drawingPoints };
    onPierCreate?.(pierData);
    setDrawingPoints([]);
    setCursorPos(null);
  }

  // ---------------------------------------------------------------------------
  // Select tool callbacks
  // ---------------------------------------------------------------------------
  function handleBerthClick(berth) {
    if (activeTool !== 'select') return;
    setSelectedBerthId(berth.id);
    setSelectedAmenityId(null);
    setSelectedPierId(null);
  }

  function handleAmenityClick(amenity) {
    if (activeTool !== 'select') return;
    setSelectedAmenityId(amenity.id);
    setSelectedBerthId(null);
    setSelectedPierId(null);
  }

  function handlePierClick(pier) {
    if (activeTool !== 'select') return;
    setSelectedPierId(pier.id);
    setSelectedBerthId(null);
    setSelectedAmenityId(null);
  }

  // ---------------------------------------------------------------------------
  // Drag / transform callbacks → update draft
  // ---------------------------------------------------------------------------
  function handleBerthDragEnd(id, x, y) {
    setDraft(prev => ({
      ...prev,
      berths: { ...prev.berths, [id]: { ...(prev.berths[id] || {}), canvas_x: x, canvas_y: y } },
    }));
  }

  function handleAmenityDragEnd(id, x, y) {
    // Could be a new amenity (id like "new-amenity-0")
    if (String(id).startsWith('new-amenity-')) {
      const idx = parseInt(id.replace('new-amenity-', ''), 10);
      setDraft(prev => {
        const arr = [...prev.newAmenities];
        arr[idx] = { ...arr[idx], canvas_x: x, canvas_y: y };
        return { ...prev, newAmenities: arr };
      });
    } else {
      setDraft(prev => ({
        ...prev,
        amenities: { ...prev.amenities, [id]: { ...(prev.amenities[id] || {}), canvas_x: x, canvas_y: y } },
      }));
    }
  }

  function handleAmenityTransformEnd(id, { canvas_x, canvas_y, rotation, scale }) {
    if (String(id).startsWith('new-amenity-')) {
      const idx = parseInt(id.replace('new-amenity-', ''), 10);
      setDraft(prev => {
        const arr = [...prev.newAmenities];
        arr[idx] = { ...arr[idx], canvas_x, canvas_y, rotation, scale };
        return { ...prev, newAmenities: arr };
      });
    } else {
      setDraft(prev => ({
        ...prev,
        amenities: { ...prev.amenities, [id]: { ...(prev.amenities[id] || {}), canvas_x, canvas_y, rotation, scale } },
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Delete selected pier
  // ---------------------------------------------------------------------------
  function handleDeletePier() {
    if (!selectedPierId) return;
    onPierDelete?.(selectedPierId);
    setSelectedPierId(null);
  }

  // ---------------------------------------------------------------------------
  // Add Amenity dropdown
  // ---------------------------------------------------------------------------
  function handleAmenityTypeSelect(e) {
    const type = e.target.value;
    if (!type) return;
    e.target.value = '';

    // Place at viewport center (account for pan/zoom)
    const container = containerRef.current;
    const rect = container ? container.getBoundingClientRect() : { width: 800, height: 600 };
    const centerCanvasX = (rect.width / 2 - stagePos.x) / stageScale;
    const centerCanvasY = (rect.height / 2 - stagePos.y) / stageScale;

    const newAmenity = {
      type,
      label: '',
      canvas_x: centerCanvasX / CELL,
      canvas_y: centerCanvasY / CELL,
      scale: 1,
      rotation: 0,
    };
    setDraft(prev => ({ ...prev, newAmenities: [...prev.newAmenities, newAmenity] }));
    setActiveTool('select');
  }

  // ---------------------------------------------------------------------------
  // HTML drag-and-drop (berth from sidebar)
  // ---------------------------------------------------------------------------
  function handleDragOver(e) {
    e.preventDefault();
  }

  function handleDrop(e) {
    e.preventDefault();
    const berthId = e.dataTransfer.getData('berthId');
    if (!berthId) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const dropPixelX = (e.clientX - rect.left - stagePos.x) / stageScale;
    const dropPixelY = (e.clientY - rect.top  - stagePos.y) / stageScale;
    const dropMetreX = dropPixelX / CELL;
    const dropMetreY = dropPixelY / CELL;

    // Try edge snap against all piers
    let snapResult = null;
    for (const pier of mergedPiers) {
      const snap = findNearestEdge(pier.polygon_points, dropMetreX, dropMetreY, 2);
      if (snap) { snapResult = snap; break; }
    }

    const canvas_x        = snapResult ? snapResult.x        : dropMetreX;
    const canvas_y        = snapResult ? snapResult.y        : dropMetreY;
    const canvas_rotation = snapResult ? snapResult.rotation : 0;

    setDraft(prev => ({
      ...prev,
      berths: { ...prev.berths, [berthId]: { canvas_x, canvas_y, canvas_rotation } },
    }));
  }

  // ---------------------------------------------------------------------------
  // Save / Discard
  // ---------------------------------------------------------------------------
  async function handleSave() {
    await onSave?.(draft);
  }

  function handleDiscard() {
    setDraft(EMPTY_DRAFT);
    setSelectedBerthId(null);
    setSelectedAmenityId(null);
    setSelectedPierId(null);
  }

  // ---------------------------------------------------------------------------
  // Draw-pier preview geometry
  // ---------------------------------------------------------------------------
  const previewPoints = (() => {
    if (activeTool !== 'draw-pier' || drawingPoints.length === 0 || !cursorPos) return null;
    const last = drawingPoints[drawingPoints.length - 1];
    return [last[0] * CELL, last[1] * CELL, cursorPos.x * CELL, cursorPos.y * CELL];
  })();

  const drawnPolyPoints = drawingPoints.flatMap(([x, y]) => [x * CELL, y * CELL]);

  // ---------------------------------------------------------------------------
  // Toolbar style helpers
  // ---------------------------------------------------------------------------
  function toolBtn(tool) {
    const active = activeTool === tool;
    return {
      padding: '4px 12px',
      borderRadius: 4,
      border: '1px solid #cbd5e1',
      cursor: 'pointer',
      fontSize: 13,
      background: active ? '#2563eb' : '#ffffff',
      color: active ? '#ffffff' : '#1e293b',
      fontWeight: active ? 600 : 400,
    };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
        <button style={toolBtn('select')} onClick={() => setActiveTool('select')}>Select</button>
        <button style={toolBtn('draw-pier')} onClick={() => setActiveTool('draw-pier')}>Draw Pier</button>

        {/* Add Amenity dropdown */}
        <select
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 13, cursor: 'pointer' }}
          defaultValue=""
          onChange={handleAmenityTypeSelect}
        >
          <option value="" disabled>Add Amenity ▾</option>
          {AMENITY_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* Delete pier button when a pier is selected */}
        {selectedPierId && (
          <button
            style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #ef4444', cursor: 'pointer', fontSize: 13, background: '#fee2e2', color: '#dc2626' }}
            onClick={handleDeletePier}
          >
            Delete Pier
          </button>
        )}

        <div style={{ width: 1, height: 24, background: '#e2e8f0', margin: '0 4px' }} />

        {/* Grid toggle */}
        <button
          style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13, background: gridOn ? '#f0fdf4' : '#ffffff', color: gridOn ? '#166534' : '#1e293b' }}
          onClick={() => setGridOn(g => !g)}
        >
          Grid: {gridOn ? 'ON' : 'OFF'}
        </button>

        <div style={{ flex: 1 }} />

        {/* Save / Discard */}
        <button
          style={{ padding: '4px 14px', borderRadius: 4, border: '1px solid #2563eb', cursor: 'pointer', fontSize: 13, background: '#2563eb', color: '#ffffff', fontWeight: 600 }}
          onClick={handleSave}
        >
          Save{pendingCount > 0 ? ` (${pendingCount} changes)` : ''}
        </button>
        <button
          style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13, background: '#ffffff', color: '#1e293b' }}
          onClick={handleDiscard}
        >
          Discard
        </button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', cursor: activeTool === 'draw-pier' ? 'crosshair' : 'default' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <Stage
          ref={stageRef}
          width={containerRef.current?.clientWidth || 900}
          height={containerRef.current?.clientHeight || 600}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          onDblClick={handleStageDblClick}
        >
          {/* Background */}
          <Layer>
            <Rect
              name="background"
              x={0} y={0}
              width={CANVAS_W} height={CANVAS_H}
              fill="#deeef7"
              listening={true}
            />
          </Layer>

          {/* Grid */}
          {gridOn && <GridLayer width={CANVAS_W} height={CANVAS_H} scale={stageScale} />}

          {/* Piers */}
          <PierLayer
            piers={mergedPiers}
            selectedPierId={selectedPierId}
            onPierClick={handlePierClick}
          />

          {/* Berths */}
          <BerthLayer
            berths={mergedBerths}
            selectedBerthId={selectedBerthId}
            onBerthClick={handleBerthClick}
            draggable={activeTool === 'select'}
            onBerthDragEnd={handleBerthDragEnd}
          />

          {/* Amenities */}
          <AmenityLayer
            amenities={mergedAmenities}
            selectedAmenityId={selectedAmenityId}
            onAmenityClick={handleAmenityClick}
            draggable={activeTool === 'select'}
            onAmenityDragEnd={handleAmenityDragEnd}
            onAmenityTransformEnd={handleAmenityTransformEnd}
          />

          {/* Draw Pier overlay */}
          {activeTool === 'draw-pier' && (
            <Layer>
              {/* Already-placed vertices polygon */}
              {drawnPolyPoints.length >= 4 && (
                <Line
                  points={drawnPolyPoints}
                  stroke="#2563eb"
                  strokeWidth={2 / stageScale}
                  dash={[6 / stageScale, 3 / stageScale]}
                  listening={false}
                />
              )}
              {/* Cursor preview line */}
              {previewPoints && (
                <Line
                  points={previewPoints}
                  stroke="#2563eb"
                  strokeWidth={1.5 / stageScale}
                  dash={[4 / stageScale, 4 / stageScale]}
                  listening={false}
                />
              )}
              {/* Vertex dots */}
              {drawingPoints.map(([x, y], i) => (
                <Circle
                  key={i}
                  x={x * CELL} y={y * CELL}
                  radius={4 / stageScale}
                  fill="#2563eb"
                  listening={false}
                />
              ))}
            </Layer>
          )}
        </Stage>
      </div>
    </div>
  );
}
