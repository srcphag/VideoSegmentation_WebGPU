import {
  AppState,
  AutoDetectParams,
  DEFAULT_AUTO_DETECT,
  DetectedElement,
  SamModelId,
} from '../types/segmentationTypes';

const MEDIA_GLYPH_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <rect x="3" y="4" width="18" height="16" />
  <circle cx="8.5" cy="9.5" r="1.5" />
  <path d="M21 15l-5-5L5 20" />
</svg>`;

export interface TopBarCallbacks {
  onSelectVideoFile: (file: File) => void;
  onLoadDemoClip: () => void;
  onSelectModel: (modelId: SamModelId) => void;
  onChangeAutoDetect: (key: keyof AutoDetectParams, value: number) => void;
  onResetAutoDetect: () => void;
  onAutoDetectCurrentFrame: () => void;
  onClearCurrentFrameMask: () => void;
  onToggleElement: (elementId: string) => void;
  onHoverElement: (elementId: string | null) => void;
  onSelectAllElements: (selected: boolean) => void;
}

export interface TopBarController {
  element: HTMLElement;
  openFilePicker: () => void;
  update: (state: AppState, currentElements: DetectedElement[]) => void;
}

export function createTopBar(callbacks: TopBarCallbacks): TopBarController {
  const aside = document.createElement('aside');
  aside.className = 'ts-panel-inputs';
  aside.setAttribute('data-testid', 'panel-inputs');

  aside.innerHTML = `
    <input type="file" accept="video/*,.mp4,.webm,.mov" style="display:none" data-testid="video-file-input" />

    <div class="ts-section-heading">
      <span class="ts-section-title">Inputs</span>
      <span class="ts-badge is-webgpu" data-testid="runtime-badge">WEBGPU</span>
    </div>

    <!-- 1. VIDEO LOADER -->
    <section class="ts-source-block" data-testid="video-loader-group">
      <div class="ts-block-header">
        <span class="ts-field-label">video input</span>
        <span class="ts-field-count" data-testid="video-fps-badge">no file</span>
      </div>
      <div class="ts-source-grid">
        <div class="ts-source-buttons">
          <button type="button" class="button" data-testid="load-video-btn">load video</button>
          <button type="button" class="button" data-testid="load-demo-btn">demo clip</button>
        </div>
        <div class="ts-source-preview" data-testid="video-thumbnail-box" title="Click to load video file">
          <div class="ts-empty-glyph">${MEDIA_GLYPH_SVG}</div>
          <span class="ts-empty-label">add video</span>
        </div>
      </div>
      <div class="ts-meta-pill" data-testid="video-metadata-pill">
        <div class="ts-meta-pill-row">
          <span class="ts-meta-pill-key">file</span>
          <span class="ts-meta-pill-val" data-testid="meta-filename">none</span>
        </div>
        <div class="ts-meta-pill-row">
          <span class="ts-meta-pill-key">resolution</span>
          <span class="ts-meta-pill-val" data-testid="meta-resolution">—</span>
        </div>
        <div class="ts-meta-pill-row">
          <span class="ts-meta-pill-key">frames</span>
          <span class="ts-meta-pill-val" data-testid="meta-frames">0 @ 0 fps</span>
        </div>
      </div>
    </section>

    <!-- 2. MODEL SELECTOR & RUNTIME STATUS -->
    <section class="ts-source-block" data-testid="model-selector-group">
      <div class="ts-block-header">
        <span class="ts-field-label">ai model</span>
        <span class="ts-section-meta" data-testid="model-status-label">standby</span>
      </div>
      <div class="ts-control-split">
        <span class="ts-control-prefix">model</span>
        <select class="ts-control-input ts-select" data-testid="model-select">
          <option value="onnx-community/EdgeTAM-ONNX">edgetam (mobile sam2)</option>
          <option value="onnx-community/sam2.1-hiera-tiny-ONNX">sam 2.1 tiny</option>
          <option value="Xenova/slimsam-77-uniform">slimsam 77 uniform</option>
          <option value="onnx-community/sam2.1-hiera-small-ONNX">sam 2.1 small (precise)</option>
          <option value="onnx-community/sam2.1-hiera-base-plus-ONNX">sam 2.1 base+ (high precision)</option>
        </select>
      </div>
      <div class="progress" data-testid="model-progress-container">
        <div class="progress-bar" data-testid="model-progress-bar" style="width: 0%;"></div>
      </div>
    </section>

    <!-- 3. AUTO-DETECT SCANNER (OPTION A: UNIFORM GRID + NMS) -->
    <section class="ts-source-block" data-testid="auto-detect-group">
      <div class="ts-block-header">
        <span class="ts-field-label">auto-detect grid</span>
        <button type="button" class="ts-reset-inline" data-testid="reset-auto-detect-btn" title="Reset grid detection settings">rst all</button>
      </div>

      <!-- Grid Density (4..10 pts/side) -->
      <div class="ts-control-box">
        <div class="ts-control-split">
          <span class="ts-control-prefix">grid pts</span>
          <input
            type="number"
            min="4"
            max="10"
            step="1"
            class="ts-control-input"
            data-testid="param-gridDensity-input"
            value="6"
          />
        </div>
        <div class="ts-slider-row">
          <input
            type="range"
            min="4"
            max="10"
            step="1"
            class="ts-slider"
            data-testid="param-gridDensity-slider"
            value="6"
          />
          <button type="button" class="ts-reset-inline" data-testid="reset-gridDensity-btn" title="Reset grid density">↺</button>
        </div>
      </div>

      <!-- IoU Threshold (0.50..0.95) -->
      <div class="ts-control-box">
        <div class="ts-control-split">
          <span class="ts-control-prefix">iou thresh</span>
          <input
            type="number"
            min="0.5"
            max="0.95"
            step="0.02"
            class="ts-control-input"
            data-testid="param-iouThreshold-input"
            value="0.72"
          />
        </div>
        <div class="ts-slider-row">
          <input
            type="range"
            min="0.5"
            max="0.95"
            step="0.02"
            class="ts-slider"
            data-testid="param-iouThreshold-slider"
            value="0.72"
          />
          <button type="button" class="ts-reset-inline" data-testid="reset-iouThreshold-btn" title="Reset IoU threshold">↺</button>
        </div>
      </div>

      <!-- Min Area % (0.5..10.0) -->
      <div class="ts-control-box">
        <div class="ts-control-split">
          <span class="ts-control-prefix">min area %</span>
          <input
            type="number"
            min="0.5"
            max="10"
            step="0.5"
            class="ts-control-input"
            data-testid="param-minAreaPercent-input"
            value="1"
          />
        </div>
        <div class="ts-slider-row">
          <input
            type="range"
            min="0.5"
            max="10"
            step="0.5"
            class="ts-slider"
            data-testid="param-minAreaPercent-slider"
            value="1"
          />
          <button type="button" class="ts-reset-inline" data-testid="reset-minAreaPercent-btn" title="Reset min area %">↺</button>
        </div>
      </div>

      <div class="ts-toggle-row">
        <button type="button" class="button is-primary" data-testid="auto-detect-btn">auto-detect</button>
        <button type="button" class="button" data-testid="clear-frame-mask-btn">clear</button>
      </div>
    </section>

    <!-- 4. DETECTED ELEMENTS SELECTION LIST -->
    <section class="ts-source-block" data-testid="detected-elements-group" style="flex:1; min-height:0;">
      <div class="ts-block-header">
        <span class="ts-field-label">detected elements</span>
        <div class="ts-header-actions">
          <span class="ts-field-count" data-testid="elements-count-badge">0 / 0</span>
          <button type="button" class="ts-reset-inline" data-testid="select-all-elements-btn" title="Select all detected elements">all</button>
          <button type="button" class="ts-reset-inline" data-testid="select-none-elements-btn" title="Deselect all elements">none</button>
        </div>
      </div>
      <div class="ts-element-list" data-testid="detected-elements-list">
        <div class="ts-element-empty">click "auto-detect" to scan frame for elements</div>
      </div>
    </section>
  `;

  const q = <T extends HTMLElement>(testId: string): T => {
    const el = aside.querySelector(`[data-testid="${testId}"]`);
    if (!el) throw new Error(`Missing element [data-testid="${testId}"]`);
    return el as T;
  };

  const fileInput = q<HTMLInputElement>('video-file-input');
  const loadVideoBtn = q<HTMLButtonElement>('load-video-btn');
  const loadDemoBtn = q<HTMLButtonElement>('load-demo-btn');
  const thumbBox = q<HTMLDivElement>('video-thumbnail-box');
  const modelSelect = q<HTMLSelectElement>('model-select');
  const detectBtn = q<HTMLButtonElement>('auto-detect-btn');
  const clearBtn = q<HTMLButtonElement>('clear-frame-mask-btn');
  const elementsListEl = q<HTMLDivElement>('detected-elements-list');

  const triggerFilePicker = () => {
    fileInput.click();
  };

  loadVideoBtn.addEventListener('click', triggerFilePicker);
  thumbBox.addEventListener('click', triggerFilePicker);
  loadDemoBtn.addEventListener('click', () => {
    callbacks.onLoadDemoClip();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) {
      callbacks.onSelectVideoFile(file);
    }
  });

  modelSelect.addEventListener('change', () => {
    callbacks.onSelectModel(modelSelect.value as SamModelId);
  });

  const bindAutoDetectSlider = (key: keyof AutoDetectParams) => {
    const inp = q<HTMLInputElement>(`param-${key}-input`);
    const sld = q<HTMLInputElement>(`param-${key}-slider`);
    const rst = q<HTMLButtonElement>(`reset-${key}-btn`);

    sld.addEventListener('input', () => {
      callbacks.onChangeAutoDetect(key, parseFloat(sld.value));
    });
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (!Number.isNaN(v)) {
        callbacks.onChangeAutoDetect(key, v);
      }
    });
    rst.addEventListener('click', () => {
      callbacks.onChangeAutoDetect(key, DEFAULT_AUTO_DETECT[key]);
    });
  };

  bindAutoDetectSlider('gridDensity');
  bindAutoDetectSlider('iouThreshold');
  bindAutoDetectSlider('minAreaPercent');

  q<HTMLButtonElement>('reset-auto-detect-btn').addEventListener('click', () => {
    callbacks.onResetAutoDetect();
  });

  detectBtn.addEventListener('click', () => {
    callbacks.onAutoDetectCurrentFrame();
  });
  clearBtn.addEventListener('click', () => {
    callbacks.onClearCurrentFrameMask();
  });

  q<HTMLButtonElement>('select-all-elements-btn').addEventListener('click', () => {
    callbacks.onSelectAllElements(true);
  });
  q<HTMLButtonElement>('select-none-elements-btn').addEventListener('click', () => {
    callbacks.onSelectAllElements(false);
  });

  let lastThumbSig = '';
  let lastElementsSig = '';

  const update = (state: AppState, currentElements: DetectedElement[]): void => {
    // Runtime badge
    const badge = q<HTMLSpanElement>('runtime-badge');
    badge.textContent = state.runtimeBackend.toUpperCase();
    badge.className = `ts-badge ${
      state.runtimeBackend === 'webgpu' ? 'is-webgpu' : 'is-wasm'
    }`;

    // Video metadata
    if (state.video) {
      q<HTMLSpanElement>('video-fps-badge').textContent = `${state.video.fps} fps`;
      q<HTMLSpanElement>('meta-filename').textContent = state.video.filename;
      q<HTMLSpanElement>('meta-resolution').textContent =
        `${state.video.width} × ${state.video.height}`;
      q<HTMLSpanElement>('meta-frames').textContent =
        `${state.video.totalFrames} @ ${state.video.fps} fps`;
      loadVideoBtn.classList.add('is-primary');

      const sig = `${state.video.filename}:${state.video.thumbnailUrl}`;
      if (sig !== lastThumbSig) {
        lastThumbSig = sig;
        thumbBox.classList.add('is-loaded');
        thumbBox.innerHTML = `
          <img src="${state.video.thumbnailUrl}" alt="${state.video.filename}" data-testid="video-thumbnail-img" />
          <span class="ts-preview-badge">${state.video.filename}</span>
        `;
      }
    } else {
      q<HTMLSpanElement>('video-fps-badge').textContent = 'no file';
      q<HTMLSpanElement>('meta-filename').textContent = 'none';
      q<HTMLSpanElement>('meta-resolution').textContent = '—';
      q<HTMLSpanElement>('meta-frames').textContent = '0 @ 0 fps';
      loadVideoBtn.classList.remove('is-primary');

      if (lastThumbSig !== '') {
        lastThumbSig = '';
        thumbBox.classList.remove('is-loaded');
        thumbBox.innerHTML = `
          <div class="ts-empty-glyph">${MEDIA_GLYPH_SVG}</div>
          <span class="ts-empty-label">add video</span>
        `;
      }
    }

    // Model selector & progress
    if (modelSelect.value !== state.modelId) {
      modelSelect.value = state.modelId;
    }
    q<HTMLSpanElement>('model-status-label').textContent = state.modelStatusText;
    q<HTMLDivElement>('model-progress-bar').style.width =
      `${Math.max(0, Math.min(100, state.modelLoadingProgress))}%`;

    // Auto-detect sliders
    const syncAutoParam = (key: keyof AutoDetectParams, val: number) => {
      const inp = q<HTMLInputElement>(`param-${key}-input`);
      const sld = q<HTMLInputElement>(`param-${key}-slider`);
      if (document.activeElement !== inp) {
        inp.value = String(Number(val.toFixed(2)));
      }
      sld.value = String(val);
    };
    syncAutoParam('gridDensity', state.autoDetect.gridDensity);
    syncAutoParam('iouThreshold', state.autoDetect.iouThreshold);
    syncAutoParam('minAreaPercent', state.autoDetect.minAreaPercent);

    detectBtn.disabled =
      !state.video || state.isDetectingFrame || state.tracking.isTracking;
    detectBtn.textContent = state.isDetectingFrame
      ? 'scanning...'
      : 'auto-detect';
    clearBtn.disabled =
      !state.video || state.isDetectingFrame || state.tracking.isTracking;

    // Detected Elements List
    const selectedCount = currentElements.filter((el) => el.selected).length;
    q<HTMLSpanElement>('elements-count-badge').textContent =
      `${selectedCount} / ${currentElements.length}`;

    const elSig =
      `${state.currentFrame}:${state.hoveredElementId ?? ''}:` +
      currentElements
        .map((e) => `${e.id}:${e.selected ? 1 : 0}:${e.iouScore.toFixed(2)}`)
        .join('|');

    if (elSig !== lastElementsSig) {
      lastElementsSig = elSig;
      if (currentElements.length === 0) {
        elementsListEl.innerHTML = `
          <div class="ts-element-empty" data-testid="elements-empty-label">
            click "auto-detect" to scan frame for elements
          </div>
        `;
      } else {
        elementsListEl.innerHTML = '';
        for (const el of currentElements) {
          const row = document.createElement('div');
          row.className = `ts-element-row ${el.selected ? 'is-selected' : ''} ${
            el.id === state.hoveredElementId ? 'is-hovered' : ''
          }`;
          row.setAttribute('data-testid', `element-row-${el.id}`);
          const areaPct = (el.areaFraction * 100).toFixed(1);
          const iouPct = Math.round(el.iouScore * 100);
          row.innerHTML = `
            <div class="ts-element-left">
              <span class="ts-element-swatch" style="background:${el.colorHex};"></span>
              <span class="ts-element-name">${el.selected ? '✓ ' : ''}${el.label}</span>
            </div>
            <span class="ts-element-meta">${iouPct}% iou · ${areaPct}%</span>
          `;
          row.addEventListener('click', () => {
            callbacks.onToggleElement(el.id);
          });
          row.addEventListener('pointerenter', () => {
            callbacks.onHoverElement(el.id);
          });
          row.addEventListener('pointerleave', () => {
            callbacks.onHoverElement(null);
          });
          elementsListEl.appendChild(row);
        }
      }
    }
  };

  return {
    element: aside,
    openFilePicker: triggerFilePicker,
    update,
  };
}
