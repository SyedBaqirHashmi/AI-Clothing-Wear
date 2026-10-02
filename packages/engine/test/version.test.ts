import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIAPIPE_VERSION } from '../src/version.ts';

describe('MEDIAPIPE_VERSION', () => {
  it('matches the installed @mediapipe/tasks-vision package', () => {
    const require = createRequire(import.meta.url);
    const dir = dirname(require.resolve('@mediapipe/tasks-vision'));
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(MEDIAPIPE_VERSION).toBe(pkg.version);
  });
});
