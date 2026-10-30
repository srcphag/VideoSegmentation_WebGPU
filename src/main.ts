import './ui/terminal.css';
import './ui/styles.css';

import { ProResProfile } from 'prores-wasm-encoder';
import { createControlPanel } from './components/controlPanel';
import { createTimelineBar } from './components/timelineBar';
import { createTopBar } from './components/topBar';
import { createVideoViewport } from './components/videoViewport';
import { renderCompositePreview } from './rendering/frameCompositor';
import { postProcessMask } from './rendering/maskPostProcessor';
import {
  exportProResMovs,
  triggerBlobDownload,
} from './rendering/proresExporter';
import { VideoFrameManager } from './rendering/videoFrameManager';
import { hitTestDetectedElements } from './tracking/gridNms';
import { MaskPropagator } from './tracking/maskPropagator';
import {
  AppState,
  AutoDetectParams,
  DEFAULT_AUTO_DETECT,
  DEFAULT_REFINEMENT,
  MaskRefinementParams,
  PreviewMode,
  RenderOutputMode,
  SamModelId,
} from './types/segmentationTypes';

class VideoSegmentationApp {
  private state: AppState = {
    video: null,
    currentFrame: 0,
    inFrame: 0,
    outFrame: 0,
    isPlaying: false,
    showStats: false,

    modelId: 'onnx-community/EdgeTAM-ONNX',
    runtimeBackend: 'webgpu',
    modelReady: false,
    modelLoadingProgress: 0,
    modelStatusText: 'standby (loads on demand)',

    autoDetect: { ...DEFAULT_AUTO_DETECT },
    isDetectingFrame: false,
    hoveredElementId: null,

    previewMode: 'overlay',
    refinement: { ...DEFAULT_REFINEMENT },

    renderOutputMode: 'alpha',
    alphaProfile: ProResProfile.P4444,
    matteProfile: ProResProfile.HQ,

    tracking: {
      isTracking: false,
      currentFrame: 0,
      targetEndFrame: 0,
      msPerFrame: 0,
      lowConfidenceWarning: false,
      statusText: 'idle',
    },
    exportStatus: {
      isExporting: false,
      currentFrame: 0,
      totalFrames: 0,
      fps: 0,
      phaseLabel: 'ready',
    },
    errors: [],
  };

  private frameManager = new VideoFrameManager();
  private propagator: MaskPropagator;
  private topBar;
  private viewport;
  private timelineBar;
  private controlPanel;
  private toastContainer: HTMLDivElement;

  private currentFrameRgba: Uint8ClampedArray | null = null;
  private playTimer: number | null = null;
  private abortExportFlag = false;
  private seekGeneration = 0;

