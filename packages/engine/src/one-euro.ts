/**
 * One-Euro filter (Casiez et al., CHI 2012): an adaptive low-pass filter.
 * Slow movement → low cutoff (strong smoothing, no jitter).
 * Fast movement → higher cutoff (little lag).
 */
export interface OneEuroParams {
  /** Cutoff frequency at rest, Hz. Lower = smoother when still. */
  minCutoff: number;
  /** How quickly the cutoff rises with speed. Higher = less lag when moving. */
  beta: number;
  /** Cutoff used to smooth the derivative, Hz. */
  dCutoff: number;
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(private params: OneEuroParams) {}

  /** Filtered derivative (units per second) — used for motion prediction. */
  get velocity(): number {
    return this.dx;
  }

  get value(): number | null {
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  /** @param timeSec sample timestamp in seconds */
  filter(value: number, timeSec: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = timeSec;
      return value;
    }
    const dt = Math.max(timeSec - this.t, 1e-3);
    this.t = timeSec;
    const { minCutoff, beta, dCutoff } = this.params;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(dCutoff, dt) * (rawDx - this.dx);
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
