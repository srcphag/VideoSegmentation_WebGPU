import { MaskRefinementParams } from '../types/segmentationTypes';

/**
 * Quantizes float32 mask logits into a compact Uint8Array(width * height).
 * Mapping: byte = clamp(round(128 + logit * 16), 0, 255).
 * 128 represents logit 0.0; range is [-8.0, +7.9375].
 */
export function quantizeLogits(logits: Float32Array): Uint8Array {
  const out = new Uint8Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const v = Math.round(128 + logits[i] * 16);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/**
 * Applies real-time threshold, morphological choke/expand (erode/dilate),
 * and separable Gaussian/box feathering to produce an 8-bit alpha mask (0..255).
 */
export function postProcessMask(
  quantizedLogits: Uint8Array,
  width: number,
  height: number,
  params: MaskRefinementParams
): Uint8Array {
  const size = width * height;
  let current = new Uint8Array(size);

  // 1. Thresholding with smooth anti-aliased ramp around the threshold logit
  const threshCenter = 128 + params.threshold * 16;
  const rampHalfWidth = 6; // ~0.375 logit units for smooth anti-aliased edge
  const lowEdge = threshCenter - rampHalfWidth;
  const invSpan = 255 / (rampHalfWidth * 2);

  for (let i = 0; i < size; i++) {
    const val = quantizedLogits[i];
    if (val <= lowEdge) {
      current[i] = 0;
    } else if (val >= threshCenter + rampHalfWidth) {
      current[i] = 255;
    } else {
      current[i] = Math.round((val - lowEdge) * invSpan);
    }
  }

  // 2. Morphological Choke (< 0: Erode / Min) or Expand (> 0: Dilate / Max)
  const morphRadius = Math.round(params.chokeExpand);
  if (morphRadius !== 0) {
    const r = Math.min(10, Math.abs(morphRadius));
    const isDilate = morphRadius > 0;
    const temp = new Uint8Array(size);

    // Horizontal pass
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const x0 = x - r < 0 ? 0 : x - r;
        const x1 = x + r >= width ? width - 1 : x + r;
        let acc = isDilate ? 0 : 255;
        for (let k = x0; k <= x1; k++) {
          const v = current[rowOffset + k];
          if (isDilate) {
            if (v > acc) acc = v;
          } else {
            if (v < acc) acc = v;
          }
        }
        temp[rowOffset + x] = acc;
      }
    }

    // Vertical pass
    for (let y = 0; y < height; y++) {
      const y0 = y - r < 0 ? 0 : y - r;
      const y1 = y + r >= height ? height - 1 : y + r;
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        let acc = isDilate ? 0 : 255;
        for (let k = y0; k <= y1; k++) {
          const v = temp[k * width + x];
          if (isDilate) {
            if (v > acc) acc = v;
          } else {
            if (v < acc) acc = v;
          }
        }
        current[rowOffset + x] = acc;
      }
    }
  }

  // 3. Separable Edge Feathering (2-pass running-sum box blur approximating Gaussian)
  const featherRadius = Math.max(0, Math.min(20, Math.round(params.edgeFeather)));
  if (featherRadius > 0) {
    const temp = new Uint8Array(size);
    for (let pass = 0; pass < 2; pass++) {
      blurHorizontal(current, temp, width, height, featherRadius);
      blurVertical(temp, current, width, height, featherRadius);
    }
  }

  return current;
}

function blurHorizontal(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  radius: number
): void {
  const windowSize = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sum = src[rowOffset] * (radius + 1);
    for (let x = 1; x <= radius; x++) {
      sum += src[rowOffset + (x < width ? x : width - 1)];
    }
    for (let x = 0; x < width; x++) {
      dst[rowOffset + x] = Math.round(sum / windowSize);
      const leftIdx = x - radius < 0 ? 0 : x - radius;
      const rightIdx = x + radius + 1 >= width ? width - 1 : x + radius + 1;
      sum += src[rowOffset + rightIdx] - src[rowOffset + leftIdx];
    }
  }
}

function blurVertical(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  height: number,
  radius: number
): void {
  const windowSize = radius * 2 + 1;
  for (let x = 0; x < width; x++) {
    let sum = src[x] * (radius + 1);
    for (let y = 1; y <= radius; y++) {
      sum += src[(y < height ? y : height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = Math.round(sum / windowSize);
      const topIdx = y - radius < 0 ? 0 : y - radius;
      const bottomIdx = y + radius + 1 >= height ? height - 1 : y + radius + 1;
      sum += src[bottomIdx * width + x] - src[topIdx * width + x];
    }
  }
}