  constructor(root: HTMLElement) {
    this.toastContainer = document.createElement('div');
    this.toastContainer.className = 'toast-container';
    this.toastContainer.setAttribute('data-testid', 'error-container');
    root.appendChild(this.toastContainer);

    this.propagator = new MaskPropagator({
      onModelProgress: (progress, statusText, backend) => {
        this.state.modelLoadingProgress = progress;
        this.state.modelStatusText = statusText;
        if (backend) {
          this.state.runtimeBackend = backend;
        }
        this.syncUI();
      },
      onModelReady: (modelId, backend) => {
        this.state.modelId = modelId;
        this.state.runtimeBackend = backend;
        this.state.modelReady = true;
        this.state.modelLoadingProgress = 100;
        this.state.modelStatusText = 'ready';
        this.syncUI();
      },
      onError: (message) => {
        this.addError(message);
      },
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('mockAi') === '1') {
      this.propagator.setMockInferenceMode(true);
      this.state.modelReady = true;
      this.state.modelLoadingProgress = 100;
      this.state.modelStatusText = 'ready (mock)';
    }

    this.topBar = createTopBar({
      onSelectVideoFile: (file) => void this.handleLoadVideoFile(file),
      onLoadDemoClip: () => void this.handleLoadDemoClip(),
      onSelectModel: (modelId) => void this.handleSelectModel(modelId),
      onChangeAutoDetect: (key, val) => this.handleChangeAutoDetect(key, val),
      onResetAutoDetect: () => {
        this.state.autoDetect = { ...DEFAULT_AUTO_DETECT };
        this.syncUI();
      },
      onAutoDetectCurrentFrame: () => void this.handleAutoDetectCurrentFrame(),
      onClearCurrentFrameMask: () => this.handleClearCurrentFrameMask(),
      onToggleElement: (elId) => this.handleToggleElement(elId),
      onHoverElement: (elId) => this.handleSetHoveredElement(elId),
      onSelectAllElements: (selected) =>
        this.handleSelectAllElements(selected),
    });

    this.viewport = createVideoViewport({
      onDropVideoFile: (file) => void this.handleLoadVideoFile(file),
      onClickDropzone: () => this.topBar.openFilePicker(),
      onToggleStats: () => {
        this.state.showStats = !this.state.showStats;
        this.syncUI();
      },
      onResetAll: () => this.handleResetAll(),
      onHoverCanvasPixel: (x, y) => this.handleHoverCanvasPixel(x, y),
      onLeaveCanvas: () => this.handleSetHoveredElement(null),
      onClickCanvasPixel: (x, y) => this.handleClickCanvasPixel(x, y),
    });

    this.timelineBar = createTimelineBar({
      onTogglePlay: () => this.handleTogglePlay(),
      onSeekFrame: (frameIndex) => void this.seekToFrame(frameIndex),
      onStepFrame: (delta) =>
        void this.seekToFrame(this.state.currentFrame + delta),
      onJumpKeyframe: (direction) => this.handleJumpKeyframe(direction),
      onChangeInOut: (inFrame, outFrame) =>
        this.handleChangeInOut(inFrame, outFrame),
    });

    this.controlPanel = createControlPanel({
      onTogglePropagate: () => void this.handleTogglePropagate(),
      onChangePreviewMode: (mode) => this.handleChangePreviewMode(mode),
      onChangeRefinement: (key, value) =>
        this.handleChangeRefinement(key, value),
      onResetRefinementKey: (key) => this.handleResetRefinementKey(key),
      onResetRefinementGroup: () => this.handleResetRefinementGroup(),
      onChangeRenderOutputMode: (mode) =>
        this.handleChangeRenderOutputMode(mode),
      onChangeAlphaProfile: (profile) => {
        this.state.alphaProfile = profile;
        this.syncUI();
      },
      onChangeMatteProfile: (profile) => {
        this.state.matteProfile = profile;
        this.syncUI();
      },
      onTriggerExportMov: () => void this.handleExportMov(),
      onCancelExportMov: () => {
        this.abortExportFlag = true;
      },
    });

    this.viewport.mountTimeline(this.timelineBar.element);
    root.appendChild(this.topBar.element);
    root.appendChild(this.viewport.stageElement);
    root.appendChild(this.controlPanel.element);

    this.syncUI();

    if (params.get('demo') === '1') {
      void this.handleLoadDemoClip();
    }
  }

  public getState(): AppState {
    return this.state;
  }

  public addError(message: string): void {
    this.state.errors.push(message);
    const toast = document.createElement('div');
    toast.className = 'toast is-danger';
    toast.innerHTML = `
      <div>
        <div class="toast-title">error</div>
        <div class="toast-message">${message}</div>
      </div>
      <button type="button" class="toast-close" title="Dismiss">×</button>
    `;
    toast.querySelector('.toast-close')?.addEventListener('click', () => {
      toast.remove();
    });
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 6000);
  }

  private handleChangeAutoDetect(
    key: keyof AutoDetectParams,
    value: number
  ): void {
    if (key === 'gridDensity') {
      this.state.autoDetect.gridDensity = Math.max(
        4,
        Math.min(10, Math.round(value))
      );
    } else if (key === 'iouThreshold') {
      this.state.autoDetect.iouThreshold = Math.max(0.5, Math.min(0.95, value));
    } else if (key === 'minAreaPercent') {
      this.state.autoDetect.minAreaPercent = Math.max(
        0.5,
        Math.min(10, value)
      );
    }
    this.syncUI();
  }

  public handleToggleElement(elementId: string): void {
    if (!this.state.video) return;
    this.propagator.toggleElementSelection(
      this.state.currentFrame,
      elementId,
      this.state.video.width,
      this.state.video.height
    );
    this.renderCurrentViewport();
    this.syncUI();
  }

