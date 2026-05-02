import { Layer, Line, Text } from 'react-konva';
import { CELL } from './mapConstants';

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
        return (
          <div key={pier.id}>
            <Line
              points={pts}
              closed
              fill="#7a7a7a"
              stroke={selected ? '#2563eb' : '#4a4a4a'}
              strokeWidth={selected ? 2 : 1}
              onClick={() => onPierClick?.(pier)}
              onTap={() => onPierClick?.(pier)}
            />
            <Text
              x={cx - 20} y={cy - 7}
              width={40} align="center"
              text={pier.code}
              fontSize={11} fill="#ffffff" fontStyle="bold"
              listening={false}
            />
          </div>
        );
      })}
    </Layer>
  );
}
