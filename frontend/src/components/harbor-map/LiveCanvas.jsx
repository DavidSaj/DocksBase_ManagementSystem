import { useRef, useState, useCallback } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import PierLayer from './PierLayer';
import BerthLayer from './BerthLayer';
import AmenityLayer from './AmenityLayer';

const STAGE_W = 2000;
const STAGE_H = 1500;

export default function LiveCanvas({ piers = [], berths = [], amenities = [], selectedBerthId, onBerthClick, onAmenityClick }) {
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const isPanning = useRef(false);
  const lastPointer = useRef(null);

  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const oldScale = scale;
    const newScale = e.evt.deltaY < 0
      ? Math.min(oldScale * 1.1, 5)
      : Math.max(oldScale / 1.1, 0.2);
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };
    setScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, [scale, stagePos]);

  const handleMouseDown = useCallback((e) => {
    if (e.evt.button === 1 || e.evt.altKey) {
      isPanning.current = true;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      e.evt.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current) return;
    const dx = e.evt.clientX - lastPointer.current.x;
    const dy = e.evt.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
    setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#deeef7' }}>
      <Stage
        width={STAGE_W}
        height={STAGE_H}
        scaleX={scale}
        scaleY={scale}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          <Rect x={0} y={0} width={STAGE_W} height={STAGE_H} fill="#deeef7" listening={false} />
        </Layer>
        <PierLayer piers={piers} />
        <BerthLayer
          berths={berths}
          selectedBerthId={selectedBerthId}
          onBerthClick={onBerthClick}
          draggable={false}
        />
        <AmenityLayer
          amenities={amenities}
          onAmenityClick={onAmenityClick}
          draggable={false}
        />
      </Stage>
      <div style={{
        position: 'absolute', bottom: 8, right: 8,
        background: 'rgba(0,0,0,0.5)', color: 'white',
        fontSize: 11, padding: '2px 8px', borderRadius: 4, pointerEvents: 'none',
      }}>
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