  public handleSelectAllElements(selected: boolean): void {
    if (!this.state.video) return;
    this.propagator.setAllElementsSelection(
      this.state.currentFrame,
      selected,
      this.state.video.width,
      this.state.video.height
    );
    this.renderCurrentViewport();
    this.syncUI();
  }

  private handleSetHoveredElement(elementId: string | null): void {
    if (this.state.hoveredElementId === elementId) return;
    this.state.hoveredElementId = elementId;
    this.renderCurrentViewport();
    this.syncUI();
  }

  private handleHoverCanvasPixel(x: number, y: number): void {
    if (!this.state.video) return;
    const maskEntry = this.propagator.getMask(this.state.currentFrame);
    if (!maskEntry || maskEntry.elements.length === 0) {
      this.handleSetHoveredElement(null);
      return;
    }
    const hitId = hitTestDetectedElements(
      maskEntry.elements,
      this.state.video.width,
      this.state.video.height,
      x,
      y
    );
    this.handleSetHoveredElement(hitId);
  }

  private handleClickCanvasPixel(x: number, y: number): void {
    if (!this.state.video) return;
    const maskEntry = this.propagator.getMask(this.state.currentFrame);
    if (!maskEntry || maskEntry.elements.length === 0) return;

    const hitId = hitTestDetectedElements(
      maskEntry.elements,
      this.state.video.width,
      this.state.video.height,
      x,
      y
    );
    if (hitId) {
      this.handleToggleElement(hitId);
    }
  }

  private async ensureModelReady(): Promise<void> {
    if (this.state.modelReady) return;
    await this.propagator.initModel(this.state.modelId);
  }

  private async handleSelectModel(modelId: SamModelId): Promise<void> {
    this.state.modelId = modelId;
    this.state.modelReady = false;
    this.state.modelLoadingProgress = 0;
    this.state.modelStatusText = 'switching model...';
    this.syncUI();
    try {
      await this.propagator.initModel(modelId);
    } catch (err) {
      this.addError(
        err instanceof Error ? err.message : 'Failed to initialize model.'
      );
    }
  }

  private async handleLoadVideoFile(file: File): Promise<void> {
    this.stopPlayback();
    this.propagator.stopPropagation();
    this.propagator.clearAllMasks();
    this.state.hoveredElementId = null;
    try {
      const meta = await this.frameManager.loadVideoFile(file);
      this.state.video = meta;
      this.state.currentFrame = 0;
      this.state.inFrame = 0;
      this.state.outFrame = Math.max(0, meta.totalFrames - 1);
      this.state.tracking = {
        isTracking: false,
        currentFrame: 0,
        targetEndFrame: this.state.outFrame,
        msPerFrame: 0,
        lowConfidenceWarning: false,
        statusText: 'idle',
      };
      await this.seekToFrame(0);
    } catch (err) {
      this.addError(
        err instanceof Error ? err.message : 'Failed to load video file.'
      );
    }
  }

  public async handleLoadDemoClip(): Promise<void> {
    this.stopPlayback();
    this.propagator.stopPropagation();
    this.propagator.clearAllMasks();
    this.state.hoveredElementId = null;

    const meta = this.frameManager.loadSyntheticVideo(
      320,
      180,
      24,
      16,
      'demoElements.mp4'
    );
    this.state.video = meta;
    this.state.currentFrame = 0;
    this.state.inFrame = 0;
    this.state.outFrame = meta.totalFrames - 1;
    this.state.tracking = {
      isTracking: false,
      currentFrame: 0,
      targetEndFrame: this.state.outFrame,
      msPerFrame: 0,
      lowConfidenceWarning: false,
      statusText: 'idle',
    };
    await this.seekToFrame(0);
  }

  public async seekToFrame(frameIndex: number): Promise<void> {
    if (!this.state.video) return;
    const total = this.state.video.totalFrames;
    const clamped = Math.max(0, Math.min(total - 1, Math.round(frameIndex)));
    this.state.currentFrame = clamped;
    this.state.hoveredElementId = null;
    const gen = ++this.seekGeneration;

    // Immediately sync timeline playhead & counters without waiting for video decode
    this.syncUI();

    try {
      const rgba = await this.frameManager.scrubToFrameRgba(clamped);
      if (!rgba || gen !== this.seekGeneration) {
        return;
      }
      this.currentFrameRgba = rgba;
      this.renderCurrentViewport();
      this.syncUI();
    } catch (err) {
      this.addError(
        err instanceof Error ? err.message : 'Failed to seek video frame.'
      );
    }
  }

