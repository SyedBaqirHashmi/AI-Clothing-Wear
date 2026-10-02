import type { BackendConfig, Delegate, PoseBackend } from './backend.ts';
import type { WorkerRequest, WorkerResponse } from './pose.worker.ts';

export interface PoseSample {
  /** performance.now() when the frame was captured for tracking. */
  time: number;
  /** Joints normalised to the video frame, or null if nobody is visible. */
  points: Float32Array | null;
  inferenceMs: number;
}

export interface TrackerInfo {
  threading: 'worker' | 'main';
  delegate: Delegate;
}

const WORKER_INIT_TIMEOUT_MS = 20000;

/**
 * Runs pose detection off the render path.
 * Preferred: a module Web Worker (rendering never waits for the model).
 * Fallback: main thread (older browsers, or if the worker fails to start).
 * Only one frame is in flight at a time; new frames are skipped while busy,
 * so the tracker naturally runs as fast as the device allows.
 */
export class PoseTracker {
  private worker: Worker | null = null;
  private backend: PoseBackend | null = null;
  private busy = false;
  private closed = false;
  info: TrackerInfo = { threading: 'main', delegate: 'CPU' };
  /** Long side, in px, of the image sent to the model. Adjusted by the quality controller. */
  inputSize = 640;
  onSample: (sample: PoseSample) => void = () => {};
  onError: (message: string) => void = () => {};

  async init(config: BackendConfig, preferWorker = true): Promise<TrackerInfo> {
    if (preferWorker && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        const delegate = await this.startWorker(config);
        this.info = { threading: 'worker', delegate };
        return this.info;
      } catch (err) {
        console.warn('[tryon] pose worker unavailable, using main thread:', err);
        this.worker?.terminate();
        this.worker = null;
      }
    }
    // Loaded only when needed, so phones using the worker don't download it twice.
    const { createMediaPipeBackend } = await import('./mediapipe.ts');
    this.backend = await createMediaPipeBackend(config, false);
    this.info = { threading: 'main', delegate: this.backend.delegate };
    return this.info;
  }

  private startWorker(config: BackendConfig): Promise<Delegate> {
    const worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker init timeout')), WORKER_INIT_TIMEOUT_MS);
      worker.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(e.message || 'worker error'));
      };
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === 'ready') {
          clearTimeout(timer);
          worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleWorkerMessage(e.data);
          worker.onerror = (e) => this.onError(e.message || 'worker error');
          resolve(msg.delegate);
        } else if (msg.type === 'error') {
          clearTimeout(timer);
          reject(new Error(msg.message));
        }
      };
      worker.postMessage({ type: 'init', config } satisfies WorkerRequest);
    });
  }

  private handleWorkerMessage(msg: WorkerResponse): void {
    if (msg.type === 'pose') {
      this.busy = false;
      if (!this.closed) this.onSample({ time: msg.time, points: msg.points, inferenceMs: msg.inferenceMs });
    } else if (msg.type === 'error') {
      this.busy = false;
      this.onError(msg.message);
    }
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** Submit a video frame if the tracker is idle. Returns false if skipped. */
  submit(video: HTMLVideoElement, time: number): boolean {
    if (this.busy || this.closed || video.videoWidth === 0) return false;
    this.busy = true;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const k = Math.min(1, this.inputSize / Math.max(vw, vh));
    const resizeWidth = Math.round(vw * k);
    const resizeHeight = Math.round(vh * k);
    createImageBitmap(video, { resizeWidth, resizeHeight, resizeQuality: 'low' })
      .then((bitmap) => {
        if (this.closed) {
          bitmap.close();
          return;
        }
        if (this.worker) {
          this.worker.postMessage({ type: 'frame', bitmap, time } satisfies WorkerRequest, [bitmap]);
        } else {
          this.runOnMainThread(bitmap, time);
        }
      })
      .catch((err) => {
        this.busy = false;
        this.onError(String(err));
      });
    return true;
  }

  private lastTs = 0;
  private runOnMainThread(bitmap: ImageBitmap, time: number): void {
    const ts = Math.max(Math.round(time), this.lastTs + 1);
    this.lastTs = ts;
    const t0 = performance.now();
    let points: Float32Array | null = null;
    try {
      points = this.backend!.detect(bitmap, ts);
    } catch (err) {
      this.onError(String(err));
    } finally {
      bitmap.close();
    }
    this.busy = false;
    this.onSample({ time, points, inferenceMs: performance.now() - t0 });
  }

  close(): void {
    this.closed = true;
    this.worker?.terminate();
    this.backend?.close();
    this.worker = null;
    this.backend = null;
  }
}
