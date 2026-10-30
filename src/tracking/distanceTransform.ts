export interface InteriorPeakResult {
  x: number;
  y: number;
  maxDistance: number;
  area: number;
  bbox: [number, number, number, number] | null;
}

/**
 * Computes a 2-pass Chamfer (3-4) distance transform on a quantized logit map
 * (where values > thresholdByte are foreground) to locate:
 *  1. The tight bounding box [xmin, ymin, xmax, ymax]
 *  2. The pole of inaccessibility (deepest interior foreground pixel [x, y])
 */
export function computeMaskInteriorPeakAndBox(
  quantizedLogits: Uint8Array,
  width: number,
  height: number,
  thresholdByte = 128
): InteriorPeakResult {
  const size = width * height;
  const dist = new Int32Array(size);
  const INF = 1e8;

  let xmin = width;
  let ymin = height;
  let xmax = -1;
  let ymax = -1;
  let area = 0;

  // Pass 1: forward scan (top-left to bottom-right)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (quantizedLogits[idx] <= thresholdByte) {
        dist[idx] = 0;
        continue;
      }

      area++;
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        dist[idx] = 3;
        continue;
      }

      let d = INF;
      const top = dist[idx - width] + 3;
      const left = dist[idx - 1] + 3;
      const topLeft = dist[idx - width - 1] + 4;
      const topRight = dist[idx - width + 1] + 4;

      if (top < d) d = top;
      if (left < d) d = left;
      if (topLeft < d) d = topLeft;
      if (topRight < d) d = topRight;
      dist[idx] = d;
    }
  }

  if (area === 0 || xmax < xmin || ymax < ymin) {
    return {
      x: Math.floor(width / 2),
      y: Math.floor(height / 2),
      maxDistance: 0,
      area: 0,
      bbox: null,
    };
  }

  // Pass 2: backward scan (bottom-right to top-left) & peak tracking
  let bestDist = -1;
  let bestX = Math.floor((xmin + xmax) / 2);
  let bestY = Math.floor((ymin + ymax) / 2);

  for (let y = height - 2; y >= 1; y--) {
    const rowOffset = y * width;
    for (let x = width - 2; x >= 1; x--) {
      const idx = rowOffset + x;
      let d = dist[idx];
      if (d === 0) continue;

      const bottom = dist[idx + width] + 3;
      const right = dist[idx + 1] + 3;
      const bottomRight = dist[idx + width + 1] + 4;
      const bottomLeft = dist[idx + width - 1] + 4;

      if (bottom < d) d = bottom;
      if (right < d) d = right;
      if (bottomRight < d) d = bottomRight;
      if (bottomLeft < d) d = bottomLeft;
      dist[idx] = d;

      if (d > bestDist) {
        bestDist = d;
        bestX = x;
        bestY = y;
      }
    }
  }

  return {
    x: bestX,
    y: bestY,
    maxDistance: Math.max(0, bestDist) / 3,
    area,
    bbox: [xmin, ymin, xmax, ymax],
  };
}

/**
 * Expands a bounding box by `padFraction` of its width/height while clamping to frame bounds.
 */
export function padBoundingBox(
  bbox: [number, number, number, number],
  width: number,
  height: number,
  padFraction = 0.08
): [number, number, number, number] {
  const [xmin, ymin, xmax, ymax] = bbox;
  const bw = Math.max(4, xmax - xmin);
  const bh = Math.max(4, ymax - ymin);
  const padX = Math.max(4, Math.round(bw * padFraction));
  const padY = Math.max(4, Math.round(bh * padFraction));

  return [
    Math.max(0, xmin - padX),
    Math.max(0, ymin - padY),
    Math.min(width - 1, xmax + padX),
    Math.min(height - 1, ymax + padY),
  ];
}
