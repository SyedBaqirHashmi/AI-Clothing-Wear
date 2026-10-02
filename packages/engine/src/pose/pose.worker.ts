/// <reference lib="webworker" />
import type { BackendConfig, PoseBackend } from './backend.ts';
import { createMediaPipeBackend } from './mediapipe.ts';

export type WorkerRequest =
  | { type: 'init'; config: BackendConfig }
  | { type: 'frame'; bitmap: ImageBitmap; time: number };

export type WorkerResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; message: string }
  | { type: 'pose'; time: number; points: Float32Array | null; inferenceMs: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let backend: PoseBackend | null = null;
let lastTimestamp = 0;

function reply(msg: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer);
}

scope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      backend = await createMediaPipeBackend(msg.config, true);
      reply({ type: 'ready', delegate: backend.delegate });
    } catch (err) {
      reply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'frame') {
    const { bitmap, time } = msg;
    if (!backend) {
      bitmap.close();
      return;
    }
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(Math.round(time), lastTimestamp + 1);
    lastTimestamp = ts;
    const t0 = performance.now();
    let points: Float32Array | null = null;
    try {
      points = backend.detect(bitmap, ts);
    } catch (err) {
      reply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      bitmap.close();
    }
    const inferenceMs = performance.now() - t0;
    reply({ type: 'pose', time, points, inferenceMs }, points ? [points.buffer] : []);
  }
};
