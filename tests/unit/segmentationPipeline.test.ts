import { describe, expect, it } from 'vitest';
import { ProResProfile } from 'prores-wasm-encoder';
import {
  buildBwMatteRgba,
  buildStraightAlphaRgba,
} from '../../src/rendering/frameCompositor';
import {
  postProcessMask,
  quantizeLogits,
} from '../../src/rendering/maskPostProcessor';
import { exportProResMovs } from '../../src/rendering/proresExporter';
import {
  computeMaskInteriorPeakAndBox,
  padBoundingBox,
} from '../../src/tracking/distanceTransform';
import {
  evaluateLowResCandidate,
  generateUniformGridPoints,
  hitTestDetectedElements,
  mergeSelectedElementLogits,
  runLowResMaskNms,
} from '../../src/tracking/gridNms';

describe('distanceTransform & interior peak finder', () => {
  it('locates an interior foreground point inside a concave U-shaped mask', () => {
    const width = 40;
    const height = 40;
    const mask = new Uint8Array(width * height);
    mask.fill(40); // background

    // Draw a U-shape where the geometric bounding-box center (20, 20) is empty background
    for (let y = 8; y <= 32; y++) {
      for (let x = 8; x <= 32; x++) {
        const inLeftWall = x >= 8 && x <= 14;
        const inRightWall = x >= 26 && x <= 32;
        const inBottomWall = y >= 26 && y <= 32;
        if (inLeftWall || inRightWall || inBottomWall) {
          mask[y * width + x] = 220;
        }
      }
    }

    const res = computeMaskInteriorPeakAndBox(mask, width, height, 128);
    expect(res.bbox).toEqual([8, 8, 32, 32]);
    expect(res.area).toBeGreaterThan(100);
    // The chosen interior peak MUST lie inside the foreground mask
    expect(mask[res.y * width + res.x]).toBeGreaterThan(128);

    const padded = padBoundingBox(res.bbox!, width, height, 0.1);
    expect(padded[0]).toBeLessThan(8);
    expect(padded[1]).toBeLessThan(8);
    expect(padded[2]).toBeGreaterThan(32);
    expect(padded[3]).toBeGreaterThan(32);
  });
});

describe('maskPostProcessor', () => {
  it('quantizes logits and applies threshold, choke/expand, and feather', () => {
    const width = 20;
    const height = 20;
    const logits = new Float32Array(width * height);
    logits.fill(-4.0);

    for (let y = 6; y <= 14; y++) {
      for (let x = 6; x <= 14; x++) {
        logits[y * width + x] = 4.0;
      }
    }

    const quantized = quantizeLogits(logits);
    expect(quantized[10 * width + 10]).toBeGreaterThan(180);
    expect(quantized[0]).toBeLessThan(80);

    const baseAlpha = postProcessMask(quantized, width, height, {
      threshold: 0,
      chokeExpand: 0,
      edgeFeather: 0,
    });
    const erodedAlpha = postProcessMask(quantized, width, height, {
      threshold: 0,
      chokeExpand: -2,
      edgeFeather: 0,
    });
    const dilatedAlpha = postProcessMask(quantized, width, height, {
      threshold: 0,
      chokeExpand: 2,
      edgeFeather: 0,
    });

    const sum = (arr: Uint8Array) => arr.reduce((a, b) => a + b, 0);
    expect(sum(erodedAlpha)).toBeLessThan(sum(baseAlpha));
    expect(sum(dilatedAlpha)).toBeGreaterThan(sum(baseAlpha));

    const feathered = postProcessMask(quantized, width, height, {
      threshold: 0,
      chokeExpand: 0,
      edgeFeather: 2,
    });
    // Edge pixel should become semi-transparent (0 < alpha < 255)
    const edgeVal = feathered[6 * width + 10];
    expect(edgeVal).toBeGreaterThan(0);
    expect(edgeVal).toBeLessThan(255);
  });
});

