export type Facing = 'user' | 'environment';

/**
 * Open the camera at 720p / 30 fps. The browser picks the closest mode; on phones held
 * upright this is usually 720×1280. We ask for 720p as the *minimum* where possible and
 * fall back step by step, because some budget phones reject strict constraints.
 */
export async function openCamera(video: HTMLVideoElement, facing: Facing): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('camera-unsupported');
  }
  const attempts: MediaTrackConstraints[] = [
    { facingMode: facing, width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 }, frameRate: { ideal: 30, min: 24 } },
    { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    { facingMode: facing },
  ];
  let stream: MediaStream | null = null;
  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) break;
    }
  }
  if (!stream) throw lastError instanceof Error ? lastError : new Error('camera-failed');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth) {
    await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
  }
  return stream;
}

export function closeCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
