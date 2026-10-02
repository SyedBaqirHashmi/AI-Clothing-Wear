import { BodyModel, type BodyState } from './body.ts';
import { closeCamera, openCamera, type Facing } from './camera.ts';
import { Garment, loadGarmentImage } from './garment.ts';
import { GuidanceTracker } from './guidance.ts';
import type { Delegate, ModelVariant } from './pose/backend.ts';
import { PoseTracker } from './pose/tracker.ts';
import { Renderer } from './render/renderer.ts';
import { SLOT_ORDER, type Coverage, type EngineStats, type Fit, type Guidance, type OutfitSpec } from './types.ts';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Folder that contains `wasm/` and `models/` (self-hosted MediaPipe files). */
  assetBase: string;
  model?: ModelVariant;
  delegate?: Delegate;
  /** Run tracking in a Web Worker when possible (default true). */
  worker?: boolean;
}

/** Tracker input sizes (long side, px) the quality controller steps through. */
const INPUT_STEPS = [640, 512, 416, 320];
const COVERAGE_RANK: Record<Coverage, number> = { torso: 0, knees: 1, ankles: 2 };

class Rate {
  private times: number[] = [];
  tick(t: number): void {
    this.times.push(t);
    while (this.times.length && t - this.times[0] > 1000) this.times.shift();
  }
  value(t: number): number {
    while (this.times.length && t - this.times[0] > 1000) this.times.shift();
    return this.times.length;
  }
}

export class TryOnEngine {
  readonly video: HTMLVideoElement;
  private renderer: Renderer;
  private tracker = new PoseTracker();
  private body = new BodyModel();
  private guidance = new GuidanceTracker();
  private garments: Garment[] = [];
  private outfitToken = 0;
  private fit: Fit = { width: 1, length: 1 };
  private facing: Facing = 'user';
  private running = false;
  private frameHandle = 0;
  private lastVideoTime = -1;
  private light = 0.5;
  private lightCanvas = document.createElement('canvas');
  private lastLightCheck = 0;
  private pendingSnapshot: ((blob: Blob | null) => void) | null = null;

  private renderRate = new Rate();
  private trackRate = new Rate();
  private inferenceMs = 0;
  private poseAgeMs = 0;
  private lastStatsEmit = 0;
  private lastAdapt = 0;
  private inputStep = 0;

  /** Called when the guidance message changes. */
  onGuidance: (g: Guidance) => void = () => {};
  /** Called twice a second with performance numbers. */
  onStats: (s: EngineStats) => void = () => {};
  onError: (message: string) => void = (m) => console.error('[tryon]', m);

  private constructor(private opts: EngineOptions) {
    this.renderer = new Renderer(opts.canvas);
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.lightCanvas.width = 16;
    this.lightCanvas.height = 16;
  }

  /** Create the engine and load the tracking model (the slow part on first visit). */
  static async create(opts: EngineOptions): Promise<TryOnEngine> {
    const engine = new TryOnEngine(opts);
    const base = new URL(opts.assetBase.replace(/\/?$/, '/'), location.href);
    const model = opts.model ?? 'lite';
    await engine.tracker.init(
      {
        runtimeBase: new URL('wasm', base).href,
        modelUrl: new URL(`models/pose_landmarker_${model}.task`, base).href,
        delegate: opts.delegate ?? 'GPU',
      },
      opts.worker ?? true,
    );
    engine.tracker.inputSize = INPUT_STEPS[0];
    engine.tracker.onSample = (s) => {
      engine.trackRate.tick(performance.now());
      engine.inferenceMs = engine.inferenceMs ? engine.inferenceMs * 0.9 + s.inferenceMs * 0.1 : s.inferenceMs;
      engine.body.update(s.points, s.time, engine.video.videoWidth, engine.video.videoHeight);
    };
    engine.tracker.onError = (m) => engine.onError(m);
    return engine;
  }

  get cameraFacing(): Facing {
    return this.facing;
  }

  async startCamera(facing: Facing = 'user'): Promise<void> {
    this.stopLoop();
    closeCamera(this.video);
    this.facing = facing;
    await openCamera(this.video, facing);
    this.body.reset();
    this.running = true;
    this.scheduleFrame();
  }

  stopCamera(): void {
    this.stopLoop();
    closeCamera(this.video);
  }

  /** Replace the current outfit. Layers load in parallel; the old outfit stays until ready. */
  async setOutfit(outfit: OutfitSpec | null): Promise<void> {
    const token = ++this.outfitToken;
    if (!outfit) {
      this.garments = [];
      this.renderer.retain([]);
      return;
    }
    const layers = [...outfit.layers].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    const garments = await Promise.all(layers.map(async (spec) => new Garment(spec, await loadGarmentImage(spec))));
    if (token !== this.outfitToken) return; // a newer outfit was selected meanwhile
    this.garments = garments;
    this.renderer.retain(garments);
  }

