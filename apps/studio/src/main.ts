import { TryOnEngine, type GarmentLayerSpec, type JointName, type Slot, type Vec2 } from '@tryon/engine';
import {
  cutOut as runCutOut,
  defaultSplitY,
  detectHem,
  exportLayer as runExport,
  JOINT_NAMES,
  layerAlpha as runLayerAlpha,
  loadPhoto as decodePhoto,
  slug,
  swatch,
  templateJoints,
  type CutoutResult,
  type Keep,
} from './pipeline.ts';
import { Vision } from './vision.ts';
import './styles.css';

const ASSETS = `${import.meta.env.BASE_URL}mediapipe/`;

interface DraftLayer {
  spec: GarmentLayerSpec;
  blob: Blob;
  url: string;
  ext: 'webp' | 'png';
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const work = $<HTMLCanvasElement>('#work');
const ctx = work.getContext('2d')!;
const wrap = $('.canvas-wrap');
const statusEl = $('.status');

const state = {
  name: '',
  photo: null as HTMLCanvasElement | null,
  cutout: null as CutoutResult | null, // pixels (gaps filled), mask before split, joints
  joints: {} as Record<JointName, Vec2>,
  splitY: 0,
  layers: [] as DraftLayer[],
};

let vision: Promise<Vision> | null = null;
const getVision = () => (vision ??= Vision.create(ASSETS));

function status(msg: string): void {
  statusEl.textContent = msg;
}

const val = (id: string) => ($<HTMLInputElement>(`#${id}`)).value;
const checked = (id: string) => ($<HTMLInputElement>(`#${id}`)).checked;
const kind = () => (document.querySelector<HTMLInputElement>('input[name="kind"]:checked')!.value as 'model' | 'plain');

// ------------------------------------------------------------------------------------------
// Photo loading

async function loadPhoto(file: File): Promise<void> {
  const c = await decodePhoto(file);
  state.name = file.name.replace(/\.[^.]+$/, '');
  state.photo = c;
  state.cutout = null;
  state.splitY = c.height * 0.6;
  state.joints = templateJoints(c.width, c.height);
  work.width = c.width;
  work.height = c.height;
  wrap.classList.add('has-photo');
  if (!val('pid')) ($<HTMLInputElement>('#pid')).value = slug(state.name);
  updateButtons();
  draw();
  status('Photo loaded. Click “Cut out garment”.');
  void getVision(); // start loading the AI models
}

// ------------------------------------------------------------------------------------------
// Cut-out

async function cutOut(): Promise<void> {
  const photo = state.photo;
  if (!photo) return;
  status(kind() === 'model' ? 'Finding the clothes and the wearer’s joints…' : 'Removing the background…');
  await new Promise((r) => setTimeout(r, 20));
  const c = await runCutOut(photo, getVision, { kind: kind(), fillGaps: checked('fill'), accessories: checked('accessories') });
  state.cutout = c;
  state.joints = c.joints;
  const hem = detectHem(c);
  state.splitY = hem ?? defaultSplitY(c.joints);
  status(
    kind() === 'plain'
      ? 'Background removed. Place the joints on the garment.'
      : c.personFound
        ? `Cut out. Joints found automatically; check them.${hem ? ' Kameez hem detected.' : ''}`
        : 'Cut out. No person found: place the joints by hand.',
  );
  updateButtons();
  draw();
}

function layerAlpha(): Float32Array | null {
  if (!state.cutout) return null;
  state.cutout.joints = state.joints;
  return runLayerAlpha(state.cutout, val('keep') as Keep, state.splitY);
}

// ------------------------------------------------------------------------------------------
// Drawing + joint editing

const handleRadius = () => Math.max(6, work.width / 160);

function draw(): void {
  const photo = state.photo;
  if (!photo) return;
  const w = photo.width;
  const h = photo.height;
  ctx.clearRect(0, 0, w, h);
  const alpha = layerAlpha();
  if (!alpha || checked('original')) {
    ctx.drawImage(photo, 0, 0);
  } else {
    // Checkerboard + cut-out.
    const s = Math.max(8, Math.round(w / 60));
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      ctx.fillStyle = ((x / s + y / s) & 1) ? '#3a3a40' : '#2c2c31';
      ctx.fillRect(x, y, s, s);
    }
    const out = new ImageData(w, h);
    const src = state.cutout!.pixels.data;
    for (let i = 0; i < w * h; i++) {
      out.data[i * 4] = src[i * 4];
      out.data[i * 4 + 1] = src[i * 4 + 1];
      out.data[i * 4 + 2] = src[i * 4 + 2];
      out.data[i * 4 + 3] = alpha[i] * 255;
    }
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d')!.putImageData(out, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }
  // Split line.
  if (val('keep') !== 'all') {
    ctx.save();
    ctx.setLineDash([w / 80, w / 120]);
    ctx.strokeStyle = '#d9b25a';
    ctx.lineWidth = Math.max(2, w / 400);
    ctx.beginPath();
    ctx.moveTo(0, state.splitY);
    ctx.lineTo(w, state.splitY);
    ctx.stroke();
    ctx.restore();
  }
  // Skeleton + joints.
  const j = state.joints;
  ctx.strokeStyle = 'rgba(217,178,90,0.8)';
  ctx.lineWidth = Math.max(1.5, w / 600);
  const bonesToDraw: [JointName, JointName][] = [
    ['R.shoulder', 'L.shoulder'], ['R.hip', 'L.hip'], ['R.shoulder', 'R.hip'], ['L.shoulder', 'L.hip'],
    ['R.shoulder', 'R.elbow'], ['R.elbow', 'R.wrist'], ['L.shoulder', 'L.elbow'], ['L.elbow', 'L.wrist'],
    ['R.hip', 'R.knee'], ['R.knee', 'R.ankle'], ['L.hip', 'L.knee'], ['L.knee', 'L.ankle'],
  ];
  ctx.beginPath();
  for (const [a, b] of bonesToDraw) {
    ctx.moveTo(j[a].x, j[a].y);
    ctx.lineTo(j[b].x, j[b].y);
  }
  ctx.stroke();
  const r = handleRadius();
  ctx.font = `${Math.round(r * 1.6)}px system-ui`;
  for (const name of JOINT_NAMES) {
    const p = j[name];
    ctx.fillStyle = name.startsWith('R') ? '#d9b25a' : '#7fd1c4';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(name.replace('.', ' '), p.x + r * 1.4, p.y + r * 0.5);
  }
}

function toWork(e: PointerEvent): Vec2 {
  const rect = work.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) / rect.width) * work.width, y: ((e.clientY - rect.top) / rect.height) * work.height };
}