  private renderCurrentViewport(): void {
    if (!this.state.video || !this.currentFrameRgba) return;
    const { width, height } = this.state.video;
    const maskEntry = this.propagator.getMask(this.state.currentFrame);

    let alphaMask: Uint8Array | null = null;
    if (maskEntry) {
      const hasSelected = maskEntry.elements.some((el) => el.selected);
      if (hasSelected) {
        alphaMask = postProcessMask(
          maskEntry.quantizedLogits,
          width,
          height,
          this.state.refinement
        );
      } else {
        alphaMask = new Uint8Array(width * height);
      }
    }

    renderCompositePreview(
      this.viewport.canvas,
      this.currentFrameRgba,
      alphaMask,
      width,
      height,
      this.state.previewMode,
      maskEntry?.elements,
      this.state.hoveredElementId
    );
  }

  public async handleAutoDetectCurrentFrame(): Promise<void> {
    if (!this.state.video || this.state.isDetectingFrame) return;

    this.stopPlayback();
    this.state.isDetectingFrame = true;
    this.state.tracking.statusText = 'scanning grid...';
    this.syncUI();

    try {
      await this.ensureModelReady();
      const frameIdx = this.state.currentFrame;
      const rgba =
        this.currentFrameRgba ??
        (await this.frameManager.getFrameRgba(frameIdx));
      this.currentFrameRgba = rgba;

      const t0 = performance.now();
      const entry = await this.propagator.detectFrameElements(
        frameIdx,
        rgba,
        this.state.video.width,
        this.state.video.height,
        { ...this.state.autoDetect }
      );
      const elapsed = Math.max(1, Math.round(performance.now() - t0));

      this.state.tracking.msPerFrame = elapsed;
      this.state.tracking.lowConfidenceWarning = entry.lowConfidence;
      this.state.tracking.statusText =
        entry.elements.length > 0
          ? `found ${entry.elements.length} elements`
          : 'no elements found';

      this.renderCurrentViewport();
    } catch (err) {
      this.addError(
        err instanceof Error ? err.message : 'Auto-detect grid scan failed.'
      );
      this.state.tracking.statusText = 'error';
    } finally {
      this.state.isDetectingFrame = false;
      this.syncUI();
    }
  }

  public handleSegmentCurrentFrame(): Promise<void> {
    return this.handleAutoDetectCurrentFrame();
  }

  private handleClearCurrentFrameMask(): void {
    this.propagator.clearFrameMask(this.state.currentFrame);
    this.state.hoveredElementId = null;
    this.renderCurrentViewport();
    this.syncUI();
  }

  public async handleTogglePropagate(): Promise<void> {
    if (!this.state.video) return;

    if (this.state.tracking.isTracking) {
      this.propagator.stopPropagation();
      this.state.tracking.isTracking = false;
      this.state.tracking.statusText = 'paused';
      this.syncUI();
      return;
    }

    this.stopPlayback();
    this.propagator.resetAbortFlag();
    this.state.tracking.isTracking = true;
    this.state.tracking.targetEndFrame = this.state.outFrame;
    this.state.tracking.statusText = 'initializing...';
    this.syncUI();

    try {
      await this.ensureModelReady();
      const { width, height } = this.state.video;
      const startFrame =
        this.state.currentFrame >= this.state.outFrame
          ? this.state.inFrame
          : Math.max(this.state.inFrame, this.state.currentFrame);
      const endFrame = this.state.outFrame;

      // Ensure startFrame is detected first
      let prevEntry = this.propagator.getMask(startFrame);
      if (!prevEntry) {
        const firstRgba = await this.frameManager.getFrameRgba(startFrame);
        prevEntry = await this.propagator.detectFrameElements(
          startFrame,
          firstRgba,
          width,
          height,
          { ...this.state.autoDetect }
        );
        this.state.currentFrame = startFrame;
        this.currentFrameRgba = firstRgba;
        this.renderCurrentViewport();
        this.syncUI();
      }

      for (let f = startFrame + 1; f <= endFrame; f++) {
        if (this.propagator.isAborted()) break;

        this.state.tracking.currentFrame = f;
        this.state.tracking.statusText = `propagating ${f}/${endFrame}`;
        this.syncUI();

        const targetRgba = await this.frameManager.getFrameRgba(f);
        const { entry, elapsedMs } =
          await this.propagator.propagateElementsFromPrevious(
            prevEntry,
            f,
            targetRgba,
            width,
            height,
            { ...this.state.autoDetect }
          );

        prevEntry = entry;
        this.state.currentFrame = f;
        this.currentFrameRgba = targetRgba;
        this.state.tracking.msPerFrame = elapsedMs;
        this.state.tracking.lowConfidenceWarning = entry.lowConfidence;

        this.renderCurrentViewport();
        this.syncUI();
      }

      if (!this.propagator.isAborted()) {
        this.state.tracking.statusText = 'complete';
      }
    } catch (err) {
      this.addError(
        err instanceof Error ? err.message : 'Mask propagation failed.'
      );
      this.state.tracking.statusText = 'error';
    } finally {
      this.state.tracking.isTracking = false;
      this.syncUI();
    }
  }

