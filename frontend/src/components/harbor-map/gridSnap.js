// All marina coordinates are in metres. Snapping to 1m grid = Math.round.

export function snapToGrid(valueMetres) {
  return Math.round(valueMetres);
}

export function snapPointToGrid(x, y) {
  return [snapToGrid(x), snapToGrid(y)];
}
