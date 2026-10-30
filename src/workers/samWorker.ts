import {
  AutoProcessor,
  EdgeTamModel,
  RawImage,
  Sam2Model,
  SamModel,
  Tensor,
  env,
} from '@huggingface/transformers';
import { quantizeLogits } from '../rendering/maskPostProcessor';
import { computeMaskInteriorPeakAndBox } from '../tracking/distanceTransform';
import {
  ELEMENT_COLOR_PALETTE,
  LowResMaskCandidate,
  evaluateLowResCandidate,
  generateUniformGridPoints,
  runLowResMaskNms,
} from '../tracking/gridNms';
import {
  AutoDetectParams,
  PropagateElementPrompt,
  RuntimeBackend,
  SamModelId,
  SerializedDetectedElement,
  WorkerRequest,
  WorkerResponse,
} from '../types/segmentationTypes';

env.allowLocalModels = false;

let activeSamModelId: SamModelId | null = null;
let runtimeBackend: RuntimeBackend = 'wasm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let samProcessor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let samModel: any = null;

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

async function detectBackend(): Promise<'webgpu' | 'wasm'> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = self.navigator as any;
    if (nav && nav.gpu) {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) {
        return 'webgpu';
      }
    }
  } catch {
    // Fallback to wasm
  }
  return 'wasm';
}

function getModelClass(modelId: SamModelId) {
  if (modelId === 'Xenova/slimsam-77-uniform') {
    return SamModel;
  }
  if (modelId.includes('EdgeTAM')) {
    return EdgeTamModel;
  }
  return Sam2Model;
}

async function ensureModelsLoaded(
  modelId: SamModelId,
  requestId: number
): Promise<void> {
  runtimeBackend = await detectBackend();

  if (activeSamModelId === modelId && samModel && samProcessor) {
    post({
      type: 'modelReady',
      requestId,
      modelId,
      backend: runtimeBackend,
    });
    return;
  }

  const progressMap = new Map<string, number>();
  const onProgress = (info: {
    status?: string;
    file?: string;
    progress?: number;
  }) => {
    if (info.file && typeof info.progress === 'number') {
      progressMap.set(info.file, info.progress);
      let sum = 0;
      progressMap.forEach((v) => {
        sum += v;
      });
      const avg = Math.round(sum / Math.max(1, progressMap.size));
      post({
        type: 'modelProgress',
        progress: avg,
        statusText: `downloading ${info.file.split('/').pop()} (${avg}%)`,
        backend: runtimeBackend,
      });
    } else if (info.status === 'initiate' && info.file) {
      post({
        type: 'modelProgress',
        progress: 10,
        statusText: `loading ${info.file.split('/').pop()}`,
        backend: runtimeBackend,
      });
    }
  };

  const shortName =
    modelId === 'Xenova/slimsam-77-uniform'
      ? 'SlimSAM 77'
      : modelId.includes('EdgeTAM')
        ? 'EdgeTAM'
        : modelId.includes('base-plus')
          ? 'SAM 2.1 Base+ (High Precision)'
          : modelId.includes('hiera-small')
            ? 'SAM 2.1 Small'
            : 'SAM 2.1 Tiny';

  post({
    type: 'modelProgress',
    progress: 15,
    statusText: `loading ${shortName} (${runtimeBackend})...`,
    backend: runtimeBackend,
  });

  samProcessor = await AutoProcessor.from_pretrained(modelId, {
    progress_callback: onProgress,
  });

  const ModelClass = getModelClass(modelId);
  try {
    samModel = await ModelClass.from_pretrained(modelId, {
      dtype: {
        vision_encoder: runtimeBackend === 'webgpu' ? 'fp16' : 'q8',
        prompt_encoder_mask_decoder: 'fp32',
      },
      device: runtimeBackend,
      progress_callback: onProgress,
    });
  } catch {
    runtimeBackend = 'wasm';
    samModel = await ModelClass.from_pretrained(modelId, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: onProgress,
    });
  }

  activeSamModelId = modelId;

  post({
    type: 'modelProgress',
    progress: 100,
    statusText: 'ready',
    backend: runtimeBackend,
  });

  post({
    type: 'modelReady',
    requestId,
    modelId,
    backend: runtimeBackend,
  });
}

