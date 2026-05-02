import { Layer, Rect, Text, Group, Transformer } from 'react-konva';
import { useRef, useEffect } from 'react';
import { CELL, STATUS_COLORS } from './mapConstants';

// Single berth — separate component so we can attach transformer ref
function BerthShape({ berth, isSelected, onSelect, draggable, onDragEnd }) {
  const groupRef = useRef();
  const trRef = useRef();

  useEffect(() => {
    if (isSelected && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const w = (berth.length_m || 12) * CELL;
  const h = (berth.max_beam_m || 4) * CELL;
  const centerX = berth.canvas_x * CELL;
  const centerY = berth.canvas_y * CELL;

  return (
    <Group>
      <Group
        ref={groupRef}
        x={centerX}
        y={centerY}
        rotation={berth.canvas_rotation || 0}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={e => onDragEnd?.(berth.id, e.target.x() / CELL, e.target.y() / CELL)}
      >
        <Rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          fill={STATUS_COLORS[berth.status] || STATUS_COLORS.available}
          stroke={isSelected ? '#2563eb' : 'rgba(0,0,0,0.3)'}
          strokeWidth={isSelected ? 2 : 1}
          cornerRadius={2}
        />
        <Text
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          text={berth.code}
          fontSize={9}
          fill="white"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled={true}
          resizeEnabled={false}
        />
      )}
    </Group>
  );
}

export default function BerthLayer({ berths = [], selectedBerthId, onBerthClick, draggable = false, onBerthDragEnd }) {
  const mapped = berths.filter(b => b.canvas_x != null && b.canvas_y != null);
  return (
    <Layer>
      {mapped.map(berth => (
        <BerthShape
          key={berth.id}
          berth={berth}
          isSelected={berth.id === selectedBerthId}
          onSelect={() => onBerthClick?.(berth)}
          draggable={draggable}
          onDragEnd={onBerthDragEnd}
        />
      ))}
    </Layer>
  );
}
