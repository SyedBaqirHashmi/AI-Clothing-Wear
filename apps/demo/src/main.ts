import { TryOnEngine, type EngineStats, type Facing, type GuidanceCode, type OutfitSpec } from '@tryon/engine';
import catalogJson from './catalog.json';
import { STRINGS, type Lang, type Strings } from './i18n.ts';
import './styles.css';

interface CatalogItem extends OutfitSpec {
  gender: 'women' | 'men';
  name: { en: string; ur: string };
  price: number;
  swatch: string;
}
const catalog = catalogJson as unknown as CatalogItem[];

const params = new URLSearchParams(location.search);
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const stage = $('.stage');
const canvas = $<HTMLCanvasElement>('#view');
const guidanceEl = $('.guidance');
const statsEl = $('.stats');
const startSheet = $('[data-screen="start"]');
const resultSheet = $('[data-screen="result"]');
const errorEl = $('.start .error');

let lang: Lang = params.get('lang') === 'ur' ? 'ur' : 'en';
let t: Strings = STRINGS[lang];
let engine: TryOnEngine | null = null;
let current = catalog.find((c) => c.id === params.get('outfit')) ?? catalog[0];
let guidance: GuidanceCode = 'starting';
let timerSec = 0;
let lastShot: Blob | null = null;
let busyShooting = false;

// ------------------------------------------------------------------------------------------
// Language

function loadUrduFont(): void {
  if (document.getElementById('font-ur')) return;
  const link = document.createElement('link');
  link.id = 'font-ur';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap';
  document.head.appendChild(link);
}

function applyLang(): void {
  t = STRINGS[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
  if (lang === 'ur') loadUrduFont();
  document.title = t.title;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = t[el.dataset.t as keyof Strings] as string;
  });
  $('[data-action="lang"]').textContent = lang === 'en' ? 'اردو' : 'English';
  $('[data-action="flip"]').setAttribute('aria-label', t.flip);
  $('[data-action="stats"]').setAttribute('aria-label', t.stats);
  $('.preview-note').textContent = t.preview;
  renderProducts();
  showGuidance(guidance);
}

// ------------------------------------------------------------------------------------------
// Products

const formatPrice = (pkr: number) => `Rs ${pkr.toLocaleString('en-PK')}`;

function renderProducts(): void {
  const list = $('.products');
  list.innerHTML = '';
  for (const item of catalog) {
    const b = document.createElement('button');
    b.className = 'product';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(item.id === current.id));
    b.innerHTML = `<span class="sw" style="background:${item.swatch}"></span><span><span class="nm"></span><span class="pr"></span></span>`;
    b.querySelector('.nm')!.textContent = item.name[lang];
    b.querySelector('.pr')!.textContent = formatPrice(item.price);
    b.onclick = () => selectOutfit(item);
    list.appendChild(b);
  }
}

async function selectOutfit(item: CatalogItem): Promise<void> {
  current = item;
  renderProducts();
  const url = new URL(location.href);
  url.searchParams.set('outfit', item.id);
  history.replaceState(null, '', url);
  await engine?.setOutfit(item);
}

// ------------------------------------------------------------------------------------------
// Guidance + stats

function showGuidance(code: GuidanceCode): void {
  guidance = code;
  const msg = t.guidance[code];
  guidanceEl.textContent = msg;
  guidanceEl.hidden = !msg;
  stage.dataset.guide = code === 'no-person' || code === 'too-close' || code.startsWith('show-') ? 'on' : 'off';
}

function showStats(s: EngineStats): void {
  (window as unknown as { __tryonStats: EngineStats }).__tryonStats = s;
  if (statsEl.hidden) return;
  statsEl.textContent = [
    `video   ${s.videoWidth}×${s.videoHeight}`,
    `render  ${s.renderFps} fps`,
    `track   ${s.trackHz} Hz · ${s.inferenceMs} ms`,
    `pose    ${s.poseAgeMs} ms old (predicted)`,
    `input   ${s.trackInputSize}px · ${s.delegate} · ${s.threading}`,
  ].join('\n');
}

// ------------------------------------------------------------------------------------------
// Start / camera

function isInAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|TikTok|Snapchat|Line\//i.test(navigator.userAgent);
}

function errorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'NotAllowedError' || name === 'SecurityError') return t.errors.denied;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t.errors.nocamera;
  if (msg.includes('WebGL')) return t.errors.webgl;
  if (msg === 'camera-unsupported') return window.isSecureContext ? t.errors.nocamera : t.errors.insecure;
  return `${t.errors.generic} (${msg})`;
}

async function start(): Promise<void> {
  const startBtn = $<HTMLButtonElement>('[data-action="start"]');
  errorEl.hidden = true;
  if (isInAppBrowser()) {
    errorEl.textContent = t.errors.inapp;
    errorEl.hidden = false;
  }
  startBtn.disabled = true;
  $('.start .loading').hidden = false;
  try {
    if (!engine) {
      engine = await TryOnEngine.create({
        canvas,
        assetBase: `${import.meta.env.BASE_URL}mediapipe/`,
        model: params.get('model') === 'full' ? 'full' : 'lite',
        worker: params.get('worker') !== '0',
      });
      engine.onGuidance = (g) => showGuidance(g.code);
      engine.onStats = showStats;
      (window as unknown as { __tryon: TryOnEngine }).__tryon = engine;
    }
    await Promise.all([engine.startCamera(params.get('camera') === 'back' ? 'environment' : 'user'), engine.setOutfit(current)]);
    startSheet.hidden = true;
  } catch (err) {
    console.error(err);
    errorEl.textContent = errorMessage(err);
    errorEl.hidden = false;
  } finally {
    startBtn.disabled = false;
    $('.start .loading').hidden = true;
  }
}

async function flipCamera(): Promise<void> {
  if (!engine) return;
  const next: Facing = engine.cameraFacing === 'user' ? 'environment' : 'user';
  try {
    await engine.startCamera(next);
  } catch {
    await engine.startCamera(engine.cameraFacing);
  }
}

// ------------------------------------------------------------------------------------------
// Snapshot + share

async function shoot(): Promise<void> {
  if (!engine || busyShooting) return;
  busyShooting = true;
  const cd = $('.countdown');
  for (let s = timerSec; s > 0; s--) {
    cd.textContent = String(s);
    cd.hidden = false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  cd.hidden = true;
  const flash = $('.flash');
  flash.hidden = false;
  setTimeout(() => (flash.hidden = true), 350);
  lastShot = await engine.snapshot();
  busyShooting = false;
  if (!lastShot) return;
  const img = resultSheet.querySelector('img')!;
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(lastShot);
  resultSheet.hidden = false;
}

function shotFile(): File | null {
  return lastShot ? new File([lastShot], `tryon-${current.id}.jpg`, { type: 'image/jpeg' }) : null;
}

async function share(): Promise<void> {
  const file = shotFile();
  if (!file) return;
  const data: ShareData = { files: [file], title: current.name[lang], text: `${t.shareText} ${current.name[lang]}` };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  download();
}

function download(): void {
  const file = shotFile();
  if (!file) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------------------------------
// Wiring

function setPressed(group: string, btn: HTMLElement): void {
  document.querySelectorAll(`[data-group="${group}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
}

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-group] button');
  if (!target) return;
  const group = target.parentElement?.dataset.group;
  if (group === 'size') {
    setPressed('size', target);
    const k = Number(target.dataset.value);
    engine?.setFit({ width: k, length: 1 + (k - 1) * 0.35 });
    return;
  }
  if (group === 'timer') {
    setPressed('timer', target);
    timerSec = Number(target.dataset.value);
    return;
  }
  switch (target.dataset.action) {
    case 'start':
      void start();
      break;
    case 'lang':
      lang = lang === 'en' ? 'ur' : 'en';
      applyLang();
      break;
    case 'stats':
      statsEl.hidden = !statsEl.hidden;
      break;
    case 'flip':
      void flipCamera();
      break;
    case 'shoot':
      void shoot();
      break;
    case 'share':
      void share();
      break;
    case 'download':
      download();
      break;
    case 'close-result':
      resultSheet.hidden = true;
      break;
  }
});

document.addEventListener('visibilitychange', () => {
  // Release the camera in the background (battery, privacy); resume when visible again.
  if (!engine) return;
  if (document.hidden) engine.stopCamera();
  else if (startSheet.hidden) void engine.startCamera(engine.cameraFacing);
});

statsEl.hidden = params.get('stats') === '0';
applyLang();
if (params.get('autostart') === '1') void start();
