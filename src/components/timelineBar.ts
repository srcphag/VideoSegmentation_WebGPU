import { AppState, FrameMaskEntry } from '../types/segmentationTypes';

function formatTimecode(frameIndex: number, fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return '00:00';
  const totalSeconds = Math.max(0, Math.floor(frameIndex / fps));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface TimelineBarCallbacks {
  onTogglePlay: () => void;
  onSeekFrame: (frameIndex: number) => void;
  onStepFrame: (delta: number) => void;
  onJumpKeyframe: (direction: -1 | 1) => void;
  onChangeInOut: (inFrame: number, outFrame: number) => void;
}

export interface TimelineBarController {
  element: HTMLElement;
  update: (
    state: AppState,
    masks: ReadonlyMap<number, FrameMaskEntry>
  ) => void;
}

export function createTimelineBar(
  callbacks: TimelineBarCallbacks
): TimelineBarController {
  const footer = document.createElement('footer');
  footer.className = 'ts-playback';
  footer.setAttribute('data-testid', 'timeline-bar');

  footer.innerHTML = `
    <div class="ts-transport-row">
      <div class="ts-transport-left">
        <button type="button" class="ts-media-btn" data-testid="prev-keyframe-btn" title="Jump to previous keyframe">|&lt;</button>
        <button type="button" class="ts-media-btn" data-testid="step-back-btn" title="Step -1 frame">&lt;</button>
        <button type="button" class="ts-media-btn" data-testid="play-pause-btn" title="Play / Pause">▶</button>
        <button type="button" class="ts-media-btn" data-testid="step-fwd-btn" title="Step +1 frame">&gt;</button>
        <button type="button" class="ts-media-btn" data-testid="next-keyframe-btn" title="Jump to next keyframe">&gt;|</button>
      </div>

      <div class="ts-transport-center">
        <button type="button" class="ts-media-btn" data-testid="set-in-btn" title="Set In point to current frame">[ in</button>
        <div class="ts-control-split" style="width: 74px; height: 26px;">
          <span class="ts-control-prefix" style="padding:0 4px; font-size:10px;">in</span>
          <input type="number" min="0" step="1" class="ts-control-input" style="font-size:11px;" data-testid="in-frame-input" value="0" />
        </div>
        <div class="ts-control-split" style="width: 78px; height: 26px;">
          <span class="ts-control-prefix" style="padding:0 4px; font-size:10px;">out</span>
          <input type="number" min="0" step="1" class="ts-control-input" style="font-size:11px;" data-testid="out-frame-input" value="0" />
        </div>
        <button type="button" class="ts-media-btn" data-testid="set-out-btn" title="Set Out point to current frame">out ]</button>
      </div>

      <div class="ts-time-display">
        <span class="ts-time-current" data-testid="frame-counter-label">frame 0000</span>
        <span data-testid="timecode-label">00:00 / 00:00</span>
      </div>
    </div>

    <div class="ts-timeline-tracks" data-testid="timeline-scrubber-track" title="Click or drag to scrub frames">
      <canvas class="ts-timeline-keyframes-canvas" data-testid="timeline-status-canvas"></canvas>
      <div class="ts-timeline-progress-track">
        <div class="ts-timeline-range-fill" data-testid="timeline-range-fill"></div>
        <div class="ts-timeline-progress-fill" data-testid="timeline-progress-fill"></div>
        <div class="ts-timeline-playhead" data-testid="timeline-playhead" style="left: 0%;"></div>
      </div>
    </div>
  `;

  const q = <T extends HTMLElement>(testId: string): T => {
    const el = footer.querySelector(`[data-testid="${testId}"]`);
    if (!el) throw new Error(`Missing element [data-testid="${testId}"]`);
    return el as T;
  };

  const tracksWrapper = q<HTMLDivElement>('timeline-scrubber-track');
  const rangeFill = q<HTMLDivElement>('timeline-range-fill');
  const progressFill = q<HTMLDivElement>('timeline-progress-fill');
  const keyframesCanvas = q<HTMLCanvasElement>('timeline-status-canvas');
  const playhead = q<HTMLDivElement>('timeline-playhead');
  const inInput = q<HTMLInputElement>('in-frame-input');
  const outInput = q<HTMLInputElement>('out-frame-input');

  let currentTotalFrames = 0;
  let currentInFrame = 0;
  let currentOutFrame = 0;
  let activeFrame = 0;
  let isDraggingScrubber = false;

  const seekFromClientX = (clientX: number) => {
    if (currentTotalFrames <= 0) return;
    const rect = tracksWrapper.getBoundingClientRect();
    if (rect.width <= 0) return;
    const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetFrame = Math.round(norm * (currentTotalFrames - 1));
    callbacks.onSeekFrame(targetFrame);
  };

  tracksWrapper.addEventListener('pointerdown', (e) => {
    if (currentTotalFrames <= 0) return;
    isDraggingScrubber = true;
    tracksWrapper.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  });
  tracksWrapper.addEventListener('pointermove', (e) => {
    if (!isDraggingScrubber) return;
    seekFromClientX(e.clientX);
  });
  tracksWrapper.addEventListener('pointerup', () => {
    isDraggingScrubber = false;
  });

  q<HTMLButtonElement>('play-pause-btn').addEventListener('click', () => {
    callbacks.onTogglePlay();
  });
  q<HTMLButtonElement>('step-back-btn').addEventListener('click', () => {
    callbacks.onStepFrame(-1);
  });
  q<HTMLButtonElement>('step-fwd-btn').addEventListener('click', () => {
    callbacks.onStepFrame(1);
  });
  q<HTMLButtonElement>('prev-keyframe-btn').addEventListener('click', () => {
    callbacks.onJumpKeyframe(-1);
  });
  q<HTMLButtonElement>('next-keyframe-btn').addEventListener('click', () => {
    callbacks.onJumpKeyframe(1);
  });

  q<HTMLButtonElement>('set-in-btn').addEventListener('click', () => {
    callbacks.onChangeInOut(activeFrame, Math.max(activeFrame, currentOutFrame));
  });
  q<HTMLButtonElement>('set-out-btn').addEventListener('click', () => {
    callbacks.onChangeInOut(Math.min(currentInFrame, activeFrame), activeFrame);
  });

  inInput.addEventListener('change', () => {
    const v = parseInt(inInput.value, 10);
    if (!Number.isNaN(v)) {
      callbacks.onChangeInOut(v, currentOutFrame);
    }
  });
  outInput.addEventListener('change', () => {
    const v = parseInt(outInput.value, 10);
    if (!Number.isNaN(v)) {
      callbacks.onChangeInOut(currentInFrame, v);
    }
  });

  /**
   * Top track: one thin dash per frame — cyan = tracked, red = low confidence,
   * dim gray = untracked, white = current frame, diamonds = keyframes.
   */
  const drawKeyframeTrack = (
    totalFrames: number,
    masks: ReadonlyMap<number, FrameMaskEntry>,
    currentFrame: number
  ) => {
    const ctx = keyframesCanvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(60, tracksWrapper.clientWidth);
    const cssH = 10;
    if (
      keyframesCanvas.width !== Math.round(cssW * dpr) ||
      keyframesCanvas.height !== Math.round(cssH * dpr)
    ) {
      keyframesCanvas.width = Math.round(cssW * dpr);
      keyframesCanvas.height = Math.round(cssH * dpr);
    }

    const w = keyframesCanvas.width;
    const h = keyframesCanvas.height;
    ctx.clearRect(0, 0, w, h);
    if (totalFrames <= 0) return;

    const dashW = Math.max(2 * dpr, Math.floor((w / totalFrames) * 0.62));

    for (let f = 0; f < totalFrames; f++) {
      const x = (f / Math.max(1, totalFrames - 1)) * (w - dashW);
      const entry = masks.get(f);

      if (f === currentFrame) {
        ctx.fillStyle = '#ffffff';
      } else if (entry) {
        ctx.fillStyle = entry.lowConfidence
          ? 'rgba(255, 85, 85, 0.85)'
          : 'rgba(139, 233, 253, 0.75)';
      } else {
        ctx.fillStyle = 'rgba(204, 204, 204, 0.13)';
      }
      ctx.fillRect(x, 0, dashW, h);

      if (entry?.isKeyframe) {
        const cx = x + dashW / 2;
        const r = Math.min(3 * dpr, h / 2 - 1);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx, h / 2 - r);
        ctx.lineTo(cx + r, h / 2);
        ctx.lineTo(cx, h / 2 + r);
        ctx.lineTo(cx - r, h / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  const update = (
    state: AppState,
    masks: ReadonlyMap<number, FrameMaskEntry>
  ): void => {
    const hasVideo = Boolean(state.video);
    const total = state.video?.totalFrames ?? 0;
    const fps = state.video?.fps ?? 30;

    currentTotalFrames = total;
    currentInFrame = state.inFrame;
    currentOutFrame = state.outFrame;
    activeFrame = state.currentFrame;

    const btns = [
      'prev-keyframe-btn',
      'step-back-btn',
      'play-pause-btn',
      'step-fwd-btn',
      'next-keyframe-btn',
      'set-in-btn',
      'set-out-btn',
    ];
    for (const id of btns) {
      q<HTMLButtonElement>(id).disabled = !hasVideo;
    }
    inInput.disabled = !hasVideo;
    outInput.disabled = !hasVideo;

    q<HTMLButtonElement>('play-pause-btn').textContent = state.isPlaying
      ? '❚❚'
      : '▶';

    if (document.activeElement !== inInput) {
      inInput.value = String(state.inFrame);
    }
    if (document.activeElement !== outInput) {
      outInput.value = String(state.outFrame);
    }

    q<HTMLSpanElement>('frame-counter-label').textContent =
      `frame ${state.currentFrame}`;
    q<HTMLSpanElement>('timecode-label').textContent =
      `${formatTimecode(state.currentFrame, fps)} / ${formatTimecode(
        Math.max(0, total - 1),
        fps
      )}`;

    if (total > 1) {
      const playheadPct = (state.currentFrame / (total - 1)) * 100;
      playhead.style.left = `${playheadPct}%`;
      progressFill.style.width = `${playheadPct}%`;

      const inPct = (state.inFrame / (total - 1)) * 100;
      const outPct = (state.outFrame / (total - 1)) * 100;
      rangeFill.style.left = `${inPct}%`;
      rangeFill.style.width = `${Math.max(0, outPct - inPct)}%`;
    } else {
      playhead.style.left = '0%';
      progressFill.style.width = '0%';
      rangeFill.style.left = '0%';
      rangeFill.style.width = '100%';
    }

    drawKeyframeTrack(total, masks, state.currentFrame);
  };

  return {
    element: footer,
    update,
  };
}
