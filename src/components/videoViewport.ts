import { AppState, FrameMaskEntry } from '../types/segmentationTypes';

const DROPZONE_GLYPH_SVG = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <rect x="2" y="4" width="20" height="16" />
  <polygon points="10,8 16,12 10,16" fill="currentColor" />
</svg>`;

export interface VideoViewportCallbacks {
  onDropVideoFile: (file: File) => void;
  onClickDropzone: () => void;
  onToggleStats: () => void;
  onResetAll: () => void;
  onHoverCanvasPixel: (x: number, y: number) => void;
  onLeaveCanvas: () => void;
  onClickCanvasPixel: (x: number, y: number) => void;
}

export interface VideoViewportController {
  stageElement: HTMLElement;
  canvas: HTMLCanvasElement;
  mountTimeline: (timelineEl: HTMLElement) => void;
  update: (
    state: AppState,
    currentMask: FrameMaskEntry | undefined,
    trackedCount: number
  ) => void;
}

export function createVideoViewport(
  callbacks: VideoViewportCallbacks
): VideoViewportController {
  const main = document.createElement('main');
  main.className = 'ts-panel-stage';
  main.setAttribute('data-testid', 'panel-stage');

  const canvas = document.createElement('canvas');
  canvas.className = 'ts-render-canvas';
  canvas.setAttribute('data-testid', 'render-canvas');
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.display = 'none';
  canvas.title = 'Click any detected element to toggle selection';

  main.innerHTML = `
    <header class="ts-section-heading">
      <div style="display:flex; align-items:baseline; gap:12px;">
        <span class="ts-section-title">VideoSegmentation v0.1</span>
        <span class="ts-section-meta" data-testid="stage-resolution-label">NO VIDEO LOADED</span>
      </div>
      <div class="ts-header-actions">
        <button type="button" class="button ts-btn-small" data-testid="stats-toggle-btn">stats</button>
        <button type="button" class="button ts-btn-small" data-testid="reset-all-btn">reset all</button>
      </div>
    </header>

    <div class="ts-canvas-stage" data-testid="canvas-stage">
      <div class="ts-stats-overlay" data-testid="stats-overlay" style="display:none;"></div>
      <div class="ts-dropzone" data-testid="empty-dropzone">
        <div class="ts-empty-glyph">${DROPZONE_GLYPH_SVG}</div>
        <span class="ts-dropzone-title">drop video file (.mp4, .webm, .mov) or click to browse</span>
        <span class="ts-dropzone-sub">100% in-browser auto-detect element segmentation & apple prores .mov rendering</span>
      </div>
    </div>
  `;

  const q = <T extends HTMLElement>(testId: string): T => {
    const el = main.querySelector(`[data-testid="${testId}"]`);
    if (!el) throw new Error(`Missing element [data-testid="${testId}"]`);
    return el as T;
  };

  const canvasStage = q<HTMLDivElement>('canvas-stage');
  const dropzone = q<HTMLDivElement>('empty-dropzone');
  const statsOverlay = q<HTMLDivElement>('stats-overlay');
  canvasStage.appendChild(canvas);

  q<HTMLButtonElement>('stats-toggle-btn').addEventListener('click', () => {
    callbacks.onToggleStats();
  });
  q<HTMLButtonElement>('reset-all-btn').addEventListener('click', () => {
    callbacks.onResetAll();
  });

  dropzone.addEventListener('click', () => {
    callbacks.onClickDropzone();
  });

  // Pointer hit-testing on canvas to hover/select detected elements
  const getCanvasPixelCoords = (e: MouseEvent): [number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return [x, y];
  };

  canvas.addEventListener('pointermove', (e) => {
    const coords = getCanvasPixelCoords(e);
    if (coords) {
      callbacks.onHoverCanvasPixel(coords[0], coords[1]);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    callbacks.onLeaveCanvas();
  });

  canvas.addEventListener('click', (e) => {
    const coords = getCanvasPixelCoords(e);
    if (coords) {
      callbacks.onClickCanvasPixel(coords[0], coords[1]);
    }
  });

  // Drag and drop on stage / dropzone
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  };
  const onDragLeave = () => {
    dropzone.classList.remove('is-dragover');
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      callbacks.onDropVideoFile(file);
    }
  };

  canvasStage.addEventListener('dragover', onDragOver);
  canvasStage.addEventListener('dragleave', onDragLeave);
  canvasStage.addEventListener('drop', onDrop);

  const mountTimeline = (timelineEl: HTMLElement): void => {
    main.appendChild(timelineEl);
  };

  const update = (
    state: AppState,
    currentMask: FrameMaskEntry | undefined,
    trackedCount: number
  ): void => {
    const resLabel = q<HTMLSpanElement>('stage-resolution-label');
    if (state.video) {
      resLabel.textContent = `${state.video.width} X ${state.video.height} PX @ ${state.video.fps} FPS`;
      dropzone.style.display = 'none';
      canvas.style.display = 'block';
      canvas.style.cursor = state.hoveredElementId ? 'pointer' : 'crosshair';
    } else {
      resLabel.textContent = 'NO VIDEO LOADED';
      dropzone.style.display = 'flex';
      canvas.style.display = 'none';
    }

    q<HTMLButtonElement>('stats-toggle-btn').classList.toggle(
      'is-primary',
      state.showStats
    );

    if (state.showStats) {
      statsOverlay.style.display = 'block';
      const iouStr = currentMask ? currentMask.iouScore.toFixed(2) : '—';
      const totalElements = currentMask ? currentMask.elements.length : 0;
      const selectedElements = currentMask
        ? currentMask.elements.filter((el) => el.selected).length
        : 0;
      statsOverlay.innerHTML = `
        <div>MODEL: ${state.modelId.split('/').pop()} (${state.runtimeBackend.toUpperCase()})</div>
        <div>FRAME: ${state.currentFrame} | TRACKED: ${trackedCount}</div>
        <div>ELEMENTS: ${selectedElements} / ${totalElements} SELECTED | IOU: ${iouStr}</div>
        <div>PREVIEW: ${state.previewMode} | SPEED: ${state.tracking.msPerFrame} ms/f</div>
      `;
    } else {
      statsOverlay.style.display = 'none';
    }
  };

  return {
    stageElement: main,
    canvas,
    mountTimeline,
    update,
  };
}