  private handleChangePreviewMode(mode: PreviewMode): void {
    this.state.previewMode = mode;
    this.renderCurrentViewport();
    this.syncUI();
  }

  private handleChangeRefinement(
    key: keyof MaskRefinementParams,
    value: number
  ): void {
    if (key === 'threshold') {
      this.state.refinement.threshold = Math.max(-2, Math.min(2, value));
    } else if (key === 'chokeExpand') {
      this.state.refinement.chokeExpand = Math.max(
        -10,
        Math.min(10, Math.round(value))
      );
    } else if (key === 'edgeFeather') {
      this.state.refinement.edgeFeather = Math.max(
        0,
        Math.min(20, Math.round(value))
      );
    }
    this.renderCurrentViewport();
    this.syncUI();
  }

  private handleResetRefinementKey(key: keyof MaskRefinementParams): void {
    this.state.refinement[key] = DEFAULT_REFINEMENT[key];
    this.renderCurrentViewport();
    this.syncUI();
  }

  private handleResetRefinementGroup(): void {
    this.state.refinement = { ...DEFAULT_REFINEMENT };
    this.renderCurrentViewport();
    this.syncUI();
  }

  private handleChangeRenderOutputMode(mode: RenderOutputMode): void {
    this.state.renderOutputMode = mode;
    this.syncUI();
  }

  private handleResetAll(): void {
    this.stopPlayback();
    this.propagator.stopPropagation();
    this.propagator.clearAllMasks();
    this.state.hoveredElementId = null;
    this.state.autoDetect = { ...DEFAULT_AUTO_DETECT };
    this.state.refinement = { ...DEFAULT_REFINEMENT };
    this.state.previewMode = 'overlay';
    this.state.tracking.lowConfidenceWarning = false;
    this.state.tracking.statusText = 'idle';
    this.renderCurrentViewport();
    this.syncUI();
  }

  private handleTogglePlay(): void {
    if (!this.state.video) return;
    if (this.state.isPlaying) {
      this.stopPlayback();
      return;
    }

    this.state.isPlaying = true;
    this.syncUI();
    const intervalMs = Math.round(1000 / Math.max(1, this.state.video.fps));

    const step = async () => {
      if (!this.state.isPlaying || !this.state.video) return;
      let nextFrame = this.state.currentFrame + 1;
      if (nextFrame > this.state.outFrame) {
        nextFrame = this.state.inFrame;
      }
      await this.seekToFrame(nextFrame);
      if (this.state.isPlaying) {
        this.playTimer = window.setTimeout(step, intervalMs);
      }
    };

    this.playTimer = window.setTimeout(step, intervalMs);
  }

  private stopPlayback(): void {
    this.state.isPlaying = false;
    if (this.playTimer !== null) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    this.syncUI();
  }

  private handleJumpKeyframe(direction: -1 | 1): void {
    const keyframes: number[] = [];
    this.propagator.getAllMasks().forEach((entry, idx) => {
      if (entry.isKeyframe) keyframes.push(idx);
    });
    if (keyframes.length === 0) return;
    keyframes.sort((a, b) => a - b);

    if (direction === -1) {
      for (let i = keyframes.length - 1; i >= 0; i--) {
        if (keyframes[i] < this.state.currentFrame) {
          void this.seekToFrame(keyframes[i]);
          return;
        }
      }
      void this.seekToFrame(keyframes[keyframes.length - 1]);
    } else {
      for (let i = 0; i < keyframes.length; i++) {
        if (keyframes[i] > this.state.currentFrame) {
          void this.seekToFrame(keyframes[i]);
          return;
        }
      }
      void this.seekToFrame(keyframes[0]);
    }
  }