async function detectElementsOnFrame(
  rawImage: RawImage,
  autoDetect: AutoDetectParams
): Promise<{
  elements: SerializedDetectedElement[];
  transfers: ArrayBuffer[];
}> {
  const width = rawImage.width;
  const height = rawImage.height;
  const pixelCount = width * height;

  post({
    type: 'modelProgress',
    progress: 10,
    statusText: 'encoding frame embeddings...',
    backend: runtimeBackend,
  });

  const processedFrame = await samProcessor(rawImage);
  const embeddings = await samModel.get_image_embeddings({
    pixel_values: processedFrame.pixel_values,
  });

  const gridPoints = generateUniformGridPoints(
    width,
    height,
    autoDetect.gridDensity
  );
  const minAreaFraction = Math.max(0.002, autoDetect.minAreaPercent / 100);

  const [reshapedH, reshapedW] = processedFrame.reshaped_input_sizes[0];
  const padSize = samProcessor.image_processor.pad_size ??
    samProcessor.image_processor.size ?? { height: 1024, width: 1024 };
  const validLowResW = Math.round((reshapedW / padSize.width) * 256);
  const validLowResH = Math.round((reshapedH / padSize.height) * 256);

  const candidates: LowResMaskCandidate[] = [];

  for (let idx = 0; idx < gridPoints.length; idx++) {
    const [px, py] = gridPoints[idx];

    if (idx % 6 === 0) {
      const pct = Math.round(15 + (idx / gridPoints.length) * 70);
      post({
        type: 'modelProgress',
        progress: pct,
        statusText: `scanning grid ${idx + 1}/${gridPoints.length}...`,
        backend: runtimeBackend,
      });
    }

    const inputPoints = samProcessor.reshape_input_points(
      [[[[px, py]]]],
      processedFrame.original_sizes,
      processedFrame.reshaped_input_sizes,
      false
    );
    const inputLabels = samProcessor.image_processor.add_input_labels(
      [[[1]]],
      inputPoints
    );

    const outputs = await samModel({
      ...embeddings,
      input_points: inputPoints,
      input_labels: inputLabels,
    });

    const iouData = outputs.iou_scores.data as Float32Array;
    const maskData = outputs.pred_masks.data as Float32Array;
    const dims = outputs.pred_masks.dims;
    const numChannels = dims[2] ?? 3;
    const lowResH = dims[3] ?? 256;
    const lowResW = dims[4] ?? 256;
    const channelStride = lowResH * lowResW;

    let bestForPoint: LowResMaskCandidate | null = null;

    for (let c = 0; c < numChannels; c++) {
      const iou = Number(iouData[c] ?? 0);
      const cand = evaluateLowResCandidate(
        maskData,
        c * channelStride,
        lowResW,
        lowResH,
        validLowResW,
        validLowResH,
        iou,
        autoDetect.iouThreshold,
        minAreaFraction,
        outputs.pred_masks,
        idx,
        c
      );
      if (
        cand &&
        (!bestForPoint || cand.rankScore > bestForPoint.rankScore)
      ) {
        bestForPoint = cand;
      }
    }

    if (bestForPoint) {
      candidates.push(bestForPoint);
    }
  }

  post({
    type: 'modelProgress',
    progress: 90,
    statusText: 'filtering & upscaling masks...',
    backend: runtimeBackend,
  });

  const keptCandidates = runLowResMaskNms(candidates, 14, 0.52, 0.8);
  const elements: SerializedDetectedElement[] = [];
  const transfers: ArrayBuffer[] = [];

  for (let i = 0; i < keptCandidates.length; i++) {
    const cand = keptCandidates[i];
    const masks = await samProcessor.post_process_masks(
      cand.rawPredMasksTensor,
      processedFrame.original_sizes,
      processedFrame.reshaped_input_sizes,
      { binarize: false }
    );

    const fullMaskTensor = masks[0];
    const fullData = fullMaskTensor.data as Float32Array;
    const chOffset = cand.channelIndex * pixelCount;
    const channelSlice = fullData.subarray(chOffset, chOffset + pixelCount);

    const quantized = quantizeLogits(channelSlice);
    const peakInfo = computeMaskInteriorPeakAndBox(
      quantized,
      width,
      height,
      128
    );

    if (!peakInfo.bbox || peakInfo.area < 16) {
      continue;
    }

    const paletteEntry =
      ELEMENT_COLOR_PALETTE[elements.length % ELEMENT_COLOR_PALETTE.length];
    const elIndex = elements.length + 1;
    const buf = quantized.buffer as ArrayBuffer;

    elements.push({
      id: `el_${elIndex}`,
      label: `element #${elIndex}`,
      colorRgb: paletteEntry.rgb,
      colorHex: paletteEntry.hex,
      selected: elements.length === 0, // Select top-ranked element by default
      iouScore: cand.iouScore,
      areaFraction: peakInfo.area / pixelCount,
      bbox: peakInfo.bbox,
      peakPoint: [peakInfo.x, peakInfo.y],
      quantizedLogitsBuffer: buf,
    });
    transfers.push(buf);
  }

  post({
    type: 'modelProgress',
    progress: 100,
    statusText: 'ready',
    backend: runtimeBackend,
  });

  return { elements, transfers };
}

