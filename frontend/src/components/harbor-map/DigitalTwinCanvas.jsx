import { useRef, useState, useCallback } from 'react';

const CELL = 20; // pixels per meter at zoom=1

const STATUS_COL = {
  available:   { fill: '#c2ecce', stroke: '#38a860', text: '#0a4a20' },
  occupied:    { fill: '#c6dcf5', stroke: '#3a7fc8', text: '#0a3a70' },
  reserved:    { fill: '#f6e7b0', stroke: '#c89020', text: '#6a4800' },
  maintenance: { fill: '#f5cccc', stroke: '#c04040', text: '#780000' },
};

export default function DigitalTwinCanvas({
  piers = [],
  berths = [],
  mode = 'view',
  selectedBerthId = null,
  onBerthClick,
  onBerthDrop,
  showGrid = true,
  initialZoom = 1,
  initialPan = { x: 60, y: 60 },
}) {
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState(initialPan);
  const isPanning = useRef(false);
  const panStart = useRef(null);

  const screenToCanvas = useCallback((screenX, screenY) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (screenX - rect.left - pan.x) / (CELL * zoom),
      y: (screenY - rect.top  - pan.y) / (CELL * zoom),
    };
  }, [zoom, pan]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom(z => Math.min(8, Math.max(0.15, z * factor)));
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current || !panStart.current) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  const handleDragOver = (e) => { if (mode === 'edit') e.preventDefault(); };

  const handleDrop = (e) => {
    if (mode !== 'edit') return;
    e.preventDefault();
    const berthId = parseInt(e.dataTransfer.getData('berthId'), 10);
    if (!berthId) return;
    const c = screenToCanvas(e.clientX, e.clientY);
    const x = Math.round(c.x * 2) / 2;
    const y = Math.round(c.y * 2) / 2;
    onBerthDrop?.(berthId, x, y);
  };

  const mappedBerths = berths.filter(b => b.canvas_x != null);
  const sw = 1 / zoom;

  return (
    <svg
      ref={svgRef}
      style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {showGrid && (() => {
        const gSize = CELL * zoom;
        const ox = ((pan.x % gSize) + gSize) % gSize;
        const oy = ((pan.y % gSize) + gSize) % gSize;
        return (
          <defs>
            <pattern id="dtgrid" width={gSize} height={gSize}
              patternUnits="userSpaceOnUse" x={ox} y={oy}>
              <path d={`M ${gSize} 0 L 0 0 0 ${gSize}`}
                fill="none" stroke="#d8dde3" strokeWidth="0.5"/>
            </pattern>
          </defs>
        );
      })()}
      {showGrid && <rect width="100%" height="100%" fill="url(#dtgrid)" />}

      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
        <rect x="-9999" y="-9999" width="19998" height="19998" fill="#deeef7" />

        {piers.map(pier => (
          pier.canvas_x != null && (
            <g key={pier.id}>
              <rect
                x={pier.canvas_x * CELL}
                y={pier.canvas_y * CELL}
                width={pier.canvas_width * CELL}
                height={pier.canvas_height * CELL}
                fill="#7a7a7a"
                stroke="#4a4a4a"
                strokeWidth={sw}
                rx={2}
              />
              <text
                x={(pier.canvas_x + pier.canvas_width / 2) * CELL}
                y={(pier.canvas_y + pier.canvas_height / 2) * CELL}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={11 / zoom}
                fontWeight="700"
                style={{ pointerEvents: 'none' }}
              >
                {pier.label || pier.code}
              </text>
            </g>
          )
        ))}

        {mappedBerths.map(berth => {
          const col = STATUS_COL[berth.status] || STATUS_COL.available;
          const bx = berth.canvas_x * CELL;
          const by = berth.canvas_y * CELL;
          const bw = berth.canvas_width * CELL;
          const bh = berth.canvas_height * CELL;
          const cx = bx + bw / 2;
          const cy = by + bh / 2;
          const isSelected = berth.id === selectedBerthId;

          return (
            <g
              key={berth.id}
              transform={berth.canvas_rotation
                ? `rotate(${berth.canvas_rotation},${cx},${cy})`
                : undefined}
              onClick={() => onBerthClick?.(berth)}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <rect
                  x={bx - 3 * sw} y={by - 3 * sw}
                  width={bw + 6 * sw} height={bh + 6 * sw}
                  fill="none" stroke="#2563eb" strokeWidth={3 * sw} rx={3}
                />
              )}
              <rect
                x={bx} y={by} width={bw} height={bh}
                fill={col.fill} stroke={col.stroke} strokeWidth={sw} rx={1}
              />
              <text
                x={cx} y={cy - 5 / zoom}
                textAnchor="middle" dominantBaseline="middle"
                fill={col.text} fontSize={9 / zoom} fontWeight="600"
                style={{ pointerEvents: 'none' }}
              >
                {berth.code}
              </text>
              {berth.vessel_name && (
                <text
                  x={cx} y={cy + 5 / zoom}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={col.text} fontSize={7 / zoom}
                  style={{ pointerEvents: 'none' }}
                >
                  {berth.vessel_name.substring(0, 10)}
                </text>
              )}
            </g>
          );
        })}
      </g>

      <text x="calc(100% - 8px)" y="calc(100% - 8px)"
        textAnchor="end" dominantBaseline="auto"
        fill="#999" fontSize="11" style={{ userSelect: 'none' }}>
        {Math.round(zoom * 100)}%
      </text>
    </svg>
  );
}
