import { FilesetResolver, ImageSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_VERSION, type JointName, type Vec2 } from '@tryon/engine';

/** Categories of the MediaPipe "selfie multiclass" segmentation model. */
const CLOTHES = 4;
const ACCESSORIES = 5;

/** MediaPipe pose landmark index for each joint. R = wearer's right (image-left when facing). */
const POSE_INDEX: Record<JointName, number> = {
  'L.shoulder': 11,
  'R.shoulder': 12,
  'L.elbow': 13,
  'R.elbow': 14,
  'L.wrist': 15,
  'R.wrist': 16,
  'L.hip': 23,
  'R.hip': 24,
  'L.knee': 25,
  'R.knee': 26,
  'L.ankle': 27,
  'R.ankle': 28,
};

/** Resample a mask to a new size (bilinear). */
function resize(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  if (sw === dw && sh === dh) return src;
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

export interface DetectedPose {
  joints: Partial<Record<JointName, Vec2>>;
  /** Joints the model was confident about. */
  confident: JointName[];
}

/** On-device AI for the Studio: clothes segmentation and pose detection on still photos. */
export class Vision {
  private constructor(
    private segmenter: ImageSegmenter,
    private pose: PoseLandmarker,
  ) {}

  static async create(assetBase: string): Promise<Vision> {
    const base = new URL(`${assetBase.replace(/\/?$/, '/')}${MEDIAPIPE_VERSION}/`, location.href);
    const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', base).href);
    const [segmenter, pose] = await Promise.all([
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL('models/selfie_multiclass_256x256.tflite', base).href, delegate: 'GPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      }),
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL('models/pose_landmarker_full.task', base).href, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      }),
    ]);
    return new Vision(segmenter, pose);
  }

  /** Probability (0..1) that each pixel is clothing, at the image's size. */
  segmentClothes(image: HTMLCanvasElement, includeAccessories: boolean): Float32Array {
    const result = this.segmenter.segment(image);
    const masks = result.confidenceMasks ?? [];
    if (masks.length <= CLOTHES) throw new Error('Unexpected segmentation model output');
    const mw = masks[CLOTHES].width;
    const mh = masks[CLOTHES].height;
    const clothes = Float32Array.from(masks[CLOTHES].getAsFloat32Array());
    if (includeAccessories && masks[ACCESSORIES]) {
      const acc = masks[ACCESSORIES].getAsFloat32Array();
      for (let i = 0; i < clothes.length; i++) clothes[i] = Math.min(1, clothes[i] + acc[i]);
    }
    result.close();
    return resize(clothes, mw, mh, image.width, image.height);
  }

  /** Find the wearer's joints in a model photo (pixels), or null if no person is visible. */
  detectPose(image: HTMLCanvasElement): DetectedPose | null {
    const result = this.pose.detect(image);
    const lm = result.landmarks[0];
    if (!lm) return null;
    const joints: Partial<Record<JointName, Vec2>> = {};
    const confident: JointName[] = [];
    for (const [name, idx] of Object.entries(POSE_INDEX) as [JointName, number][]) {
      const p = lm[idx];
      joints[name] = { x: p.x * image.width, y: p.y * image.height };
      if ((p.visibility ?? 1) > 0.5) confident.push(name);
    }
    return { joints, confident };
  }
}
