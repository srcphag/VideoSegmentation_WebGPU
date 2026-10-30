import { DetectedElement } from '../types/segmentationTypes';

export const ELEMENT_COLOR_PALETTE: Array<{
  rgb: [number, number, number];
  hex: string;
}> = [
  { rgb: [139, 233, 253], hex: '#8be9fd' }, // Cyan
  { rgb: [80, 250, 123], hex: '#50fa7b' },  // Green
  { rgb: [255, 121, 198], hex: '#ff79c6' }, // Magenta
  { rgb: [255, 184, 108], hex: '#ffb86c' }, // Orange
  { rgb: [189, 147, 249], hex: '#bd93f9' }, // Purple
  { rgb: [241, 250, 140], hex: '#f1fa8c' }, // Yellow
  { rgb: [255, 85, 85], hex: '#ff5555' },   // Red
  { rgb: [100, 220, 200], hex: '#64dcc8' }, // Teal
  { rgb: [255, 150, 150], hex: '#ff9696' }, // Coral
  { rgb: [160, 210, 255], hex: '#a0d2ff' }, // Sky
];

/**
 * Generates a G x G uniform grid of interior sample points across [0..width, 0..height].
 */
export function generateUniformGridPoints(
  width: number,
  height: number,
  gridDensity: number
): Array<[number, number]> {
  const g = Math.max(2, Math.min(16, Math.round(gridDensity)));
  const points: Array<[number, number]> = [];

  for (let r = 0; r < g; r++) {
    const y = Math.round(((r + 0.5) * height) / g);
    for (let c = 0; c < g; c++) {
      const x = Math.round(((c + 0.5) * width) / g);
      points.push([
        Math.max(1, Math.min(width - 2, x)),
        Math.max(1, Math.min(height - 2, y)),
      ]);
    }
  }

  return points;
}

export interface LowResMaskCandidate {
  candidateIndex: number;
  channelIndex: number;
  iouScore: number;
  stabilityScore: number;
  rankScore: number;
  areaFraction: number;
  /** 64x64 binary fingerprint for fast NMS */
  bitmask64: Uint8Array;
  bitmaskArea: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawPredMasksTensor: any;
}

/**
 * Evaluates a single 256x256 low-res mask channel from the SAM decoder,
 * computing its valid area fraction, stability score, and 64x64 NMS fingerprint.
 */
export function evaluateLowResCandidate(
  maskData: Float32Array,
  channelOffset: number,
  lowResW: number,
  lowResH: number,
  validW: number,
  validH: number,
  iouScore: number,
  iouThreshold: number,
  minAreaFraction: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawPredMasksTensor: any,
  candidateIndex: number,
  channelIndex: number
): LowResMaskCandidate | null {
  if (iouScore < iouThreshold) return null;

  const vW = Math.max(1, Math.min(lowResW, validW));
  const vH = Math.max(1, Math.min(lowResH, validH));
  const totalValidPixels = vW * vH;

  let posCount = 0;
  let highCount = 0;
  let lowCount = 0;

  for (let y = 0; y < vH; y++) {
    const rowStart = channelOffset + y * lowResW;
    for (let x = 0; x < vW; x++) {
      const val = maskData[rowStart + x];
      if (val > -1.0) {
        lowCount++;
        if (val > 0.0) {
          posCount++;
          if (val > 1.0) {
            highCount++;
          }
        }
      }
    }
  }

  const areaFraction = posCount / totalValidPixels;
  // Filter out tiny fragments and large whole-frame background masks (>75% of frame)
  if (areaFraction < minAreaFraction || areaFraction > 0.75) {
    return null;
  }

  // Check how many of the 4 frame corners are inside the mask
  const cTopLeft = maskData[channelOffset] > 0.0 ? 1 : 0;
  const cTopRight = maskData[channelOffset + (vW - 1)] > 0.0 ? 1 : 0;
  const cBotLeft = maskData[channelOffset + (vH - 1) * lowResW] > 0.0 ? 1 : 0;
  const cBotRight =
    maskData[channelOffset + (vH - 1) * lowResW + (vW - 1)] > 0.0 ? 1 : 0;
  const cornerCount = cTopLeft + cTopRight + cBotLeft + cBotRight;

  // Reject background masks that wrap around >= 3 corners of the frame and exceed 40% area
  if (cornerCount >= 3 && areaFraction > 0.4) {
    return null;
  }

  const stabilityScore = lowCount > 0 ? highCount / lowCount : 0;
  if (stabilityScore < 0.6) {
    return null;
  }

  // Build 64x64 binary fingerprint over the valid region
  const bitmask64 = new Uint8Array(64 * 64);
  let bitmaskArea = 0;
  for (let gy = 0; gy < 64; gy++) {
    const sy = Math.min(vH - 1, Math.floor((gy * vH) / 64));
    const rowStart = channelOffset + sy * lowResW;
    for (let gx = 0; gx < 64; gx++) {
      const sx = Math.min(vW - 1, Math.floor((gx * vW) / 64));
      if (maskData[rowStart + sx] > 0.0) {
        bitmask64[gy * 64 + gx] = 1;
        bitmaskArea++;
      }
    }
  }

  if (bitmaskArea === 0) return null;

  const rankScore = iouScore * (0.5 + 0.5 * stabilityScore);

  return {
    candidateIndex,
    channelIndex,
    iouScore,
    stabilityScore,
    rankScore,
    areaFraction,
    bitmask64,
    bitmaskArea,
    rawPredMasksTensor,
  };
}

