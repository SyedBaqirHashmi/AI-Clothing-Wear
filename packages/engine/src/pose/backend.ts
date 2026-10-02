/**
 * Pose backends turn an image into the 13 body joints the engine needs.
 * Everything downstream (smoothing, body model, garment warp) only sees this format,
 * so the model provider can be swapped (MediaPipe, RTMPose via ONNX Runtime, …).
 */
export const JOINT_ORDER = [
  'nose',
  'L.shoulder',
  'R.shoulder',
  'L.elbow',
  'R.elbow',
  'L.wrist',
  'R.wrist',
  'L.hip',
  'R.hip',
  'L.knee',
  'R.knee',
  'L.ankle',
  'R.ankle',
] as const;
export type PoseJoint = (typeof JOINT_ORDER)[number];
export const JOINT_COUNT = JOINT_ORDER.length;
/** Values per joint in a pose buffer: x, y (normalised 0..1 in the input image), visibility 0..1. */
export const JOINT_STRIDE = 3;

export type Delegate = 'GPU' | 'CPU';
export type ModelVariant = 'lite' | 'full';

export interface BackendConfig {
  /** Base URL of the backend's runtime files (e.g. MediaPipe wasm folder). Absolute. */
  runtimeBase: string;
  /** Absolute URL of the model file. */
  modelUrl: string;
  delegate: Delegate;
}

export interface PoseBackend {
  readonly delegate: Delegate;
  /** Returns joints (JOINT_COUNT × JOINT_STRIDE) or null when nobody is found. */
  detect(image: ImageBitmap | HTMLVideoElement, timestampMs: number): Float32Array | null;
  close(): void;
}
