import type { EngineStats } from '@tryon/engine';

/**
 * Field-test report: device details + performance over the last 30 s, as plain text the
 * tester can paste into a chat or issue. Contains no images and no personal data.
 */
const WINDOW_MS = 30000;
const samples: { t: number; s: EngineStats }[] = [];
const startedAt = performance.now();

export function recordStats(s: EngineStats): void {
  const t = performance.now();
  samples.push({ t, s });
  while (samples.length && t - samples[0].t > WINDOW_MS) samples.shift();
}

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'no WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'unknown';
  }
}

export function buildReport(extra: Record<string, string>): string {
  const live = samples.filter((x) => x.s.renderFps > 0);
  const stat = (f: (s: EngineStats) => number) => {
    const v = live.map((x) => f(x.s));
    if (!v.length) return 'n/a';
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    return `avg ${avg.toFixed(1)} · min ${Math.min(...v)} · max ${Math.max(...v)}`;
  };
  const last = live.at(-1)?.s;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number } };
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  return [
    'Virtual Try-On field report',
    `date      ${new Date().toISOString()}`,
    `device    ${navigator.userAgent}`,
    `platform  ${uaData?.platform ?? navigator.platform}${uaData?.mobile ? ' (mobile)' : ''} · ${nav.hardwareConcurrency ?? '?'} cores · ${nav.deviceMemory ?? '?'} GB RAM`,
    `gpu       ${gpuName()}`,
    `screen    ${screen.width}×${screen.height} @${devicePixelRatio}x`,
    `network   ${nav.connection?.effectiveType ?? '?'} · ${nav.connection?.downlink ?? '?'} Mbps`,
    ...Object.entries(extra).map(([k, v]) => `${k.padEnd(9)} ${v}`),
    `session   ${Math.round((performance.now() - startedAt) / 1000)} s · last ${Math.round(Math.min(WINDOW_MS, performance.now() - startedAt) / 1000)} s measured`,
    `video     ${last ? `${last.videoWidth}×${last.videoHeight}` : 'n/a'}`,
    `render    ${stat((s) => s.renderFps)} fps`,
    `track     ${stat((s) => s.trackHz)} Hz`,
    `infer     ${stat((s) => s.inferenceMs)} ms`,
    `input     ${last ? `${last.trackInputSize}px · ${last.delegate} · ${last.threading}` : 'n/a'}`,
  ].join('\n');
}

/** Copy to the clipboard; falls back to a selectable text box. */
export async function copyReport(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('style', 'position:fixed;inset:10%;z-index:99;font:12px monospace;background:#111;color:#eee');
    document.body.appendChild(ta);
    ta.select();
    ta.addEventListener('blur', () => ta.remove());
    return false;
  }
}
