import { completeJoints, TryOnEngine, type Coverage, type GarmentLayerSpec, type JointName, type Slot, type Vec2 } from '@tryon/engine';
import { closeHoles, guidedFilter, inpaint, levels, luminance, maskBounds, removePlainBackground, splitMask, type Rgba } from './imaging.ts';
import { Vision } from './vision.ts';
import './styles.css';

/** Working resolution: enough detail for a 1024 px garment texture, fast to process. */
const WORK_MAX = 1600;
const EXPORT_MAX = 1024;
const ASSETS = `${import.meta.env.BASE_URL}mediapipe/`;
const JOINT_NAMES: JointName[] = [
  'R.shoulder', 'L.shoulder', 'R.elbow', 'L.elbow', 'R.wrist', 'L.wrist',
  'R.hip', 'L.hip', 'R.knee', 'L.knee', 'R.ankle', 'L.ankle',
];

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
  pixels: null as Rgba | null, // photo pixels, with gaps filled after cut-out
  alpha: null as Float32Array | null, // cut-out mask (before split)
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
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  state.name = file.name.replace(/\.[^.]+$/, '');
  state.photo = c;
  state.pixels = null;
  state.alpha = null;
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

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'product';

/** Default joint positions for a front-on garment filling the frame (for flat-lays). */
function templateJoints(w: number, h: number, box = { x: 0, y: 0, w, h }): Record<JointName, Vec2> {
  const cx = box.x + box.w / 2;
  const sw = box.w * 0.42;
  const at = (dx: number, fy: number): Vec2 => ({ x: cx + dx * sw, y: box.y + fy * box.h });
  return {
    'R.shoulder': at(-0.5, 0.08), 'L.shoulder': at(0.5, 0.08),
    'R.elbow': at(-0.75, 0.32), 'L.elbow': at(0.75, 0.32),
    'R.wrist': at(-0.9, 0.55), 'L.wrist': at(0.9, 0.55),
    'R.hip': at(-0.31, 0.45), 'L.hip': at(0.31, 0.45),
    'R.knee': at(-0.33, 0.8), 'L.knee': at(0.33, 0.8),
    'R.ankle': at(-0.33, 1.0), 'L.ankle': at(0.33, 1.0),
  };
}

// ------------------------------------------------------------------------------------------
// Cut-out

async function cutOut(): Promise<void> {
  const photo = state.photo;
  if (!photo) return;
  const w = photo.width;
  const h = photo.height;
  const pixels: Rgba = { data: photo.getContext('2d')!.getImageData(0, 0, w, h).data, width: w, height: h };
  let alpha: Float32Array;
  if (kind() === 'model') {
    status('Finding the clothes and the wearer’s joints…');
    const v = await getVision();
    const coarse = v.segmentClothes(photo, checked('accessories'));
    // Snap the low-resolution mask to the real garment edges.
    const r = Math.max(4, Math.round(Math.max(w, h) * 0.006));
    alpha = levels(guidedFilter(luminance(pixels), coarse, w, h, r, 1e-3), 0.3, 0.7);
    const pose = v.detectPose(photo);
    if (pose) {
      const t = templateJoints(w, h);
      for (const j of JOINT_NAMES) state.joints[j] = pose.joints[j] ?? t[j];
    }
    status(pose ? 'Cut out. Joints found automatically; check them.' : 'Cut out. No person found: place the joints by hand.');
  } else {
    status('Removing the background…');
    await new Promise((r) => setTimeout(r, 20));
    alpha = removePlainBackground(pixels);
    const box = maskBounds(alpha, w, h, 0.5, 0);
    if (box) state.joints = templateJoints(w, h, box);
    status('Background removed. Place the joints on the garment.');
  }
  if (checked('fill')) {
    const { alpha: closed, added } = closeHoles(alpha, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.012)));
    inpaint(pixels, added);
    alpha = closed;
  }
  state.pixels = pixels;
  state.alpha = alpha;
  // Default split line: halfway between the hips and knees (a typical kameez hem).
  state.splitY = (state.joints['R.hip'].y + state.joints['R.knee'].y) / 2 + (state.joints['R.knee'].y - state.joints['R.hip'].y) * 0.4;
  updateButtons();
  draw();
}

