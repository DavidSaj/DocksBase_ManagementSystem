/**
 * Returns the nearest point on a line segment [ax,ay]-[bx,by] to point [px,py].
 */
function nearestPointOnSegment(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay) };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const nx = ax + t * dx;
  const ny = ay + t * dy;
  return { x: nx, y: ny, dist: Math.hypot(px - nx, py - ny), angle: Math.atan2(dy, dx) };
}

/**
 * Given polygon_points (metres), a drop position [px, py] (metres),
 * and a snap threshold (metres), returns snap data or null.
 *
 * Returns { x, y, rotation } if within threshold, else null.
 * rotation is in degrees (for canvas_rotation).
 */
export function findNearestEdge(polygonPoints, px, py, thresholdM = 2) {
  if (!polygonPoints || polygonPoints.length < 3) return null;
  let best = null;
  const n = polygonPoints.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = polygonPoints[i];
    const [bx, by] = polygonPoints[(i + 1) % n];
    const result = nearestPointOnSegment(ax, ay, bx, by, px, py);
    if (!best || result.dist < best.dist) best = result;
  }
  if (!best || best.dist > thresholdM) return null;
  return {
    x:        best.x,
    y:        best.y,
    rotation: (best.angle * 180) / Math.PI,
  };
}