/**
 * Deduplicates low-res mask candidates using Non-Maximum Suppression (NMS)
 * and containment suppression.
 */
export function runLowResMaskNms(
  candidates: LowResMaskCandidate[],
  maxElements = 14,
  nmsIouThreshold = 0.55,
  containmentThreshold = 0.82
): LowResMaskCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.rankScore - a.rankScore);
  const kept: LowResMaskCandidate[] = [];

  for (const cand of sorted) {
    if (kept.length >= maxElements) break;

    let suppressed = false;
    for (const existing of kept) {
      let inter = 0;
      const a = cand.bitmask64;
      const b = existing.bitmask64;
      for (let i = 0; i < 4096; i++) {
        if (a[i] & b[i]) inter++;
      }

      const union = cand.bitmaskArea + existing.bitmaskArea - inter;
      const iou = union > 0 ? inter / union : 0;
      const minArea = Math.min(cand.bitmaskArea, existing.bitmaskArea);
      const containment = minArea > 0 ? inter / minArea : 0;

      if (iou > nmsIouThreshold || containment > containmentThreshold) {
        suppressed = true;
        break;
      }
    }

    if (!suppressed) {
      kept.push(cand);
    }
  }

  // Sort final elements by area ascending or top-to-bottom/left-to-right for stable numbering
  return kept;
}

/**
 * Merges the quantizedLogits of all currently `selected` elements into a single
 * composite quantizedLogits buffer of length (width * height).
 */
export function mergeSelectedElementLogits(
  elements: DetectedElement[],
  width: number,
  height: number
): Uint8Array {
  const size = width * height;
  const merged = new Uint8Array(size);
  merged.fill(40); // background (-5.5 logit)

  const selected = elements.filter((el) => el.selected);
  for (const el of selected) {
    const src = el.quantizedLogits;
    const len = Math.min(size, src.length);
    for (let i = 0; i < len; i++) {
      if (src[i] > merged[i]) {
        merged[i] = src[i];
      }
    }
  }

  return merged;
}

/**
 * Hit-tests `(x, y)` in video pixel coordinates against `elements`.
 * Returns the ID of the smallest-area element containing `(x, y)`, or null.
 */
export function hitTestDetectedElements(
  elements: DetectedElement[],
  width: number,
  height: number,
  x: number,
  y: number
): string | null {
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const pixelIdx = iy * width + ix;

  let bestId: string | null = null;
  let smallestArea = Infinity;

  for (const el of elements) {
    if (el.quantizedLogits[pixelIdx] > 128) {
      if (el.areaFraction < smallestArea) {
        smallestArea = el.areaFraction;
        bestId = el.id;
      }
    }
  }

  return bestId;
}
