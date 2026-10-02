import { TryOnEngine, type EngineStats, type Facing, type GuidanceCode, type OutfitSpec } from '@tryon/engine';
import { STRINGS, type Lang, type Strings } from './i18n.ts';
import { isTryOnMessage, type HostMessage, type WidgetMessage } from './protocol.ts';
import './styles.css';

interface CatalogItem extends OutfitSpec {
  gender: 'women' | 'men';
  name: { en: string; ur: string };
  price: number;
  swatch: string;
}

const params = new URLSearchParams(location.search);
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const stage = $('.stage');
const canvas = $<HTMLCanvasElement>('#view');
const guidanceEl = $('.guidance');
const statsEl = $('.stats');
const startSheet = $('[data-screen="start"]');
const resultSheet = $('[data-screen="result"]');
const errorEl = $('.start .error');
const startBtn = $<HTMLButtonElement>('[data-action="start"]');

/** Embedded in a store page via tryon.js (see loader.ts). */
const embed = params.get('embed') === '1';
const hostOrigin = (() => {
  try {
    return embed ? new URL(params.get('host') ?? '').origin : null;
  } catch {
    return null;
  }
})();
const cartEnabled = embed && params.get('cart') === '1';
const store = (params.get('store') ?? 'demo').replace(/[^a-z0-9-]/gi, '');
const SIZES: Record<string, string> = { '0.94': 'S', '1': 'M', '1.06': 'L', '1.12': 'XL' };

let lang: Lang = params.get('lang') === 'ur' ? 'ur' : 'en';
let t: Strings = STRINGS[lang];
let catalog: CatalogItem[] = [];
let current: CatalogItem | null = null;
let engine: TryOnEngine | null = null;
let enginePromise: Promise<TryOnEngine> | null = null;
let guidance: GuidanceCode = 'starting';
let timerSec = 0;
let size = 'M';
let lastShot: Blob | null = null;
let busyShooting = false;
let cartRequest = 0;

// ------------------------------------------------------------------------------------------
// Host messaging

function postToHost(msg: WidgetMessage): void {
  if (hostOrigin && window.parent !== window) window.parent.postMessage(msg, hostOrigin);
}

window.addEventListener('message', (ev: MessageEvent) => {
  if (!hostOrigin || ev.origin !== hostOrigin || ev.source !== window.parent) return;
  if (!isTryOnMessage<HostMessage>(ev.data)) return;
  if (ev.data.type === 'cart-result' && ev.data.id === cartRequest) {
    toast(ev.data.ok ? `✓ ${t.added}` : t.addFailed);
    document.querySelectorAll<HTMLButtonElement>('[data-action="cart"]').forEach((b) => (b.disabled = false));
  }
});

function closeWidget(): void {
  engine?.stopCamera();
  postToHost({ source: 'tryon', type: 'close' });
}

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('.toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3000);
}

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
  document.querySelectorAll('[data-action="close"]').forEach((b) => b.setAttribute('aria-label', t.close));
  $('.preview-note').textContent = t.preview;
  renderProducts();
  renderCartButtons();
  showGuidance(guidance);
}

// ------------------------------------------------------------------------------------------
// Catalog

const formatPrice = (pkr: number) => `Rs ${pkr.toLocaleString('en-PK')}`;

async function loadCatalog(): Promise<void> {
  try {
    const res = await fetch(`catalog/${store}.json`);
    if (!res.ok) throw new Error(String(res.status));
    catalog = (await res.json()) as CatalogItem[];
  } catch {
    catalog = [];
  }
  const wanted = params.get('product') ?? params.get('outfit');
  current = catalog.find((c) => c.id === wanted) ?? (embed && wanted ? null : catalog[0] ?? null);
  if (!current) {
    errorEl.textContent = t.catalogError;
    errorEl.hidden = false;
    startBtn.disabled = true;
  }
  renderProducts();
  renderCartButtons();
}

function renderProducts(): void {
  const list = $('.products');
  list.innerHTML = '';
  for (const item of catalog) {
    const b = document.createElement('button');
    b.className = 'product';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(item.id === current?.id));
    b.innerHTML = `<span class="sw"></span><span><span class="nm"></span><span class="pr"></span></span>`;
    (b.querySelector('.sw') as HTMLElement).style.background = item.swatch;
    b.querySelector('.nm')!.textContent = item.name[lang];
    b.querySelector('.pr')!.textContent = formatPrice(item.price);
    b.onclick = () => selectOutfit(item);
    list.appendChild(b);
  }
}

function renderCartButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-action="cart"]').forEach((b) => {
    b.hidden = !cartEnabled || !current;
    if (current) b.innerHTML = `${t.addToCart} <small>· ${size} · ${formatPrice(current.price)}</small>`;
  });
}

async function selectOutfit(item: CatalogItem): Promise<void> {
  current = item;
  renderProducts();
  renderCartButtons();
  if (!embed) {
    const url = new URL(location.href);
    url.searchParams.set('outfit', item.id);
    history.replaceState(null, '', url);
  }
  postToHost({ source: 'tryon', type: 'event', name: 'outfit-changed', product: item.id });
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
// Engine + camera

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

/** Start loading the tracking model right away, while the shopper reads the privacy note. */
function loadEngine(): Promise<TryOnEngine> {
  enginePromise ??= TryOnEngine.create({
    canvas,
    assetBase: `${import.meta.env.BASE_URL}mediapipe/`,
    model: params.get('model') === 'full' ? 'full' : 'lite',
    worker: params.get('worker') !== '0',
  }).then((e) => {
    e.onGuidance = (g) => showGuidance(g.code);
    e.onStats = showStats;
    (window as unknown as { __tryon: TryOnEngine }).__tryon = e;
    engine = e;
    return e;
  });
  return enginePromise;
}

async function start(): Promise<void> {
  if (!current) return;
  errorEl.hidden = true;
  if (isInAppBrowser()) {
    errorEl.textContent = t.errors.inapp;
    errorEl.hidden = false;
  }
  startBtn.disabled = true;
  $('.start .loading').hidden = false;
  try {
    const e = await loadEngine();
    await Promise.all([e.startCamera(params.get('camera') === 'back' ? 'environment' : 'user'), e.setOutfit(current)]);
    startSheet.hidden = true;
    postToHost({ source: 'tryon', type: 'event', name: 'camera-started', product: current.id });
  } catch (err) {
    console.error(err);
    enginePromise = engine ? enginePromise : null; // allow a retry if loading failed
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
// Snapshot + share + cart

async function shoot(): Promise<void> {
  if (!engine || busyShooting || !current) return;
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
  postToHost({ source: 'tryon', type: 'event', name: 'snapshot', product: current.id });
}

function shotFile(): File | null {
  return lastShot && current ? new File([lastShot], `tryon-${current.id}.jpg`, { type: 'image/jpeg' }) : null;
}

async function share(): Promise<void> {
  const file = shotFile();
  if (!file || !current) return;
  const data: ShareData = { files: [file], title: current.name[lang], text: `${t.shareText} ${current.name[lang]}` };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      postToHost({ source: 'tryon', type: 'event', name: 'share', product: current.id });
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

function addToCart(): void {
  if (!current || !cartEnabled) return;
  cartRequest++;
  document.querySelectorAll<HTMLButtonElement>('[data-action="cart"]').forEach((b) => (b.disabled = true));
  postToHost({ source: 'tryon', type: 'add-to-cart', id: cartRequest, detail: { product: current.id, size } });
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
    size = SIZES[target.dataset.value!] ?? 'M';
    engine?.setFit({ width: k, length: 1 + (k - 1) * 0.35 });
    renderCartButtons();
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
    case 'close':
      closeWidget();
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
    case 'cart':
      addToCart();
      break;
    case 'close-result':
      resultSheet.hidden = true;
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && embed) closeWidget();
});

document.addEventListener('visibilitychange', () => {
  // Release the camera in the background (battery, privacy); resume when visible again.
  if (!engine) return;
  if (document.hidden) engine.stopCamera();
  else if (startSheet.hidden) void engine.startCamera(engine.cameraFacing);
});

// Cache the model and runtime for instant repeat visits (production builds only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[tryon] service worker:', err));
}

document.querySelectorAll<HTMLElement>('[data-action="close"]').forEach((b) => (b.hidden = !embed));
statsEl.hidden = params.get('stats') !== '1' && (embed || params.get('stats') === '0');
applyLang();
void loadCatalog().then(() => {
  if (current) void loadEngine().catch(() => {}); // errors are reported when the shopper taps Start
  if (params.get('autostart') === '1') void start();
});
postToHost({ source: 'tryon', type: 'ready' });
