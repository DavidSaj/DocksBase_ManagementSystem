import { Layer, Line, Rect, Text, Group } from 'react-konva';
import { CELL, PIER_TYPE_COLORS } from './mapConstants';

function centroid(points) {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  return [cx * CELL, cy * CELL];
}

export default function PierLayer({ piers = [], selectedPierId, onPierClick }) {
  return (
    <Layer>
      {piers.filter(p => p.polygon_points?.length >= 3).map(pier => {
        const pts = pier.polygon_points.flatMap(([x, y]) => [x * CELL, y * CELL]);
        const [cx, cy] = centroid(pier.polygon_points);
        const selected = pier.id === selectedPierId;
        const fillColor = PIER_TYPE_COLORS[pier.pier_type] || PIER_TYPE_COLORS.concrete;

        return (
          <Group key={pier.id}>
            {/* Pier polygon */}
            <Line
              points={pts}
              closed
              fill={fillColor}
              stroke={selected ? '#2563eb' : '#4a4a4a'}
              strokeWidth={selected ? 2 : 1}
              onClick={() => onPierClick?.(pier)}
              onTap={() => onPierClick?.(pier)}
            />

            {/* Ghost slot outlines */}
            {(pier.ghost_slots || []).map((slot, i) => (
              <Rect
                key={i}
                x={(slot.x - slot.width_m / 2) * CELL}
                y={(slot.y - slot.height_m / 2) * CELL}
                width={slot.width_m * CELL}
                height={slot.height_m * CELL}
                rotation={slot.rotation || 0}
                fill="transparent"
                stroke={fillColor}
                strokeWidth={1.5}
                dash={[5, 4]}
                listening={false}
              />
            ))}

            {/* Pier label */}
            <Text
              x={cx - 20} y={cy - 7}
              width={40} align="center"
              text={pier.code}
              fontSize={11} fill="#ffffff" fontStyle="bold"
              listening={false}
            />
          </Group>
        );
      })}
    </Layer>
  );
}
