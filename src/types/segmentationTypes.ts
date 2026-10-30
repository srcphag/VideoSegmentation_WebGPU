import { ProResProfileType } from 'prores-wasm-encoder';

export type SamModelId =
  | 'onnx-community/EdgeTAM-ONNX'
  | 'onnx-community/sam2.1-hiera-tiny-ONNX'
  | 'Xenova/slimsam-77-uniform'
  | 'onnx-community/sam2.1-hiera-small-ONNX'
  | 'onnx-community/sam2.1-hiera-base-plus-ONNX';

export type RuntimeBackend = 'webgpu' | 'wasm' | 'loading';

export type PreviewMode = 'overlay' | 'alphaCutout' | 'bwMatte';

export type RenderOutputMode = 'alpha' | 'matte' | 'both';

export interface BoundingBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  score?: number;
  label?: string;
}

export interface DetectedElement {
  id: string;
  label: string;
  colorRgb: [number, number, number];
  colorHex: string;
  selected: boolean;
  iouScore: number;
  areaFraction: number;
  bbox: [number, number, number, number];
  peakPoint: [number, number];
  /**
   * Quantized logit map of length (width * height) for this specific element.
   * 128 = 0.0 logit, scale = 16 units per logit.
   */
  quantizedLogits: Uint8Array;
}

export interface AutoDetectParams {
  gridDensity: number;     // 4..10 points per side (default 6 -> 36 points)
  iouThreshold: number;    // 0.50..0.95 (default 0.72)
  minAreaPercent: number;  // 0.5..10.0 % of frame area (default 1.0)
}

export interface VideoMetadata {
  filename: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  totalFrames: number;
  thumbnailUrl: string;
}

export interface MaskRefinementParams {
  threshold: number;    // -2.0 .. +2.0 (default 0.0)
  chokeExpand: number;  // -10 .. +10 px (default 0)
  edgeFeather: number;  // 0 .. 20 px (default 1)
}

export interface FrameMaskEntry {
  frameIndex: number;
  /**
   * Composite quantized logit map of all currently `selected` elements on this frame.
   * 128 = 0.0 logit, scale = 16 units per logit.
   */
  quantizedLogits: Uint8Array;
  elements: DetectedElement[];
  iouScore: number;
  isKeyframe: boolean;
  lowConfidence: boolean;
  boxes: BoundingBox[];
}

export interface TrackingStatus {
  isTracking: boolean;
  currentFrame: number;
  targetEndFrame: number;
  msPerFrame: number;
  lowConfidenceWarning: boolean;
  statusText: string;
}

export interface ExportStatus {
  isExporting: boolean;
  currentFrame: number;
  totalFrames: number;
  fps: number;
  phaseLabel: string;
}

export interface AppState {
  video: VideoMetadata | null;
  currentFrame: number;
  inFrame: number;
  outFrame: number;
  isPlaying: boolean;
  showStats: boolean;

  modelId: SamModelId;
  runtimeBackend: RuntimeBackend;
  modelReady: boolean;
  modelLoadingProgress: number;
  modelStatusText: string;

  autoDetect: AutoDetectParams;
  isDetectingFrame: boolean;
  hoveredElementId: string | null;

  previewMode: PreviewMode;
  refinement: MaskRefinementParams;

  renderOutputMode: RenderOutputMode;
  alphaProfile: ProResProfileType;
  matteProfile: ProResProfileType;

  tracking: TrackingStatus;
  exportStatus: ExportStatus;
  errors: string[];
}

export const DEFAULT_AUTO_DETECT: AutoDetectParams = {
  gridDensity: 6,
  iouThreshold: 0.72,
  minAreaPercent: 1.0,
};

export const DEFAULT_REFINEMENT: MaskRefinementParams = {
  threshold: 0.0,
  chokeExpand: 0,
  edgeFeather: 1,
};

/* Worker Protocol */
export interface SerializedDetectedElement {
  id: string;
  label: string;
  colorRgb: [number, number, number];
  colorHex: string;
  selected: boolean;
  iouScore: number;
  areaFraction: number;
  bbox: [number, number, number, number];
  peakPoint: [number, number];
  quantizedLogitsBuffer: ArrayBuffer;
}

export interface PropagateElementPrompt {
  id: string;
  label: string;
  colorRgb: [number, number, number];
  colorHex: string;
  box: [number, number, number, number];
  point: [number, number];
}

export type WorkerRequest =
  | {
      type: 'initModel';
      requestId: number;
      modelId: SamModelId;
    }
  | {
      type: 'detectElementsOnFrame';
      requestId: number;
      frameIndex: number;
      width: number;
      height: number;
      rgbaBuffer: ArrayBuffer;
      autoDetect: AutoDetectParams;
    }
  | {
      type: 'propagateElements';
      requestId: number;
      frameIndex: number;
      width: number;
      height: number;
      rgbaBuffer: ArrayBuffer;
      targets: PropagateElementPrompt[];
    };

export type WorkerResponse =
  | {
      type: 'modelProgress';
      progress: number;
      statusText: string;
      backend?: RuntimeBackend;
    }
  | {
      type: 'modelReady';
      requestId: number;
      modelId: SamModelId;
      backend: RuntimeBackend;
    }
  | {
      type: 'elementsDetectedResult';
      requestId: number;
      frameIndex: number;
      elements: SerializedDetectedElement[];
      elapsedMs: number;
    }
  | {
      type: 'workerError';
      requestId?: number;
      message: string;
    };