describe('frameCompositor ProRes buffers', () => {
  it('builds straight (non-premultiplied) RGBA and Black & White Luma Matte buffers', () => {
    const sourceRgba = new Uint8ClampedArray([
      200, 100, 50, 255, // Pixel 0: semi-transparent foreground
      120, 80, 40, 255,  // Pixel 1: fully transparent background
    ]);
    const alphaMask = new Uint8Array([128, 0]);

    const straight = buildStraightAlphaRgba(sourceRgba, alphaMask);
    // Straight RGBA preserves exact R,G,B (200, 100, 50) when alpha is 128
    expect(Array.from(straight.slice(0, 4))).toEqual([200, 100, 50, 128]);
    // Background pixel with alpha 0 is zeroed
    expect(Array.from(straight.slice(4, 8))).toEqual([0, 0, 0, 0]);

    const matte = buildBwMatteRgba(alphaMask);
    expect(Array.from(matte.slice(0, 4))).toEqual([128, 128, 128, 255]);
    expect(Array.from(matte.slice(4, 8))).toEqual([0, 0, 0, 255]);
  });

  it('encodes valid QuickTime .mov files for both ProRes 4444 Alpha and B&W Luma Matte', async () => {
    const width = 64;
    const height = 64;
    const sourceRgba = new Uint8ClampedArray(width * height * 4);
    const quantizedLogits = new Uint8Array(width * height);

    for (let i = 0; i < width * height; i++) {
      sourceRgba[i * 4] = 220;
      sourceRgba[i * 4 + 1] = 100;
      sourceRgba[i * 4 + 2] = 50;
      sourceRgba[i * 4 + 3] = 255;
      quantizedLogits[i] = i % 2 === 0 ? 200 : 60;
    }

    const outputs = await exportProResMovs({
      filenameBase: 'testClip.mp4',
      width,
      height,
      fps: 24,
      inFrame: 0,
      outFrame: 2,
      renderOutputMode: 'both',
      alphaProfile: ProResProfile.P4444,
      matteProfile: ProResProfile.HQ,
      refinement: { threshold: 0, chokeExpand: 0, edgeFeather: 1 },
      getFrameAndMask: async () => ({ sourceRgba, quantizedLogits }),
      onProgress: () => {},
      shouldAbort: () => false,
    });

    expect(outputs).toHaveLength(2);
    expect(outputs[0].filename).toBe('testClip_prores4444Alpha.mov');
    expect(outputs[0].blob.size).toBeGreaterThan(256);
    expect(outputs[1].filename).toBe('testClip_bwLumaMatte.mov');
    expect(outputs[1].blob.size).toBeGreaterThan(256);
  });
});

describe('Option A: uniform grid generation, low-res NMS, and element hit-testing', () => {
  it('generates GxG interior points and deduplicates overlapping low-res masks via NMS', () => {
    const pts = generateUniformGridPoints(320, 180, 6);
    expect(pts).toHaveLength(36);
    expect(pts[0][0]).toBeGreaterThan(0);
    expect(pts[0][1]).toBeGreaterThan(0);

    const lowW = 64;
    const lowH = 64;
    const maskA = new Float32Array(lowW * lowH).fill(-4);
    const maskAdup = new Float32Array(lowW * lowH).fill(-4);
    const maskB = new Float32Array(lowW * lowH).fill(-4);

    // Region 1: top-left square (in both maskA and maskAdup)
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) {
        maskA[y * lowW + x] = 3.5;
        maskAdup[y * lowW + x] = 3.2;
      }
    }
    // Region 2: bottom-right square (in maskB)
    for (let y = 36; y < 52; y++) {
      for (let x = 36; x < 52; x++) {
        maskB[y * lowW + x] = 3.8;
      }
    }

    const c1 = evaluateLowResCandidate(
      maskA, 0, lowW, lowH, lowW, lowH, 0.92, 0.7, 0.01, {}, 0, 0
    );
    const c2 = evaluateLowResCandidate(
      maskAdup, 0, lowW, lowH, lowW, lowH, 0.85, 0.7, 0.01, {}, 1, 0
    );
    const c3 = evaluateLowResCandidate(
      maskB, 0, lowW, lowH, lowW, lowH, 0.9, 0.7, 0.01, {}, 2, 0
    );

    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(c3).not.toBeNull();

    const kept = runLowResMaskNms([c1!, c2!, c3!]);
    expect(kept).toHaveLength(2);
  });

  it('merges selected element logits and hit-tests smallest element under cursor', () => {
    const w = 10;
    const h = 10;
    const q1 = new Uint8Array(w * h).fill(40);
    const q2 = new Uint8Array(w * h).fill(40);
    q1[2 * w + 2] = 200;
    q2[2 * w + 2] = 210;
    q2[7 * w + 7] = 210;

    const elements = [
      {
        id: 'el_1',
        label: 'element #1',
        colorRgb: [139, 233, 253] as [number, number, number],
        colorHex: '#8be9fd',
        selected: true,
        iouScore: 0.9,
        areaFraction: 0.05,
        bbox: [2, 2, 2, 2] as [number, number, number, number],
        peakPoint: [2, 2] as [number, number],
        quantizedLogits: q1,
      },
      {
        id: 'el_2',
        label: 'element #2',
        colorRgb: [80, 250, 123] as [number, number, number],
        colorHex: '#50fa7b',
        selected: false,
        iouScore: 0.88,
        areaFraction: 0.2,
        bbox: [2, 2, 7, 7] as [number, number, number, number],
        peakPoint: [7, 7] as [number, number],
        quantizedLogits: q2,
      },
    ];

    // At (2,2), both elements overlap; hitTest returns el_1 (smaller areaFraction)
    expect(hitTestDetectedElements(elements, w, h, 2, 2)).toBe('el_1');
    expect(hitTestDetectedElements(elements, w, h, 7, 7)).toBe('el_2');

    const merged1 = mergeSelectedElementLogits(elements, w, h);
    expect(merged1[2 * w + 2]).toBe(200);
    expect(merged1[7 * w + 7]).toBe(40);

    elements[1].selected = true;
    const mergedBoth = mergeSelectedElementLogits(elements, w, h);
    expect(mergedBoth[7 * w + 7]).toBe(210);
  });
});
