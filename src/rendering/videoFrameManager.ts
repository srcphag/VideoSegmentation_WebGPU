import { VideoMetadata } from '../types/segmentationTypes';

export class VideoFrameManager {
  private videoEl: HTMLVideoElement;
  private workCanvas: HTMLCanvasElement;
  private workCtx: CanvasRenderingContext2D;
  private objectUrl: string | null = null;
  private metadata: VideoMetadata | null = null;
  private frameCache = new Map<number, Uint8ClampedArray>();
  private readonly maxCacheFrames = 64;
  private seekQueue: Promise<void> = Promise.resolve();
  private isSeekingVideo = false;
  private latestScrubRequest: {
    frameIndex: number;
    resolve: (rgba: Uint8ClampedArray | null) => void;
    reject: (err: Error) => void;
  } | null = null;

  // Synthetic fallback frames for headless testing or synthetic clips
  private syntheticFrames: Uint8ClampedArray[] | null = null;

  constructor() {
    this.videoEl = document.createElement('video');
    this.videoEl.muted = true;
    this.videoEl.playsInline = true;
    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.preload = 'auto';

    this.workCanvas = document.createElement('canvas');
    const ctx = this.workCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to create 2D context for VideoFrameManager');
    }
    this.workCtx = ctx;
  }

  public getMetadata(): VideoMetadata | null {
    return this.metadata;
  }

  public async loadVideoFile(file: File): Promise<VideoMetadata> {
    this.disposeCurrent();

    const url = URL.createObjectURL(file);
    this.objectUrl = url;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Unable to decode video file "${file.name}".`));
      };
      const cleanup = () => {
        this.videoEl.removeEventListener('loadeddata', onLoaded);
        this.videoEl.removeEventListener('error', onError);
      };
      this.videoEl.addEventListener('loadeddata', onLoaded);
      this.videoEl.addEventListener('error', onError);
      this.videoEl.src = url;
      this.videoEl.load();
    });

    const width = this.videoEl.videoWidth || 640;
    const height = this.videoEl.videoHeight || 360;
    const duration =
      Number.isFinite(this.videoEl.duration) && this.videoEl.duration > 0
        ? this.videoEl.duration
        : 1.0;
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(duration * fps));

    this.workCanvas.width = width;
    this.workCanvas.height = height;

    const firstFrame = await this.extractFrameInternal(0, width, height, fps);
    this.cacheFrame(0, firstFrame);
    const thumbnailUrl = this.createSquareThumbnail(width, height);

    this.metadata = {
      filename: file.name,
      width,
      height,
      fps,
      duration,
      totalFrames,
      thumbnailUrl,
    };

    return this.metadata;
  }

  /**
   * Loads a procedural synthetic video clip with 3 distinct moving elements
   * (circle, square, diamond) for testing multi-element auto-detection & selection.
   */
  public loadSyntheticVideo(
    width = 320,
    height = 180,
    fps = 24,
    totalFrames = 16,
    filename = 'demoElements.mp4'
  ): VideoMetadata {
    this.disposeCurrent();
    this.workCanvas.width = width;
    this.workCanvas.height = height;

    this.syntheticFrames = [];
    for (let f = 0; f < totalFrames; f++) {
      const buf = new Uint8ClampedArray(width * height * 4);
      const progress = f / Math.max(1, totalFrames - 1);

      // Element 1: Orange Circle moving right
      const c1x = Math.round(width * (0.22 + 0.16 * progress));
      const c1y = Math.round(height * 0.45);
      const r1 = Math.round(Math.min(width, height) * 0.18);

      // Element 2: Green Square moving slightly up/down
      const s2x = Math.round(width * 0.68);
      const s2y = Math.round(height * (0.35 + 0.2 * progress));
      const halfS2 = Math.round(Math.min(width, height) * 0.15);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4;
          const dx1 = x - c1x;
          const dy1 = y - c1y;
          const inCircle = dx1 * dx1 + dy1 * dy1 <= r1 * r1;
          const inSquare =
            Math.abs(x - s2x) <= halfS2 && Math.abs(y - s2y) <= halfS2;

          if (inCircle) {
            buf[p] = 240;
            buf[p + 1] = 95;
            buf[p + 2] = 60;
            buf[p + 3] = 255;
          } else if (inSquare) {
            buf[p] = 65;
            buf[p + 1] = 215;
            buf[p + 2] = 115;
            buf[p + 3] = 255;
          } else {
            buf[p] = 20;
            buf[p + 1] = 26;
            buf[p + 2] = 38;
            buf[p + 3] = 255;
          }
        }
      }
      this.syntheticFrames.push(buf);
    }

    const first = this.syntheticFrames[0];
    const imgData = new ImageData(new Uint8ClampedArray(first), width, height);
    this.workCtx.putImageData(imgData, 0, 0);
    const thumbnailUrl = this.createSquareThumbnail(width, height);

    this.metadata = {
      filename,
      width,
      height,
      fps,
      duration: totalFrames / fps,
      totalFrames,
      thumbnailUrl,
    };

    return this.metadata;
  }

  public async getFrameRgba(frameIndex: number): Promise<Uint8ClampedArray> {
    if (!this.metadata) {
      throw new Error('No video loaded.');
    }

    const clampedIndex = Math.max(
      0,
      Math.min(this.metadata.totalFrames - 1, Math.round(frameIndex))
    );

    if (this.syntheticFrames) {
      return new Uint8ClampedArray(this.syntheticFrames[clampedIndex]);
    }

    const cached = this.frameCache.get(clampedIndex);
    if (cached) {
      return new Uint8ClampedArray(cached);
    }

    const { width, height, fps } = this.metadata;
    let extracted!: Uint8ClampedArray;

    this.seekQueue = this.seekQueue.then(async () => {
      extracted = await this.extractFrameInternal(
        clampedIndex,
        width,
        height,
        fps
      );
      this.cacheFrame(clampedIndex, extracted);
    });

    await this.seekQueue;
    return new Uint8ClampedArray(extracted);
  }

  /**
   * Latest-only non-queuing frame extraction for interactive timeline scrubbing.
   * Drops intermediate scrub frames while a hardware video seek is in progress so
   * the viewport snaps directly to the cursor without a trailing smoothing/catch-up effect.
   */
  public async scrubToFrameRgba(
    frameIndex: number
  ): Promise<Uint8ClampedArray | null> {
    if (!this.metadata) {
      throw new Error('No video loaded.');
    }

    const clampedIndex = Math.max(
      0,
      Math.min(this.metadata.totalFrames - 1, Math.round(frameIndex))
    );

    if (this.syntheticFrames) {
      return new Uint8ClampedArray(this.syntheticFrames[clampedIndex]);
    }

    const cached = this.frameCache.get(clampedIndex);
    if (cached) {
      return new Uint8ClampedArray(cached);
    }

    return new Promise<Uint8ClampedArray | null>((resolve, reject) => {
      // Cancel any superseded pending scrub request immediately
      if (this.latestScrubRequest) {
        this.latestScrubRequest.resolve(null);
      }
      this.latestScrubRequest = {
        frameIndex: clampedIndex,
        resolve,
        reject,
      };
      void this.drainLatestScrub();
    });
  }

  private async drainLatestScrub(): Promise<void> {
    if (this.isSeekingVideo || !this.metadata) return;
    this.isSeekingVideo = true;

    try {
      while (this.latestScrubRequest && this.metadata) {
        const req = this.latestScrubRequest;
        this.latestScrubRequest = null;

        const cached = this.frameCache.get(req.frameIndex);
        if (cached) {
          req.resolve(new Uint8ClampedArray(cached));
          continue;
        }

        const { width, height, fps } = this.metadata;
        try {
          let extracted!: Uint8ClampedArray;
          this.seekQueue = this.seekQueue.then(async () => {
            extracted = await this.extractFrameInternal(
              req.frameIndex,
              width,
              height,
              fps
            );
            this.cacheFrame(req.frameIndex, extracted);
          });
          await this.seekQueue;

          // If a newer scrub request arrived while we were decoding, supersede this one
          if (this.latestScrubRequest) {
            req.resolve(null);
          } else {
            req.resolve(new Uint8ClampedArray(extracted));
          }
        } catch (err) {
          req.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } finally {
      this.isSeekingVideo = false;
    }
  }

  private async extractFrameInternal(
    frameIndex: number,
    width: number,
    height: number,
    fps: number
  ): Promise<Uint8ClampedArray> {
    const targetTime = Math.min(
      Math.max(0, (frameIndex + 0.1) / fps),
      Math.max(0, (this.videoEl.duration || 1) - 0.001)
    );

    if (Math.abs(this.videoEl.currentTime - targetTime) > 0.002) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          this.videoEl.removeEventListener('seeked', onSeeked);
          resolve();
        };
        this.videoEl.addEventListener('seeked', onSeeked);
        this.videoEl.currentTime = targetTime;
      });
    }

    this.workCtx.drawImage(this.videoEl, 0, 0, width, height);
    const imgData = this.workCtx.getImageData(0, 0, width, height);
    return new Uint8ClampedArray(imgData.data);
  }

  private cacheFrame(frameIndex: number, data: Uint8ClampedArray): void {
    if (this.frameCache.has(frameIndex)) {
      this.frameCache.delete(frameIndex);
    }
    this.frameCache.set(frameIndex, new Uint8ClampedArray(data));
    if (this.frameCache.size > this.maxCacheFrames) {
      const oldestKey = this.frameCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.frameCache.delete(oldestKey);
      }
    }
  }

  private createSquareThumbnail(width: number, height: number): string {
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 96;
    thumbCanvas.height = 96;
    const tCtx = thumbCanvas.getContext('2d');
    if (!tCtx) return '';

    const side = Math.min(width, height);
    const sx = Math.floor((width - side) / 2);
    const sy = Math.floor((height - side) / 2);
    tCtx.drawImage(this.workCanvas, sx, sy, side, side, 0, 0, 96, 96);
    return thumbCanvas.toDataURL('image/png');
  }

  public disposeCurrent(): void {
    this.frameCache.clear();
    this.syntheticFrames = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
