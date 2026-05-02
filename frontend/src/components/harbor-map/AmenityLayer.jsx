import { Layer, Group, Rect, Image, Text, Transformer } from 'react-konva';
import { useRef, useEffect, useState } from 'react';
import { CELL } from './mapConstants';
import { AMENITY_ICONS } from './amenityIcons';

const ICON_SIZE = 32;
const BG_PADDING = 6;
const BG_SIZE = ICON_SIZE + BG_PADDING * 2;
const ICON_COLORS = {
  harbour_master: '#1d4ed8',
  fuel:           '#d97706',
  toilets:        '#0891b2',
  showers:        '#0891b2',
  restaurant:     '#dc2626',
  parking:        '#374151',
  electricity:    '#ca8a04',
  water:          '#2563eb',
  gate:           '#6b7280',
  waste:          '#65a30d',
  chandlery:      '#7c3aed',
  first_aid:      '#dc2626',
};

function AmenityShape({ amenity, isSelected, onSelect, draggable, onTransformEnd, onDragEnd }) {
  const groupRef = useRef();
  const trRef = useRef();
  const [img, setImg] = useState(null);

  useEffect(() => {
    const image = new window.Image();
    image.src = AMENITY_ICONS[amenity.type] || AMENITY_ICONS.harbour_master;
    image.onload = () => setImg(image);
  }, [amenity.type]);

  useEffect(() => {
    if (isSelected && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const scale = amenity.scale || 1;

  return (
    <Group>
      <Group
        ref={groupRef}
        x={amenity.canvas_x * CELL}
        y={amenity.canvas_y * CELL}
        rotation={amenity.rotation || 0}
        scaleX={scale}
        scaleY={scale}
        offsetX={BG_SIZE / 2}
        offsetY={BG_SIZE / 2}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={e => onDragEnd?.(amenity.id, e.target.x() / CELL, e.target.y() / CELL)}
        onTransformEnd={e => {
          const node = groupRef.current;
          onTransformEnd?.(amenity.id, {
            canvas_x: node.x() / CELL,
            canvas_y: node.y() / CELL,
            rotation: node.rotation(),
            scale: amenity.scale * node.scaleX(),
          });
          node.scaleX(1);
          node.scaleY(1);
        }}
      >
        <Rect
          x={0} y={0}
          width={BG_SIZE} height={BG_SIZE}
          fill={ICON_COLORS[amenity.type] || '#374151'}
          cornerRadius={6}
        />
        {img && (
          <Image
            x={BG_PADDING} y={BG_PADDING}
            width={ICON_SIZE} height={ICON_SIZE}
            image={img}
            listening={false}
          />
        )}
      </Group>
      {amenity.label ? (
        <Text
          x={(amenity.canvas_x * CELL) - 30}
          y={(amenity.canvas_y * CELL) + BG_SIZE / 2 * scale + 2}
          width={60}
          align="center"
          text={amenity.label}
          fontSize={9}
          fill="#374151"
          listening={false}
        />
      ) : null}
      {isSelected && (
        <Transformer
          ref={trRef}
          keepRatio={true}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          rotateEnabled={true}
        />
      )}
    </Group>
  );
}

export default function AmenityLayer({ amenities = [], selectedAmenityId, onAmenityClick, draggable = false, onAmenityTransformEnd, onAmenityDragEnd }) {
  const placed = amenities.filter(a => a.canvas_x != null && a.canvas_y != null);
  return (
    <Layer>
      {placed.map(amenity => (
        <AmenityShape
          key={amenity.id}
          amenity={amenity}
          isSelected={amenity.id === selectedAmenityId}
          onSelect={() => onAmenityClick?.(amenity)}
          draggable={draggable}
          onTransformEnd={onAmenityTransformEnd}
          onDragEnd={onAmenityDragEnd}
        />
      ))}
    </Layer>
  );
}