  setFit(fit: Partial<Fit>): void {
    this.fit = { ...this.fit, ...fit };
  }

  /** Capture the next rendered frame (with garment) as a JPEG. */
  snapshot(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.pendingSnapshot = resolve;
    });
  }

  destroy(): void {
    this.stopCamera();
    this.tracker.close();
  }

  private stopLoop(): void {
    this.running = false;
    if (this.frameHandle) {
      if ('cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.frameHandle);
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
  }

  private scheduleFrame(): void {
    if (!this.running) return;
    // Render exactly once per new camera frame when the browser supports it.
    if ('requestVideoFrameCallback' in this.video) {
      this.frameHandle = this.video.requestVideoFrameCallback(() => this.frame());
    } else {
      this.frameHandle = requestAnimationFrame(() => {
        const vt = (this.video as HTMLVideoElement).currentTime;
        if (vt !== this.lastVideoTime) {
          this.lastVideoTime = vt;
          this.frame();
        } else {
          this.scheduleFrame();
        }
      });
    }
  }

  private frame(): void {
    if (!this.running) return;
    const now = performance.now();
    const W = this.video.videoWidth;
    const H = this.video.videoHeight;
    this.tracker.submit(this.video, now);

    const state = this.body.state(now, W, H);
    if (this.body.tracking) this.poseAgeMs = now - this.body.lastSampleTime;
    const visible = this.visibleGarments(state);
    for (const g of visible) g.update(state!.skeleton, this.fit);

    try {
      this.renderer.render(this.video, visible, {
        mirror: this.facing === 'user',
        shade: 0.35,
        ambient: 0.6,
      });
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err));
    }
    this.renderRate.tick(now);

    if (this.pendingSnapshot) {
      const done = this.pendingSnapshot;
      this.pendingSnapshot = null;
      // The drawing buffer is still intact within this task.
      this.opts.canvas.toBlob((b) => done(b), 'image/jpeg', 0.92);
    }

    this.measureLight(now);
    this.updateGuidance(state, visible.length > 0, now);
    this.adaptQuality(now);
    this.emitStats(now);
    this.scheduleFrame();
  }

  private requiredCoverage(): Coverage | null {
    let need: Coverage | null = null;
    for (const g of this.garments) {
      if (!need || COVERAGE_RANK[g.spec.coverage] > COVERAGE_RANK[need]) need = g.spec.coverage;
    }
    return need;
  }

  /** Upper-body mode: bottoms need the knees in view; tops and drapes always render. */
  private visibleGarments(state: BodyState | null): Garment[] {
    if (!state) return [];
    return this.garments.filter((g) => g.spec.slot !== 'bottom' || state.regions.knees);
  }

  private measureLight(now: number): void {
    if (now - this.lastLightCheck < 1000) return;
    this.lastLightCheck = now;
    const ctx = this.lightCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    this.light = sum / (256 * 255);
  }

  private updateGuidance(state: BodyState | null, rendering: boolean, now: number): void {
    const code = GuidanceTracker.evaluate(state, this.requiredCoverage(), this.light, true);
    const changed = this.guidance.update(code, now);
    if (changed) this.onGuidance({ code: changed, rendering });
  }

  /**
   * Keep rendering at camera rate; trade tracker input size for speed.
   * Steps down when tracking falls under 20 Hz, back up when there is headroom.
   */
  private adaptQuality(now: number): void {
    if (now - this.lastAdapt < 2000) return;
    this.lastAdapt = now;
    const hz = this.trackRate.value(now);
    if (hz === 0) return;
    if (hz < 20 && this.inputStep < INPUT_STEPS.length - 1) this.inputStep++;
    else if (hz >= 28 && this.inferenceMs < 22 && this.inputStep > 0) this.inputStep--;
    this.tracker.inputSize = INPUT_STEPS[this.inputStep];
  }

  private emitStats(now: number): void {
    if (now - this.lastStatsEmit < 500) return;
    this.lastStatsEmit = now;
    this.onStats({
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      renderFps: this.renderRate.value(now),
      trackHz: this.trackRate.value(now),
      inferenceMs: Math.round(this.inferenceMs * 10) / 10,
      poseAgeMs: Math.round(this.poseAgeMs),
      trackInputSize: this.tracker.inputSize,
      delegate: this.tracker.info.delegate,
      threading: this.tracker.info.threading,
    });
  }
}
