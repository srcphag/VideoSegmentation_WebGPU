import { ProResProfile, ProResProfileType } from 'prores-wasm-encoder';
import {
  AppState,
  MaskRefinementParams,
  PreviewMode,
  RenderOutputMode,
} from '../types/segmentationTypes';

export interface ControlPanelCallbacks {
  onTogglePropagate: () => void;
  onChangePreviewMode: (mode: PreviewMode) => void;
  onChangeRefinement: (
    key: keyof MaskRefinementParams,
    value: number
  ) => void;
  onResetRefinementKey: (key: keyof MaskRefinementParams) => void;
  onResetRefinementGroup: () => void;
  onChangeRenderOutputMode: (mode: RenderOutputMode) => void;
  onChangeAlphaProfile: (profile: ProResProfileType) => void;
  onChangeMatteProfile: (profile: ProResProfileType) => void;
  onTriggerExportMov: () => void;
  onCancelExportMov: () => void;
}

export interface ControlPanelController {
  element: HTMLElement;
  update: (state: AppState, hasAnyMask: boolean) => void;
}

export function createControlPanel(
  callbacks: ControlPanelCallbacks
): ControlPanelController {
  const aside = document.createElement('aside');
  aside.className = 'ts-panel-params';
  aside.setAttribute('data-testid', 'panel-parameters');

  aside.innerHTML = `
    <div class="ts-section-heading">
      <span class="ts-section-title">Parameters</span>
    </div>

    <!-- 1. VIDEO TRACKING CONTROLS -->
    <section class="ts-param-group" data-testid="group-tracking">
      <div class="ts-block-header">
        <span class="ts-field-label">video tracking</span>
        <span class="ts-badge is-warning" data-testid="drift-warning-badge" style="display:none;">LOW CONF</span>
      </div>

      <div class="ts-toggle-row">
        <button type="button" class="button is-primary" data-testid="propagate-btn">propagate</button>
      </div>

      <div class="ts-telemetry-box" data-testid="tracking-telemetry">
        <div class="ts-telemetry-row">
          <span class="ts-meta-pill-key">status</span>
          <span class="ts-meta-pill-val" data-testid="tracking-status-text">idle</span>
        </div>
        <div class="ts-telemetry-row">
          <span class="ts-meta-pill-key">progress</span>
          <span class="ts-meta-pill-val" data-testid="tracking-progress-text">0 / 0</span>
        </div>
        <div class="ts-telemetry-row">
          <span class="ts-meta-pill-key">speed</span>
          <span class="ts-meta-pill-val" data-testid="tracking-speed-text">0 ms/f</span>
        </div>
      </div>
    </section>

    <!-- 2. PREVIEW MODE SWITCHER -->
    <section class="ts-param-group" data-testid="group-preview-mode">
      <div class="ts-block-header">
        <span class="ts-field-label">preview mode</span>
      </div>
      <div class="ts-mode-row" data-testid="preview-mode-row">
        <button type="button" class="button is-primary" data-testid="preview-mode-overlay">overlay</button>
        <button type="button" class="button" data-testid="preview-mode-alphaCutout">cutout</button>
        <button type="button" class="button" data-testid="preview-mode-bwMatte">bw matte</button>
      </div>
    </section>

    <!-- 3. MASK EDGE REFINEMENT -->
    <section class="ts-param-group" data-testid="group-refinement">
      <div class="ts-block-header">
        <span class="ts-field-label">mask edge refinement</span>
        <button type="button" class="ts-reset-inline" data-testid="reset-group-refinement-btn" title="Reset all mask refinement sliders">rst all</button>
      </div>

      <!-- Threshold (-2.0 .. +2.0) -->
      <div class="ts-control-box">
        <div class="ts-control-split">
          <span class="ts-control-prefix">threshold</span>
          <input
            type="number"
            min="-2"
            max="2"
            step="0.05"
            class="ts-control-input"
            data-testid="param-threshold-input"
            value="0"
          />
        </div>
        <div class="ts-slider-row">
          <input
            type="range"
            min="-2"
            max="2"
            step="0.05"
            class="ts-slider"
            data-testid="param-threshold-slider"
            value="0"
          />
          <button type="button" class="ts-reset-inline" data-testid="reset-threshold-btn" title="Reset threshold">↺</button>
        </div>
      </div>

      <!-- Choke / Expand (-10px .. +10px) -->
      <div class="ts-control-box">
        <div class="ts-control-split">
          <span class="ts-control-prefix">choke/exp</span>
          <input
            type="number"
            min="-10"
            max="10"
            step="1"
            class="ts-control-input"
            data-testid="param-chokeExpand-input"
            value="0"
          />
        </div>
        <div class="ts-slider-row">
          <input
            type="range"
            min="-10"
            max="10"
            step="1"
            class="ts-slider"
            data-testid="param-chokeExpand-slider"
            value="0"
          />
          <button type="button" class="ts-reset-inline" data-testid="reset-chokeExpand-btn" title="Reset choke/expand">↺</button>
        </div>
      </div>

      <!-- Edge Feather (0px .. 20px) -->
      <div class="ts-control-box">
        <div class="ts-control-split">
          <span class="ts-control-prefix">feather</span>
          <input
            type="number"
            min="0"
            max="20"
            step="1"
            class="ts-control-input"
            data-testid="param-edgeFeather-input"
            value="1"
          />
        </div>
        <div class="ts-slider-row">
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            class="ts-slider"
            data-testid="param-edgeFeather-slider"
            value="1"
          />
          <button type="button" class="ts-reset-inline" data-testid="reset-edgeFeather-btn" title="Reset edge feather">↺</button>
        </div>
      </div>
    </section>

    <!-- 4. RENDER OUTPUT MODE & PRORES PROFILE SELECTOR -->
    <section class="ts-param-group" data-testid="group-prores-export">
      <div class="ts-block-header">
        <span class="ts-field-label">prores output</span>
      </div>

      <div class="ts-mode-row" data-testid="render-output-mode-row">
        <button type="button" class="button is-primary" data-testid="render-mode-alpha" title="ProRes 4444 with Alpha Transparency">alpha</button>
        <button type="button" class="button" data-testid="render-mode-matte" title="Black & White Luma Matte">bw matte</button>
        <button type="button" class="button" data-testid="render-mode-both" title="Export Both .mov Files">both</button>
      </div>

      <!-- Transparency ProRes Profile -->
      <div class="ts-control-split" data-testid="alpha-profile-wrapper">
        <span class="ts-control-prefix">alpha prof</span>
        <select class="ts-control-input ts-select" data-testid="alpha-profile-select">
          <option value="${ProResProfile.P4444}">prores 4444 (alpha)</option>
          <option value="${ProResProfile.P4444XQ}">prores 4444 xq (alpha)</option>
        </select>
      </div>

      <!-- B&W Matte ProRes Profile -->
      <div class="ts-control-split" data-testid="matte-profile-wrapper" style="display:none;">
        <span class="ts-control-prefix">matte prof</span>
        <select class="ts-control-input ts-select" data-testid="matte-profile-select">
          <option value="${ProResProfile.HQ}">prores 422 hq</option>
          <option value="${ProResProfile.STANDARD}">prores 422 standard</option>
          <option value="${ProResProfile.LT}">prores 422 lt</option>
          <option value="${ProResProfile.PROXY}">prores 422 proxy</option>
          <option value="${ProResProfile.P4444}">prores 4444</option>
        </select>
      </div>

      <div class="ts-toggle-row">
        <button type="button" class="button is-primary" data-testid="export-mov-btn">export .mov</button>
        <button type="button" class="button is-danger" data-testid="cancel-export-btn" style="display:none;">cancel</button>
      </div>

      <div class="progress" data-testid="export-progress-container">
        <div class="progress-bar" data-testid="export-progress-bar" style="width: 0%;"></div>
      </div>

      <div class="ts-telemetry-box" data-testid="export-telemetry">
        <div class="ts-telemetry-row">
          <span class="ts-meta-pill-key">phase</span>
          <span class="ts-meta-pill-val" data-testid="export-phase-label">ready</span>
        </div>
        <div class="ts-telemetry-row">
          <span class="ts-meta-pill-key">encoded</span>
          <span class="ts-meta-pill-val" data-testid="export-frames-label">0 / 0 (0 fps)</span>
        </div>
      </div>
    </section>
  `;

  const q = <T extends HTMLElement>(testId: string): T => {
    const el = aside.querySelector(`[data-testid="${testId}"]`);
    if (!el) throw new Error(`Missing element [data-testid="${testId}"]`);
    return el as T;
  };

  // Wire Tracking
  q<HTMLButtonElement>('propagate-btn').addEventListener('click', () => {
    callbacks.onTogglePropagate();
  });

  // Wire Preview Mode
  const previewModes: PreviewMode[] = ['overlay', 'alphaCutout', 'bwMatte'];
  for (const mode of previewModes) {
    q<HTMLButtonElement>(`preview-mode-${mode}`).addEventListener('click', () => {
      callbacks.onChangePreviewMode(mode);
    });
  }

  // Wire Refinement sliders + inputs
  const bindRefinementControl = (key: keyof MaskRefinementParams) => {
    const inputEl = q<HTMLInputElement>(`param-${key}-input`);
    const sliderEl = q<HTMLInputElement>(`param-${key}-slider`);
    const resetBtn = q<HTMLButtonElement>(`reset-${key}-btn`);

    sliderEl.addEventListener('input', () => {
      callbacks.onChangeRefinement(key, parseFloat(sliderEl.value));
    });
    inputEl.addEventListener('input', () => {
      const v = parseFloat(inputEl.value);
      if (!Number.isNaN(v)) {
        callbacks.onChangeRefinement(key, v);
      }
    });
    inputEl.addEventListener('change', () => {
      const v = parseFloat(inputEl.value);
      if (!Number.isNaN(v)) {
        callbacks.onChangeRefinement(key, v);
      }
    });
    resetBtn.addEventListener('click', () => {
      callbacks.onResetRefinementKey(key);
    });
  };

  bindRefinementControl('threshold');
  bindRefinementControl('chokeExpand');
  bindRefinementControl('edgeFeather');

  q<HTMLButtonElement>('reset-group-refinement-btn').addEventListener(
    'click',
    () => {
      callbacks.onResetRefinementGroup();
    }
  );

  // Wire Render Output Mode & Profiles
  const renderModes: RenderOutputMode[] = ['alpha', 'matte', 'both'];
  for (const mode of renderModes) {
    q<HTMLButtonElement>(`render-mode-${mode}`).addEventListener('click', () => {
      callbacks.onChangeRenderOutputMode(mode);
    });
  }

  const alphaSelect = q<HTMLSelectElement>('alpha-profile-select');
  const matteSelect = q<HTMLSelectElement>('matte-profile-select');

  alphaSelect.addEventListener('change', () => {
    callbacks.onChangeAlphaProfile(Number(alphaSelect.value) as ProResProfileType);
  });
  matteSelect.addEventListener('change', () => {
    callbacks.onChangeMatteProfile(Number(matteSelect.value) as ProResProfileType);
  });

  q<HTMLButtonElement>('export-mov-btn').addEventListener('click', () => {
    callbacks.onTriggerExportMov();
  });
  q<HTMLButtonElement>('cancel-export-btn').addEventListener('click', () => {
    callbacks.onCancelExportMov();
  });

  const update = (state: AppState, hasAnyMask: boolean): void => {
    // 1. Tracking
    const propBtn = q<HTMLButtonElement>('propagate-btn');
    propBtn.disabled = !state.video || state.exportStatus.isExporting;
    propBtn.textContent = state.tracking.isTracking
      ? 'stop propagate'
      : 'propagate';
    propBtn.classList.toggle('is-danger', state.tracking.isTracking);
    propBtn.classList.toggle('is-primary', !state.tracking.isTracking);

    q<HTMLSpanElement>('drift-warning-badge').style.display = state.tracking
      .lowConfidenceWarning
      ? 'inline-flex'
      : 'none';
    q<HTMLSpanElement>('tracking-status-text').textContent =
      state.tracking.statusText;
    q<HTMLSpanElement>('tracking-progress-text').textContent =
      `${state.tracking.currentFrame} / ${state.tracking.targetEndFrame}`;
    q<HTMLSpanElement>('tracking-speed-text').textContent =
      `${state.tracking.msPerFrame} ms/f`;

    // 2. Preview Mode
    for (const mode of previewModes) {
      q<HTMLButtonElement>(`preview-mode-${mode}`).classList.toggle(
        'is-primary',
        state.previewMode === mode
      );
    }

    // 3. Refinement values
    const syncParam = (key: keyof MaskRefinementParams, val: number) => {
      const inp = q<HTMLInputElement>(`param-${key}-input`);
      const sld = q<HTMLInputElement>(`param-${key}-slider`);
      if (document.activeElement !== inp) {
        inp.value = String(Number(val.toFixed(2)));
      }
      sld.value = String(val);
    };
    syncParam('threshold', state.refinement.threshold);
    syncParam('chokeExpand', state.refinement.chokeExpand);
    syncParam('edgeFeather', state.refinement.edgeFeather);

    // 4. ProRes Output
    for (const mode of renderModes) {
      q<HTMLButtonElement>(`render-mode-${mode}`).classList.toggle(
        'is-primary',
        state.renderOutputMode === mode
      );
    }

    const showAlphaProf =
      state.renderOutputMode === 'alpha' || state.renderOutputMode === 'both';
    const showMatteProf =
      state.renderOutputMode === 'matte' || state.renderOutputMode === 'both';
    q<HTMLDivElement>('alpha-profile-wrapper').style.display = showAlphaProf
      ? 'flex'
      : 'none';
    q<HTMLDivElement>('matte-profile-wrapper').style.display = showMatteProf
      ? 'flex'
      : 'none';

    alphaSelect.value = String(state.alphaProfile);
    matteSelect.value = String(state.matteProfile);

    const exportBtn = q<HTMLButtonElement>('export-mov-btn');
    const cancelBtn = q<HTMLButtonElement>('cancel-export-btn');
    exportBtn.disabled =
      !state.video ||
      state.exportStatus.isExporting ||
      state.tracking.isTracking;
    exportBtn.textContent = state.exportStatus.isExporting
      ? 'encoding...'
      : 'export .mov';
    cancelBtn.style.display = state.exportStatus.isExporting
      ? 'inline-flex'
      : 'none';

    const pct =
      state.exportStatus.totalFrames > 0
        ? Math.round(
            (state.exportStatus.currentFrame / state.exportStatus.totalFrames) *
              100
          )
        : 0;
    q<HTMLDivElement>('export-progress-bar').style.width = `${pct}%`;
    q<HTMLSpanElement>('export-phase-label').textContent =
      state.exportStatus.phaseLabel;
    q<HTMLSpanElement>('export-frames-label').textContent =
      `${state.exportStatus.currentFrame} / ${state.exportStatus.totalFrames} (${state.exportStatus.fps} fps)`;
  };

  return {
    element: aside,
    update,
  };
}
