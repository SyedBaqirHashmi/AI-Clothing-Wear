import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { JOINT_COUNT, JOINT_STRIDE, type BackendConfig, type Delegate, type PoseBackend } from './backend.ts';

/** MediaPipe's 33-landmark indices for our JOINT_ORDER. */
const MP_INDEX = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

class MediaPipeBackend implements PoseBackend {
  constructor(
    private landmarker: PoseLandmarker,
    readonly delegate: Delegate,
  ) {}

  detect(image: ImageBitmap | HTMLVideoElement, timestampMs: number): Float32Array | null {
    const result = this.landmarker.detectForVideo(image, timestampMs);
    const lm = result.landmarks[0];
    if (!lm) return null;
    const out = new Float32Array(JOINT_COUNT * JOINT_STRIDE);
    for (let j = 0; j < JOINT_COUNT; j++) {
      const p = lm[MP_INDEX[j]];
      out[j * 3] = p.x;
      out[j * 3 + 1] = p.y;
      out[j * 3 + 2] = p.visibility ?? 1;
    }
    return out;
  }

  close(): void {
    this.landmarker.close();
  }
}

/**
 * Create the MediaPipe backend. Tries the requested delegate first and falls back to CPU.
 * `useModule` must be true inside ES module workers (MediaPipe ≥ 1.0).
 */
export async function createMediaPipeBackend(config: BackendConfig, useModule: boolean): Promise<PoseBackend> {
  const fileset = await FilesetResolver.forVisionTasks(config.runtimeBase, useModule);
  const delegates: Delegate[] = config.delegate === 'GPU' ? ['GPU', 'CPU'] : ['CPU'];
  let lastError: unknown;
  for (const delegate of delegates) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: config.modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      return new MediaPipeBackend(landmarker, delegate);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