let dragging: JointName | 'split' | null = null;
work.addEventListener('pointerdown', (e) => {
  if (!state.photo) return;
  const p = toWork(e);
  const r = handleRadius() * 2;
  dragging = JOINT_NAMES.find((n) => Math.hypot(state.joints[n].x - p.x, state.joints[n].y - p.y) < r) ?? null;
  if (!dragging && val('keep') !== 'all' && Math.abs(p.y - state.splitY) < r) dragging = 'split';
  if (dragging) work.setPointerCapture(e.pointerId);
});
work.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const p = toWork(e);
  if (dragging === 'split') state.splitY = p.y;
  else state.joints[dragging] = p;
  draw();
});
work.addEventListener('pointerup', () => (dragging = null));

// ------------------------------------------------------------------------------------------
// Export

async function exportLayer(): Promise<DraftLayer | null> {
  const alpha = layerAlpha();
  if (!alpha || !state.cutout) return null;
  const slot = val('slot') as Slot;
  const pid = slug(val('pid') || state.name);
  const id = `${pid}-${slot}${state.layers.some((l) => l.spec.slot === slot) ? `-${state.layers.length + 1}` : ''}`;
  const layer = await runExport(state.cutout, { id, slot, alpha, opacity: Number(val('opacity')) });
  return layer ? { ...layer, url: layer.spec.image } : null;
}

async function addLayer(): Promise<void> {
  const layer = await exportLayer();
  if (!layer) {
    status('Nothing to export: the cut-out is empty.');
    return;
  }
  state.layers.push(layer);
  renderLayers();
  status(`Added ${layer.spec.slot} layer (${layer.spec.size.join('×')}, ${(layer.blob.size / 1024).toFixed(0)} KB).`);
}

