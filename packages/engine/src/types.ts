import type { JointName } from './rig.ts';
import type { BoneName } from './skinning.ts';

export interface Vec2 {
  x: number;
  y: number;
}

/** Garment slot; also defines draw order (lowest first). */
export type Slot = 'bottom' | 'top' | 'outer' | 'drape';
export const SLOT_ORDER: readonly Slot[] = ['bottom', 'top', 'outer', 'drape'];

/** Body regions a garment needs to see for a good fit; drives guidance. */
export type Coverage = 'torso' | 'knees' | 'ankles';

export interface GarmentLayerSpec {
  id: string;
  slot: Slot;
  /** URL of the garment image (PNG/WebP/SVG with transparent background). */
  image: string;
  /** Natural size of the image in pixels (used to rasterise SVGs and choose mesh density). */
  size: [number, number];
  /**
   * Where the wearer's joints are in the garment image, as [u, v] fractions (0..1, u=0 is the
   * image left = wearer's right). Shoulders and hips are required; others are needed by the
   * bones the layer uses.
   */
  joints: Partial<Record<JointName, [number, number]>>;
  /** Bones that move this layer (defaults by slot: top → torso + arms, bottom → pelvis + legs). */
  bones?: BoneName[];
  /** Lowest body region this layer reaches. */
  coverage: Coverage;
  /** Overall layer opacity (e.g. 0.85 for a chiffon dupatta). Default 1. */
  opacity?: number;
}

export interface OutfitSpec {
  id: string;
  layers: GarmentLayerSpec[];
}

export interface Fit {
  /** Width multiplier around the body centre line (size S..XL ≈ 0.94..1.1). */
  width: number;
  /** Length multiplier measured down from the neck. */
  length: number;
}

export type GuidanceCode =
  | 'starting'
  | 'no-person'
  | 'too-close'
  | 'too-far'
  | 'show-hips'
  | 'show-knees'
  | 'show-ankles'
  | 'low-light'
  | 'ok';

export interface Guidance {
  code: GuidanceCode;
  /** Whether a garment is currently being drawn. */
  rendering: boolean;
}

export interface EngineStats {
  videoWidth: number;
  videoHeight: number;
  /** Frames drawn per second. */
  renderFps: number;
  /** Pose results per second. */
  trackHz: number;
  /** Average model inference time (ms). */
  inferenceMs: number;
  /** Age of the pose used for the latest frame, before prediction (ms). */
  poseAgeMs: number;
  /** Long side of the image sent to the tracker (px). */
  trackInputSize: number;
  delegate: 'GPU' | 'CPU' | 'none';
  threading: 'worker' | 'main' | 'none';
}
