import { DetectedElement, PreviewMode } from '../types/segmentationTypes';

/**
 * Builds a straight (non-premultiplied) RGBA Uint8Array(width * height * 4)
 * for ProRes 4444 / 4444 XQ export with exact alpha transparency.
 */
export function buildStraightAlphaRgba(
  sourceRgba: Uint8ClampedArray | Uint8Array,
  alphaMask: Uint8Array
): Uint8Array {
  const pixelCount = alphaMask.length;
  const out = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const a = alphaMask[i];
    const p = i * 4;
    if (a > 0) {
      out[p] = sourceRgba[p];
      out[p + 1] = sourceRgba[p + 1];
      out[p + 2] = sourceRgba[p + 2];
      out[p + 3] = a;
    } else {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
    }
  }

  return out;
}

/**
 * Builds a Black & White Luma Matte RGBA Uint8Array(width * height * 4)
 * where R = G = B = alpha (255 = white foreground, 0 = black background) and A = 255.
 */
export function buildBwMatteRgba(alphaMask: Uint8Array): Uint8Array {
  const pixelCount = alphaMask.length;
  const out = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const a = alphaMask[i];
    const p = i * 4;
    out[p] = a;
    out[p + 1] = a;
    out[p + 2] = a;
    out[p + 3] = 255;
  }

  return out;
}

/**
 * Renders the current video frame composited with the post-processed alpha mask
 * and interactive detected elements onto the viewport preview canvas.
 */
export function renderCompositePreview(
  canvas: HTMLCanvasElement,
  sourceRgba: Uint8ClampedArray | Uint8Array,
  alphaMask: Uint8Array | null,
  width: number,
  height: number,
  previewMode: PreviewMode,
  elements?: DetectedElement[],
  hoveredElementId?: string | null
): void {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imgData = ctx.createImageData(width, height);
  const dst = imgData.data;
  const pixelCount = width * height;

  if (!alphaMask && (!elements || elements.length === 0)) {
    dst.set(sourceRgba.subarray(0, pixelCount * 4));
    ctx.putImageData(imgData, 0, 0);
    return;
  }

  if (previewMode === 'bwMatte') {
    for (let i = 0; i < pixelCount; i++) {
      const a = alphaMask ? alphaMask[i] : 0;
      const p = i * 4;
      dst[p] = a;
      dst[p + 1] = a;
      dst[p + 2] = a;
      dst[p + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return;
  }

  if (previewMode === 'alphaCutout') {
    const checkerSize = 16;
    for (let y = 0; y < height; y++) {
      const cy = (y >> 4) & 1;
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const i = rowOffset + x;
        const p = i * 4;
        const a = (alphaMask ? alphaMask[i] : 0) / 255;
        const isLight = (((x / checkerSize) | 0) & 1) ^ cy;
        const bg = isLight ? 38 : 18;

        dst[p] = Math.round(sourceRgba[p] * a + bg * (1 - a));
        dst[p + 1] = Math.round(sourceRgba[p + 1] * a + bg * (1 - a));
        dst[p + 2] = Math.round(sourceRgba[p + 2] * a + bg * (1 - a));
        dst[p + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return;
  }

  // 'overlay' mode: render multi-element interactive selection + refined mask contour
  const hasElements = elements && elements.length > 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x;
      const p = i * 4;
      const r = sourceRgba[p];
      const g = sourceRgba[p + 1];
      const b = sourceRgba[p + 2];
      const a = alphaMask ? alphaMask[i] : 0;

      // Check if pixel belongs to a hovered or unselected candidate element
      let matchedEl: DetectedElement | null = null;
      let isHoveredEl = false;
      if (hasElements) {
        let smallestArea = Infinity;
        for (let eIdx = 0; eIdx < elements.length; eIdx++) {
          const el = elements[eIdx];
          if (el.quantizedLogits[i] > 128 && el.areaFraction < smallestArea) {
            smallestArea = el.areaFraction;
            matchedEl = el;
            isHoveredEl = el.id === hoveredElementId;
          }
        }
      }

      // Check contour of active composite mask
      const isInsideSelected = a >= 128;
      let isSelectedContour = false;
      if (
        alphaMask &&
        isInsideSelected &&
        x > 0 &&
        x < width - 1 &&
        y > 0 &&
        y < height - 1
      ) {
        isSelectedContour =
          alphaMask[i - 1] < 128 ||
          alphaMask[i + 1] < 128 ||
          alphaMask[i - width] < 128 ||
          alphaMask[i + width] < 128;
      }

      // Check contour of matched candidate element (for unselected / hovered feedback)
      let isCandidateContour = false;
      if (
        matchedEl &&
        x > 0 &&
        x < width - 1 &&
        y > 0 &&
        y < height - 1
      ) {
        const q = matchedEl.quantizedLogits;
        isCandidateContour =
          q[i - 1] <= 128 ||
          q[i + 1] <= 128 ||
          q[i - width] <= 128 ||
          q[i + width] <= 128;
      }

      const [cr, cg, cb] = matchedEl ? matchedEl.colorRgb : [139, 233, 253];

      if (isHoveredEl && isCandidateContour) {
        dst[p] = 255;
        dst[p + 1] = 255;
        dst[p + 2] = 255;
        dst[p + 3] = 255;
      } else if (isSelectedContour) {
        dst[p] = cr;
        dst[p + 1] = cg;
        dst[p + 2] = cb;
        dst[p + 3] = 255;
      } else if (isCandidateContour && matchedEl && !matchedEl.selected) {
        // Subtle dashed contour for unselected detected elements
        if (((x + y) & 3) < 2) {
          dst[p] = cr;
          dst[p + 1] = cg;
          dst[p + 2] = cb;
        } else {
          dst[p] = Math.round(r * 0.6);
          dst[p + 1] = Math.round(g * 0.6);
          dst[p + 2] = Math.round(b * 0.6);
        }
        dst[p + 3] = 255;
      } else if (a > 0) {
        const alphaNorm = a / 255;
        const tintStrength = (isHoveredEl ? 0.48 : 0.34) * alphaNorm;
        dst[p] = Math.round(r * (1 - tintStrength) + cr * tintStrength);
        dst[p + 1] = Math.round(g * (1 - tintStrength) + cg * tintStrength);
        dst[p + 2] = Math.round(b * (1 - tintStrength) + cb * tintStrength);
        dst[p + 3] = 255;
      } else if (matchedEl && !matchedEl.selected) {
        // Unselected detected element interior: slight color hint (stronger on hover)
        const tint = isHoveredEl ? 0.35 : 0.12;
        dst[p] = Math.round(r * 0.65 * (1 - tint) + cr * tint);
        dst[p + 1] = Math.round(g * 0.65 * (1 - tint) + cg * tint);
        dst[p + 2] = Math.round(b * 0.65 * (1 - tint) + cb * tint);
        dst[p + 3] = 255;
      } else {
        dst[p] = Math.round(r * 0.45);
        dst[p + 1] = Math.round(g * 0.45);
        dst[p + 2] = Math.round(b * 0.45);
        dst[p + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}