  private handleChangeInOut(inFrame: number, outFrame: number): void {
    if (!this.state.video) return;
    const maxF = Math.max(0, this.state.video.totalFrames - 1);
    const clampedIn = Math.max(0, Math.min(maxF, Math.round(inFrame)));
    const clampedOut = Math.max(
      clampedIn,
      Math.min(maxF, Math.round(outFrame))
    );
    this.state.inFrame = clampedIn;
    this.state.outFrame = clampedOut;
    this.state.tracking.targetEndFrame = clampedOut;
    this.syncUI();
  }

  public async handleExportMov(): Promise<void> {
    if (!this.state.video || this.state.exportStatus.isExporting) return;

    this.stopPlayback();
    this.abortExportFlag = false;

    const { width, height, fps, filename } = this.state.video;
    const inFrame = this.state.inFrame;
    const outFrame = this.state.outFrame;

    this.state.exportStatus = {
      isExporting: true,
      currentFrame: 0,
      totalFrames: Math.max(1, outFrame - inFrame + 1),
      fps: 0,
      phaseLabel: 'preparing masks...',
    };
    this.syncUI();

    try {
      await this.ensureModelReady();

      const outputs = await exportProResMovs({
        filenameBase: filename,
        width,
        height,
        fps,
        inFrame,
        outFrame,
        renderOutputMode: this.state.renderOutputMode,
        alphaProfile: this.state.alphaProfile,
        matteProfile: this.state.matteProfile,
        refinement: { ...this.state.refinement },
        shouldAbort: () => this.abortExportFlag,
        onProgress: (info) => {
          this.state.exportStatus.currentFrame = info.currentFrame;
          this.state.exportStatus.totalFrames = info.totalFrames;
          this.state.exportStatus.fps = info.fps;
          this.state.exportStatus.phaseLabel = info.phaseLabel;
          this.syncUI();
        },
        getFrameAndMask: async (fIdx) => {
          const sourceRgba = await this.frameManager.getFrameRgba(fIdx);
          let entry = this.propagator.getMask(fIdx);
          if (!entry) {
            const prevEntry = this.propagator.getMask(fIdx - 1);
            if (prevEntry) {
              const prop = await this.propagator.propagateElementsFromPrevious(
                prevEntry,
                fIdx,
                sourceRgba,
                width,
                height,
                { ...this.state.autoDetect }
              );
              entry = prop.entry;
            } else {
              entry = await this.propagator.detectFrameElements(
                fIdx,
                sourceRgba,
                width,
                height,
                { ...this.state.autoDetect }
              );
            }
          }
          return {
            sourceRgba,
            quantizedLogits: entry.quantizedLogits,
          };
        },
      });

      if (this.abortExportFlag) {
        this.state.exportStatus.phaseLabel = 'canceled';
      } else {
        for (const out of outputs) {
          triggerBlobDownload(out.blob, out.filename);
        }
        this.state.exportStatus.phaseLabel = `exported ${outputs.length} .mov`;
      }
    } catch (err) {
      this.addError(
        err instanceof Error ? err.message : 'ProRes export failed.'
      );
      this.state.exportStatus.phaseLabel = 'error';
    } finally {
      this.state.exportStatus.isExporting = false;
      this.syncUI();
    }
  }

  private syncUI(): void {
    const masks = this.propagator.getAllMasks();
    const curMask = masks.get(this.state.currentFrame);

    this.topBar.update(this.state, curMask?.elements ?? []);
    this.viewport.update(this.state, curMask, masks.size);
    this.timelineBar.update(this.state, masks);
    this.controlPanel.update(this.state, masks.size > 0);
  }
}

const rootEl = document.getElementById('app');
if (!rootEl) {
  throw new Error('Root #app element not found');
}

const appInstance = new VideoSegmentationApp(rootEl);
// Expose debug handle for e2e tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__videoSegmentationApp = appInstance;
