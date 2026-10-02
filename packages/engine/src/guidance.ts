import type { BodyState } from './body.ts';
import type { Coverage, GuidanceCode } from './types.ts';

const STABLE_MS = 400;

/** Decide what to tell the user, with a little hysteresis so messages don't flicker. */
export class GuidanceTracker {
  private current: GuidanceCode = 'starting';
  private candidate: GuidanceCode = 'starting';
  private since = 0;

  static evaluate(body: BodyState | null, need: Coverage | null, light: number, started: boolean): GuidanceCode {
    if (!started) return 'starting';
    if (!body) return 'no-person';
    if (body.headCut || body.shoulderFrac > 0.5) return 'too-close';
    if (body.shoulderFrac < 0.06) return 'too-far';
    if (need && !body.regions.hips) return 'show-hips';
    if (need === 'knees' && !body.regions.knees) return 'show-knees';
    if (need === 'ankles' && !body.regions.ankles) return 'show-ankles';
    if (light < 0.16) return 'low-light';
    return 'ok';
  }

  /** Returns the new code when it changes, otherwise null. */
  update(code: GuidanceCode, nowMs: number): GuidanceCode | null {
    if (code !== this.candidate) {
      this.candidate = code;
      this.since = nowMs;
    }
    if (this.candidate !== this.current && nowMs - this.since >= STABLE_MS) {
      this.current = this.candidate;
      return this.current;
    }
    return null;
  }

  get code(): GuidanceCode {
    return this.current;
  }
}