async function propagateSelectedElements(
  rawImage: RawImage,
  targets: PropagateElementPrompt[]
): Promise<{
  elements: SerializedDetectedElement[];
  transfers: ArrayBuffer[];
}> {
  const width = rawImage.width;
  const height = rawImage.height;
  const pixelCount = width * height;

  if (targets.length === 0) {
    return { elements: [], transfers: [] };
  }

  const processedFrame = await samProcessor(rawImage);
  const embeddings = await samModel.get_image_embeddings({
    pixel_values: processedFrame.pixel_values,
  });

  const elements: SerializedDetectedElement[] = [];
  const transfers: ArrayBuffer[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];

    let inputBoxes = samProcessor.reshape_input_points(
      [[[t.box[0], t.box[1], t.box[2], t.box[3]]]],
      processedFrame.original_sizes,
      processedFrame.reshaped_input_sizes,
      true
    );
    if (inputBoxes.dims.length === 4) {
      inputBoxes = new Tensor('float32', inputBoxes.data, [
        inputBoxes.dims[0],
        inputBoxes.dims[2],
        inputBoxes.dims[3],
      ]);
    }

    const inputPoints = samProcessor.reshape_input_points(
      [[[[t.point[0], t.point[1]]]]],
      processedFrame.original_sizes,
      processedFrame.reshaped_input_sizes,
      false
    );
    const inputLabels = samProcessor.image_processor.add_input_labels(
      [[[1]]],
      inputPoints
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forwardInputs: Record<string, any> = {
      ...embeddings,
      input_points: inputPoints,
      input_labels: inputLabels,
    };

    if (activeSamModelId !== 'Xenova/slimsam-77-uniform') {
      forwardInputs.input_boxes = inputBoxes;
    }

    const outputs = await samModel(forwardInputs);
    const masks = await samProcessor.post_process_masks(
      outputs.pred_masks,
      processedFrame.original_sizes,
      processedFrame.reshaped_input_sizes,
      { binarize: false }
    );

    const iouData = outputs.iou_scores.data as Float32Array;
    let bestCandidateIdx = 0;
    let bestCandidateIou = -Infinity;
    const numCandidates = Math.min(3, iouData.length);
    for (let c = 0; c < numCandidates; c++) {
      if (iouData[c] > bestCandidateIou) {
        bestCandidateIou = iouData[c];
        bestCandidateIdx = c;
      }
    }

    const fullMaskTensor = masks[0];
    const fullData = fullMaskTensor.data as Float32Array;
    const chOffset = bestCandidateIdx * pixelCount;
    const channelSlice = fullData.subarray(chOffset, chOffset + pixelCount);

    const quantized = quantizeLogits(channelSlice);
    const peakInfo = computeMaskInteriorPeakAndBox(
      quantized,
      width,
      height,
      128
    );

    const buf = quantized.buffer as ArrayBuffer;
    elements.push({
      id: t.id,
      label: t.label,
      colorRgb: t.colorRgb,
      colorHex: t.colorHex,
      selected: true,
      iouScore: bestCandidateIou,
      areaFraction: peakInfo.area / pixelCount,
      bbox: peakInfo.bbox ?? t.box,
      peakPoint: [peakInfo.x, peakInfo.y],
      quantizedLogitsBuffer: buf,
    });
    transfers.push(buf);
  }

  return { elements, transfers };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'initModel') {
      await ensureModelsLoaded(msg.modelId, msg.requestId);
      return;
    }

    if (msg.type === 'detectElementsOnFrame') {
      const t0 = performance.now();
      const rgba = new Uint8ClampedArray(msg.rgbaBuffer);
      const rawImage = new RawImage(rgba, msg.width, msg.height, 4);

      const { elements, transfers } = await detectElementsOnFrame(
        rawImage,
        msg.autoDetect
      );
      const elapsedMs = Math.round(performance.now() - t0);

      post(
        {
          type: 'elementsDetectedResult',
          requestId: msg.requestId,
          frameIndex: msg.frameIndex,
          elements,
          elapsedMs,
        },
        transfers
      );
      return;
    }

    if (msg.type === 'propagateElements') {
      const t0 = performance.now();
      const rgba = new Uint8ClampedArray(msg.rgbaBuffer);
      const rawImage = new RawImage(rgba, msg.width, msg.height, 4);

      const { elements, transfers } = await propagateSelectedElements(
        rawImage,
        msg.targets
      );
      const elapsedMs = Math.round(performance.now() - t0);

      post(
        {
          type: 'elementsDetectedResult',
          requestId: msg.requestId,
          frameIndex: msg.frameIndex,
          elements,
          elapsedMs,
        },
        transfers
      );
    }
  } catch (err) {
    post({
      type: 'workerError',
      requestId: 'requestId' in msg ? msg.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
