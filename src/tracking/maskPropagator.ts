import {
  computeMaskInteriorPeakAndBox,
  padBoundingBox,
} from './distanceTransform';
import {
  ELEMENT_COLOR_PALETTE,
  mergeSelectedElementLogits,
} from './gridNms';
import {
  AutoDetectParams,
  BoundingBox,
  DetectedElement,
  FrameMaskEntry,
  PropagateElementPrompt,
  RuntimeBackend,
  SamModelId,
  SerializedDetectedElement,
  WorkerRequest,
  WorkerResponse,
} from '../types/segmentationTypes';

export interface MaskPropagatorCallbacks {
  onModelProgress: (
    progress: number,
    statusText: string,
    backend?: RuntimeBackend
  ) => void;
  onModelReady: (modelId: SamModelId, backend: RuntimeBackend) => void;
  onError: (message: string) => void;
}

export class MaskPropagator {
  private worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (res: WorkerResponse) => void;
      reject: (err: Error) => void;
    }
  >();
  private masks = new Map<number, FrameMaskEntry>();
  private abortPropagationFlag = false;
  private useMockInference = false;

  constructor(private callbacks: MaskPropagatorCallbacks) {
    this.worker = new Worker(
      new URL('../workers/samWorker.ts?v=4', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'modelProgress') {
        this.callbacks.onModelProgress(
          msg.progress,
          msg.statusText,
          msg.backend
        );
        return;
      }

      if (msg.type === 'modelReady') {
        this.callbacks.onModelReady(msg.modelId, msg.backend);
        const entry = this.pending.get(msg.requestId);
        if (entry) {
          this.pending.delete(msg.requestId);
          entry.resolve(msg);
        }
        return;
      }

      if (msg.type === 'elementsDetectedResult') {
        const entry = this.pending.get(msg.requestId);
        if (entry) {
          this.pending.delete(msg.requestId);
          entry.resolve(msg);
        }
        return;
      }

      if (msg.type === 'workerError') {
        if (msg.requestId !== undefined && this.pending.has(msg.requestId)) {
          const entry = this.pending.get(msg.requestId)!;
          this.pending.delete(msg.requestId);
          entry.reject(new Error(msg.message));
        } else {
          this.callbacks.onError(msg.message);
        }
      }
    };
  }

  public setMockInferenceMode(enabled: boolean): void {
    this.useMockInference = enabled;
  }

  public async initModel(modelId: SamModelId): Promise<void> {
    if (this.useMockInference) {
      this.callbacks.onModelReady(modelId, 'webgpu');
      return;
    }
    const requestId = this.nextRequestId++;
    await this.sendRequest({
      type: 'initModel',
      requestId,
      modelId,
    });
  }

  public getMask(frameIndex: number): FrameMaskEntry | undefined {
    return this.masks.get(frameIndex);
  }

  public setMask(frameIndex: number, entry: FrameMaskEntry): void {
    this.masks.set(frameIndex, entry);
  }

  public getAllMasks(): ReadonlyMap<number, FrameMaskEntry> {
    return this.masks;
  }

  public clearFrameMask(frameIndex: number): void {
    this.masks.delete(frameIndex);
  }

  public clearAllMasks(): void {
    this.masks.clear();
  }

  public stopPropagation(): void {
    this.abortPropagationFlag = true;
  }

  public resetAbortFlag(): void {
    this.abortPropagationFlag = false;
  }

  public isAborted(): boolean {
    return this.abortPropagationFlag;
  }

  public toggleElementSelection(
    frameIndex: number,
    elementId: string,
    width: number,
    height: number
  ): FrameMaskEntry | undefined {
    const entry = this.masks.get(frameIndex);
    if (!entry) return undefined;

    for (const el of entry.elements) {
      if (el.id === elementId) {
        el.selected = !el.selected;
      }
    }

    this.recomputeCompositeEntry(entry, width, height);
    return entry;
  }

  public setAllElementsSelection(
    frameIndex: number,
    selected: boolean,
    width: number,
    height: number
  ): FrameMaskEntry | undefined {
    const entry = this.masks.get(frameIndex);
    if (!entry) return undefined;

    for (const el of entry.elements) {
      el.selected = selected;
    }

    this.recomputeCompositeEntry(entry, width, height);
    return entry;
  }

  private recomputeCompositeEntry(
    entry: FrameMaskEntry,
    width: number,
    height: number
  ): void {
    entry.quantizedLogits = mergeSelectedElementLogits(
      entry.elements,
      width,
      height
    );
    const selectedEls = entry.elements.filter((el) => el.selected);
    entry.boxes = selectedEls.map((el) => ({
      xmin: el.bbox[0],
      ymin: el.bbox[1],
      xmax: el.bbox[2],
      ymax: el.bbox[3],
      score: el.iouScore,
      label: el.label,
    }));
    entry.iouScore =
      selectedEls.length > 0
        ? selectedEls.reduce((acc, el) => acc + el.iouScore, 0) /
          selectedEls.length
        : 0;
  }

  public async detectFrameElements(
    frameIndex: number,
    frameRgba: Uint8ClampedArray,
    width: number,
    height: number,
    autoDetect: AutoDetectParams
  ): Promise<FrameMaskEntry> {
    if (this.useMockInference) {
      return this.generateMockDetectedEntry(
        frameIndex,
        frameRgba,
        width,
        height,
        true
      );
    }

    const requestId = this.nextRequestId++;
    const copyBuffer = new Uint8ClampedArray(frameRgba).buffer as ArrayBuffer;

    const response = await this.sendRequest(
      {
        type: 'detectElementsOnFrame',
        requestId,
        frameIndex,
        width,
        height,
        rgbaBuffer: copyBuffer,
        autoDetect,
      },
      [copyBuffer]
    );

    if (response.type !== 'elementsDetectedResult') {
      throw new Error('Unexpected worker response for detectElementsOnFrame');
    }

    const entry = this.buildEntryFromSerialized(
      frameIndex,
      response.elements,
      width,
      height,
      true
    );
    this.masks.set(frameIndex, entry);
    return entry;
  }

  public async propagateElementsFromPrevious(
    prevEntry: FrameMaskEntry,
    targetFrameIndex: number,
    targetFrameRgba: Uint8ClampedArray,
    width: number,
    height: number,
    autoDetect: AutoDetectParams
  ): Promise<{ entry: FrameMaskEntry; elapsedMs: number }> {
    const selectedElements = prevEntry.elements.filter((el) => el.selected);

    if (this.useMockInference) {
      const t0 = performance.now();
      const entry = this.generateMockDetectedEntry(
        targetFrameIndex,
        targetFrameRgba,
        width,
        height,
        false,
        new Set(selectedElements.map((el) => el.id))
      );
      return {
        entry,
        elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      };
    }

    if (selectedElements.length === 0) {
      const t0 = performance.now();
      const entry = await this.detectFrameElements(
        targetFrameIndex,
        targetFrameRgba,
        width,
        height,
        autoDetect
      );
      entry.isKeyframe = false;
      return {
        entry,
        elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
      };
    }

    const targets: PropagateElementPrompt[] = selectedElements.map((el) => {
      const peakInfo = computeMaskInteriorPeakAndBox(
        el.quantizedLogits,
        width,
        height,
        128
      );
      const rawBox = peakInfo.bbox ?? el.bbox;
      const paddedBox = padBoundingBox(rawBox, width, height, 0.08);
      return {
        id: el.id,
        label: el.label,
        colorRgb: el.colorRgb,
        colorHex: el.colorHex,
        box: paddedBox,
        point: peakInfo.area > 8 ? [peakInfo.x, peakInfo.y] : el.peakPoint,
      };
    });

    const requestId = this.nextRequestId++;
    const copyBuffer = new Uint8ClampedArray(targetFrameRgba)
      .buffer as ArrayBuffer;

    const response = await this.sendRequest(
      {
        type: 'propagateElements',
        requestId,
        frameIndex: targetFrameIndex,
        width,
        height,
        rgbaBuffer: copyBuffer,
        targets,
      },
      [copyBuffer]
    );

    if (response.type !== 'elementsDetectedResult') {
      throw new Error('Unexpected worker response for propagateElements');
    }

    const entry = this.buildEntryFromSerialized(
      targetFrameIndex,
      response.elements,
      width,
      height,
      false
    );
    this.masks.set(targetFrameIndex, entry);
    return { entry, elapsedMs: response.elapsedMs };
  }

  private buildEntryFromSerialized(
    frameIndex: number,
    serialized: SerializedDetectedElement[],
    width: number,
    height: number,
    isKeyframe: boolean
  ): FrameMaskEntry {
    const elements: DetectedElement[] = serialized.map((s) => ({
      id: s.id,
      label: s.label,
      colorRgb: s.colorRgb,
      colorHex: s.colorHex,
      selected: s.selected,
      iouScore: s.iouScore,
      areaFraction: s.areaFraction,
      bbox: s.bbox,
      peakPoint: s.peakPoint,
      quantizedLogits: new Uint8Array(s.quantizedLogitsBuffer),
    }));

    const quantizedLogits = mergeSelectedElementLogits(elements, width, height);
    const selectedEls = elements.filter((el) => el.selected);
    const boxes: BoundingBox[] = selectedEls.map((el) => ({
      xmin: el.bbox[0],
      ymin: el.bbox[1],
      xmax: el.bbox[2],
      ymax: el.bbox[3],
      score: el.iouScore,
      label: el.label,
    }));
    const avgIou =
      selectedEls.length > 0
        ? selectedEls.reduce((a, b) => a + b.iouScore, 0) / selectedEls.length
        : 0;

    return {
      frameIndex,
      quantizedLogits,
      elements,
      iouScore: avgIou,
      isKeyframe,
      lowConfidence: elements.length === 0 || avgIou < 0.55,
      boxes,
    };
  }

  private generateMockDetectedEntry(
    frameIndex: number,
    frameRgba: Uint8ClampedArray,
    width: number,
    height: number,
    isKeyframe: boolean,
    selectedIds?: Set<string>
  ): FrameMaskEntry {
    const size = width * height;
    const logitsEl1 = new Uint8Array(size);
    const logitsEl2 = new Uint8Array(size);
    logitsEl1.fill(40);
    logitsEl2.fill(40);

    for (let i = 0; i < size; i++) {
      const p = i * 4;
      const r = frameRgba[p];
      const g = frameRgba[p + 1];
      const b = frameRgba[p + 2];
      if (r > 150 && r > g + 40) {
        logitsEl1[i] = 210; // Element #1 (orange circle)
      } else if (g > 150 && g > r + 40) {
        logitsEl2[i] = 210; // Element #2 (green square)
      }
    }

    const peak1 = computeMaskInteriorPeakAndBox(logitsEl1, width, height, 128);
    const peak2 = computeMaskInteriorPeakAndBox(logitsEl2, width, height, 128);

    const elements: DetectedElement[] = [];
    if (peak1.bbox && peak1.area > 0) {
      elements.push({
        id: 'el_1',
        label: 'element #1',
        colorRgb: ELEMENT_COLOR_PALETTE[0].rgb,
        colorHex: ELEMENT_COLOR_PALETTE[0].hex,
        selected: selectedIds ? selectedIds.has('el_1') : true,
        iouScore: 0.94,
        areaFraction: peak1.area / size,
        bbox: peak1.bbox,
        peakPoint: [peak1.x, peak1.y],
        quantizedLogits: logitsEl1,
      });
    }
    if (peak2.bbox && peak2.area > 0) {
      elements.push({
        id: 'el_2',
        label: 'element #2',
        colorRgb: ELEMENT_COLOR_PALETTE[1].rgb,
        colorHex: ELEMENT_COLOR_PALETTE[1].hex,
        selected: selectedIds ? selectedIds.has('el_2') : false,
        iouScore: 0.91,
        areaFraction: peak2.area / size,
        bbox: peak2.bbox,
        peakPoint: [peak2.x, peak2.y],
        quantizedLogits: logitsEl2,
      });
    }

    const entry: FrameMaskEntry = {
      frameIndex,
      quantizedLogits: new Uint8Array(size),
      elements,
      iouScore: 0.94,
      isKeyframe,
      lowConfidence: elements.length === 0,
      boxes: [],
    };
    this.recomputeCompositeEntry(entry, width, height);
    this.masks.set(frameIndex, entry);
    return entry;
  }

  private sendRequest(
    req: WorkerRequest,
    transfer?: Transferable[]
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.requestId, { resolve, reject });
      if (transfer && transfer.length > 0) {
        this.worker.postMessage(req, transfer);
      } else {
        this.worker.postMessage(req);
      }
    });
  }
}