function renderLayers(): void {
  const ul = $('.layers');
  ul.innerHTML = '';
  state.layers.forEach((l, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<img alt="" /><span></span><button>Remove</button>`;
    li.querySelector('img')!.src = l.url;
    li.querySelector('span')!.textContent = `${l.spec.slot} · ${l.spec.coverage} · ${(l.blob.size / 1024).toFixed(0)} KB`;
    li.querySelector('button')!.onclick = () => {
      URL.revokeObjectURL(l.url);
      state.layers.splice(i, 1);
      renderLayers();
    };
    ul.appendChild(li);
  });
  updateButtons();
}

/** Catalog entry in the widget's format (images referenced as garments/<id>.<ext>). */
async function productJson(): Promise<object> {
  const pid = slug(val('pid') || state.name);
  return {
    id: pid,
    gender: val('gender'),
    name: { en: val('name-en') || pid, ur: val('name-ur') || val('name-en') || pid },
    price: Number(val('price')) || 0,
    swatch: await swatch((state.layers.find((l) => l.spec.slot === 'top') ?? state.layers[0]).blob),
    layers: state.layers.map((l) => ({ ...l.spec, image: `garments/${l.spec.id}.${l.ext}` })),
  };
}

function save(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function download(): Promise<void> {
  for (const l of state.layers) save(l.blob, `${l.spec.id}.${l.ext}`);
  const json = await productJson();
  save(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), `${(json as { id: string }).id}.json`);
  status('Downloaded. Put the images in the widget’s garments/ folder and add the JSON entry to the store catalog.');
}

// ------------------------------------------------------------------------------------------
// Preview

const dialog = $<HTMLDialogElement>('dialog.preview');
const previewCanvas = $<HTMLCanvasElement>('#preview-canvas');
let previewEngine: Promise<TryOnEngine> | null = null;
let photoLoop = 0;

function getPreviewEngine(): Promise<TryOnEngine> {
  previewEngine ??= TryOnEngine.create({ canvas: previewCanvas, assetBase: ASSETS }).then((e) => {
    e.onStats = (s) => {
      $('.preview-stats').textContent = `${s.videoWidth}×${s.videoHeight} · ${s.renderFps} fps · track ${s.trackHz} Hz`;
      (window as unknown as { __previewStats: unknown }).__previewStats = s;
    };
    return e;
  });
  return previewEngine;
}

/** A still photo as a live video stream (redrawn every frame so the stream keeps flowing). */
function photoStream(source: CanvasImageSource & { width: number; height: number }): MediaStream {
  cancelAnimationFrame(photoLoop);
  const k = Math.min(1, 1280 / Math.max(source.width, source.height));
  const c = document.createElement('canvas');
  c.width = Math.round(source.width * k);
  c.height = Math.round(source.height * k);
  const cx = c.getContext('2d')!;
  const tick = () => {
    cx.drawImage(source, 0, 0, c.width, c.height);
    photoLoop = requestAnimationFrame(tick);
  };
  tick();
  return c.captureStream(30);
}

async function openPreview(source: 'photo' | 'camera' | ImageBitmap): Promise<void> {
  if (!state.layers.length) return;
  if (!dialog.open) dialog.showModal();
  status('Loading preview…');
  const e = await getPreviewEngine();
  await e.setOutfit({ id: 'draft', layers: state.layers.map((l) => l.spec) });
  if (source === 'camera') {
    cancelAnimationFrame(photoLoop);
    await e.startCamera('user');
  } else {
    await e.startStream(photoStream(source === 'photo' ? state.photo! : source));
  }
  status('Preview running.');
}

// ------------------------------------------------------------------------------------------
// Wiring

function updateButtons(): void {
  ($<HTMLButtonElement>('[data-action="cutout"]')).disabled = !state.photo;
  ($<HTMLButtonElement>('[data-action="add-layer"]')).disabled = !state.cutout;
  ($<HTMLButtonElement>('[data-action="preview"]')).disabled = !state.layers.length;
  ($<HTMLButtonElement>('[data-action="download"]')).disabled = !state.layers.length;
}

$<HTMLInputElement>('#photo').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void loadPhoto(f);
});
wrap.addEventListener('dragover', (e) => {
  e.preventDefault();
  wrap.classList.add('dragover');
});
wrap.addEventListener('dragleave', () => wrap.classList.remove('dragover'));
wrap.addEventListener('drop', (e) => {
  e.preventDefault();
  wrap.classList.remove('dragover');
  const f = e.dataTransfer?.files[0];
  if (f?.type.startsWith('image/')) void loadPhoto(f);
});
for (const id of ['keep', 'original']) $(`#${id}`).addEventListener('change', draw);
$<HTMLInputElement>('#preview-file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) await openPreview(await createImageBitmap(f));
});

document.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  const run = (p: Promise<unknown>) =>
    p.catch((err) => {
      console.error(err);
      status(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });
  switch (action) {
    case 'cutout':
      void run(cutOut());
      break;
    case 'add-layer':
      void run(addLayer());
      break;
    case 'preview':
    case 'preview-photo':
      void run(openPreview('photo'));
      break;
    case 'preview-camera':
      void run(openPreview('camera'));
      break;
    case 'preview-close':
      cancelAnimationFrame(photoLoop);
      void previewEngine?.then((eng) => eng.stopCamera());
      dialog.close();
      break;
    case 'download':
      void run(download());
      break;
  }
});

// For automated tests.
(window as unknown as { __studio: unknown }).__studio = { state, exportLayer, productJson };
updateButtons();