function layerAlpha(): Float32Array | null {
  if (!state.alpha || !state.photo) return null;
  const keep = val('keep');
  return keep === 'all' ? state.alpha : splitMask(state.alpha, state.photo.width, state.photo.height, state.splitY, keep as 'above' | 'below');
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
    const src = state.pixels!.data;
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

function coverageFor(bottomY: number): Coverage {
  const j = state.joints;
  const hip = (j['R.hip'].y + j['L.hip'].y) / 2;
  const knee = (j['R.knee'].y + j['L.knee'].y) / 2;
  const ankle = (j['R.ankle'].y + j['L.ankle'].y) / 2;
  if (bottomY > ankle - (ankle - knee) * 0.3) return 'ankles';
  if (bottomY > hip + (knee - hip) * 0.5) return 'knees';
  return 'torso';
}

async function exportLayer(): Promise<DraftLayer | null> {
  const alpha = layerAlpha();
  const pixels = state.pixels;
  const photo = state.photo;
  if (!alpha || !pixels || !photo) return null;
  const box = maskBounds(alpha, photo.width, photo.height);
  if (!box) return null;
  const k = Math.min(1, EXPORT_MAX / Math.max(box.w, box.h));
  const full = new ImageData(box.w, box.h);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const s = (box.y + y) * photo.width + box.x + x;
      const d = (y * box.w + x) * 4;
      full.data[d] = pixels.data[s * 4];
      full.data[d + 1] = pixels.data[s * 4 + 1];
      full.data[d + 2] = pixels.data[s * 4 + 2];
      full.data[d + 3] = alpha[s] * 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = box.w;
  tmp.height = box.h;
  tmp.getContext('2d')!.putImageData(full, 0, 0);
  const out = document.createElement('canvas');
  out.width = Math.round(box.w * k);
  out.height = Math.round(box.h * k);
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(tmp, 0, 0, out.width, out.height);
  let blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/webp', 0.9));
  let ext: 'webp' | 'png' = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
    ext = 'png';
  }
  if (!blob) return null;

  const slot = val('slot') as Slot;
  const pid = slug(val('pid') || state.name);
  const id = `${pid}-${slot}${state.layers.some((l) => l.spec.slot === slot) ? `-${state.layers.length + 1}` : ''}`;
  const joints: GarmentLayerSpec['joints'] = {};
  for (const name of JOINT_NAMES) {
    const p = state.joints[name];
    joints[name] = [+((p.x - box.x) / box.w).toFixed(4), +((p.y - box.y) / box.h).toFixed(4)];
  }
  const url = URL.createObjectURL(blob);
  const spec: GarmentLayerSpec = {
    id,
    slot,
    image: url,
    size: [out.width, out.height],
    joints,
    coverage: coverageFor(box.y + box.h),
    ...(Number(val('opacity')) < 1 ? { opacity: Number(val('opacity')) } : {}),
  };
  completeJoints(spec); // validates shoulders + hips
  return { spec, blob, url, ext };
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

/** Average colour of the first top layer, for the product swatch. */
async function swatch(): Promise<string> {
  const layer = state.layers.find((l) => l.spec.slot === 'top') ?? state.layers[0];
  const bmp = await createImageBitmap(layer.blob);
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const cx = c.getContext('2d')!;
  cx.drawImage(bmp, 0, 0, 32, 32);
  const d = cx.getImageData(0, 0, 32, 32).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  const hex = (v: number) => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Catalog entry in the widget's format (images referenced as garments/<id>.<ext>). */
async function productJson(): Promise<object> {
  const pid = slug(val('pid') || state.name);
  return {
    id: pid,
    gender: val('gender'),
    name: { en: val('name-en') || pid, ur: val('name-ur') || val('name-en') || pid },
    price: Number(val('price')) || 0,
    swatch: await swatch(),
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
  ($<HTMLButtonElement>('[data-action="add-layer"]')).disabled = !state.alpha;
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
