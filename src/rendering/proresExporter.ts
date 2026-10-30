import {
  ProResProfileType,
  createProResEncoder,
  movToBlob,
} from 'prores-wasm-encoder';
import {
  buildBwMatteRgba,
  buildStraightAlphaRgba,
} from './frameCompositor';
import { postProcessMask } from './maskPostProcessor';
import {
  MaskRefinementParams,
  RenderOutputMode,
} from '../types/segmentationTypes';

export interface ProResExportJobOptions {
  filenameBase: string;
  width: number;
  height: number;
  fps: number;
  inFrame: number;
  outFrame: number;
  renderOutputMode: RenderOutputMode;
  alphaProfile: ProResProfileType;
  matteProfile: ProResProfileType;
  refinement: MaskRefinementParams;
  getFrameAndMask: (frameIndex: number) => Promise<{
    sourceRgba: Uint8ClampedArray;
    quantizedLogits: Uint8Array;
  }>;
  onProgress: (info: {
    currentFrame: number;
    totalFrames: number;
    fps: number;
    phaseLabel: string;
  }) => void;
  shouldAbort: () => boolean;
}

export interface EncodedMovOutput {
  filename: string;
  blob: Blob;
  profile: ProResProfileType;
  mode: 'alpha' | 'matte';
}

/**
 * Encodes the selected frame range [inFrame..outFrame] into Apple ProRes .mov
 * file(s) using `prores-wasm-encoder`.
 */
export async function exportProResMovs(
  options: ProResExportJobOptions
): Promise<EncodedMovOutput[]> {
  const {
    filenameBase,
    width,
    height,
    fps,
    inFrame,
    outFrame,
    renderOutputMode,
    alphaProfile,
    matteProfile,
    refinement,
    getFrameAndMask,
    onProgress,
    shouldAbort,
  } = options;

  const passes: Array<{ mode: 'alpha' | 'matte'; profile: ProResProfileType }> =
    [];
  if (renderOutputMode === 'alpha' || renderOutputMode === 'both') {
    passes.push({ mode: 'alpha', profile: alphaProfile });
  }
  if (renderOutputMode === 'matte' || renderOutputMode === 'both') {
    passes.push({ mode: 'matte', profile: matteProfile });
  }

  const totalFramesPerPass = Math.max(1, outFrame - inFrame + 1);
  const totalWorkFrames = totalFramesPerPass * passes.length;
  let completedWorkFrames = 0;

  const outputs: EncodedMovOutput[] = [];
  const startTime = performance.now();

  for (const pass of passes) {
    if (shouldAbort()) break;

    const phaseLabel =
      pass.mode === 'alpha' ? 'prores 4444 alpha' : 'b&w luma matte';
    const blob = await encodeSinglePass({
      width,
      height,
      fps,
      inFrame,
      outFrame,
      mode: pass.mode,
      profile: pass.profile,
      refinement,
      getFrameAndMask,
      shouldAbort,
      onFrameDone: () => {
        completedWorkFrames++;
        const elapsedSec = Math.max(
          0.001,
          (performance.now() - startTime) / 1000
        );
        onProgress({
          currentFrame: completedWorkFrames,
          totalFrames: totalWorkFrames,
          fps: Number((completedWorkFrames / elapsedSec).toFixed(1)),
          phaseLabel,
        });
      },
    });

    if (shouldAbort() || !blob) break;

    const suffix =
      pass.mode === 'alpha' ? 'prores4444Alpha.mov' : 'bwLumaMatte.mov';
    const cleanBase = filenameBase.replace(/\.[^/.]+$/, '') || 'segmentedVideo';
    outputs.push({
      filename: `${cleanBase}_${suffix}`,
      blob,
      profile: pass.profile,
      mode: pass.mode,
    });
  }

  return outputs;
}

async function encodeSinglePass(params: {
  width: number;
  height: number;
  fps: number;
  inFrame: number;
  outFrame: number;
  mode: 'alpha' | 'matte';
  profile: ProResProfileType;
  refinement: MaskRefinementParams;
  getFrameAndMask: ProResExportJobOptions['getFrameAndMask'];
  shouldAbort: () => boolean;
  onFrameDone: () => void;
}): Promise<Blob | null> {
  const {
    width,
    height,
    fps,
    inFrame,
    outFrame,
    mode,
    profile,
    refinement,
    getFrameAndMask,
    shouldAbort,
    onFrameDone,
  } = params;

  const encoder = await createProResEncoder();
  encoder.initialize({
    width,
    height,
    frameRate: fps,
    profile,
  });

  try {
    for (let f = inFrame; f <= outFrame; f++) {
      if (shouldAbort()) {
        encoder.destroy();
        return null;
      }

      const { sourceRgba, quantizedLogits } = await getFrameAndMask(f);
      const alphaMask = postProcessMask(
        quantizedLogits,
        width,
        height,
        refinement
      );

      const outRgba =
        mode === 'alpha'
          ? buildStraightAlphaRgba(sourceRgba, alphaMask)
          : buildBwMatteRgba(alphaMask);

      encoder.addFrameRgba(outRgba);
      onFrameDone();

      // Yield to event loop so progress UI remains responsive
      await new Promise((r) => setTimeout(r, 0));
    }

    const movData = encoder.finalize();
    const blob = movToBlob(movData);
    encoder.destroy();
    return blob;
  } catch (err) {
    encoder.destroy();
    throw err;
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
