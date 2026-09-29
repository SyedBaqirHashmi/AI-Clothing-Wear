# 3. Architecture and Tech Stack

## 3.1 System overview

```
 SHOPPER'S PHONE (browser)                           OUR CLOUD
┌──────────────────────────────────────┐        ┌──────────────────────────────┐
│ Store product page                   │        │ API (FastAPI)                │
│   └─ <script> embed → iframe widget  │◄──────►│  - stores, products, rigs    │
│                                      │  JSON  │  - analytics events          │
│ Try-On Engine (TypeScript)           │        │  - billing / plan limits     │
│   Camera 720p30 ──► Pose worker      │        ├──────────────────────────────┤
│        │            (MediaPipe)      │        │ Garment pipeline (workers)   │
│        ▼                ▼            │        │  - background removal        │
│   WebGL2 renderer ◄─ Body model      │        │  - garment type + rig detect │
│        ▲            + garment warp   │        │  - WebP optimisation         │
│        │                             │        ├──────────────────────────────┤
│   Garment assets (CDN, cached)       │        │ Photo Mode (GPU, on demand)  │
│                                      │ 1 frame│  - AI try-on model           │
│   Photo Mode: capture ───────────────┼───────►│  - result → signed URL       │
└──────────────────────────────────────┘ consent└──────────────────────────────┘
                                                  Postgres · Redis queue · R2/S3 · CDN
 STORE ADMIN (laptop)
 Dashboard (Next.js) ──► API        Shopify app / WooCommerce plugin ──► API
```

## 3.2 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Try-On Engine | **TypeScript**, no UI framework, built with **Vite** | Smallest bundle for slow networks; reusable in the widget, dashboard preview and apps |
| Body tracking | **MediaPipe Pose Landmarker** (`@mediapipe/tasks-vision`), Lite model by default | 33 body keypoints including elbows, wrists, knees and ankles; runs in the browser on GPU; free (Apache 2.0) |
| Tracking thread | **Web Worker** (classic worker), main-thread fallback | Keeps rendering at 30 fps even when tracking is slower |
| Rendering | **WebGL2** (raw, no Three.js) | Full control; a textured deformable mesh is all we need; Three.js would add about 150 KB |
| Widget UI | Vanilla TS + CSS (or Preact if it grows, about 4 KB) | Bundle size |
| Dashboard | **Next.js + TypeScript + Tailwind** | Standard, fast to build, easy hosting |
| API | **Python FastAPI** | Same language as the image/AI pipeline |
| Database | **PostgreSQL** | Stores, products, rigs, usage |
| Queue | **Redis + RQ/Celery** | Garment processing and Photo Mode jobs |
| File storage | **Cloudflare R2** (or S3) + Cloudflare CDN | Cheap egress, CDN edge coverage for Pakistani users (to be verified with speed tests) |
| Garment cut-out | **rembg / BiRefNet**-class segmentation | Good open-source quality; check each model's licence before use |
| Photo Mode AI | Commercial try-on API at launch (e.g. FASHN or similar), self-hosted model later | See licensing risk in section 6 |
| GPU hosting | Replicate / fal.ai / RunPod (pay per second) | No idle GPU cost at small scale |
| Store billing | Safepay / PayFast / JazzCash / Easypaisa | Local merchants |
| Hosting | Vercel (dashboard), Fly.io/Railway or a VPS (API), Cloudflare (assets, widget JS) | Low ops |
| Monitoring | Sentry (errors), custom performance telemetry (fps per device model) | We must see real-device fps |
| Testing | Vitest (unit), Playwright (end-to-end with a fake camera video), a real-device lab | See section 5 |

## 3.3 Try-On Engine (the core — where quality comes from)

### Frame pipeline
```
camera frame (720p, 30 fps)
  ├─► [every frame]  upload to GPU texture ─────────────────────────┐
  └─► [when tracker idle] downscale to ~480 px → ImageBitmap → Worker│
                                         │                           │
                         MediaPipe Pose (GPU delegate)               │
                                         │ 33 landmarks + visibility │
                                         ▼                           │
                     One-Euro filter + short-term motion prediction  │
                                         ▼                           │
                     Body model: anchor points (neck, shoulder edges,│
                     elbows, wrists, waist, hips, knees, ankles);    │
                     missing points estimated from body proportions  │
                                         ▼                           │
                     Garment warp: MLS mesh deformation              │
                     (garment rig points → body anchor points)       │
                                         ▼                           ▼
                     WebGL2 draw: video → bottom → top → drape → outer
                     + lighting transfer + soft edges → canvas (720p)
```

Key techniques:
1. **Decoupled rendering and tracking.** Video is drawn at the camera's full 30 fps. Tracking runs in a worker as fast as the phone allows. Between tracking results, keypoints are predicted from velocity, so the garment still moves smoothly at 30 fps on slow phones.
2. **Downscaled tracking input.** The model works at about 256 px internally, so sending 480 px frames instead of 720p frames saves bandwidth between threads at no accuracy cost.
3. **One-Euro filter.** The standard filter for tracking jitter: heavy smoothing when still, low lag when moving fast.
4. **Moving Least Squares (MLS) deformation.** The garment image is a mesh of about 800 vertices. Each garment has **rig points** (collar, shoulder seams, elbows, sleeve ends, waist, hem…) mapped to body **anchor points**. MLS bends the mesh so sleeves follow arms and a kurta or shalwar follows the legs, instead of a flat rectangular sticker. The cost is tiny: about 10k operations per frame.
5. **Mirror handling.** All body maths runs in camera space and the final image is mirrored once, so text and prints on garments behave like a real mirror.
6. **Lighting transfer.** The shader samples the blurred brightness of the camera image under the garment and applies it at partial strength, so room shadows and brightness fall on the garment. This is a large realism gain for little cost.
7. **Layer order.** bottom → top → drape → outer. Kameez hems cover the shalwar waist, and the dupatta goes on top.
8. **Adaptive quality.** Measure tracking time and fps. Step down the tracking input size, then the tracking rate, then mesh density. Never drop video below 720p30 unless the camera itself can't deliver it.
9. **Guidance.** Keypoint visibility decides which messages to show and whether bottoms can render (bottoms need knees and ankles visible).

### Garment rig format (per garment layer)
```json
{
  "id": "kameez-maroon-001",
  "slot": "top",
  "image": "kameez-maroon-001.webp",
  "size": [800, 1400],
  "rig": [
    { "u": 0.50, "v": 0.02, "anchor": "neck" },
    { "u": 0.28, "v": 0.07, "anchor": "R.shoulder" },
    { "u": 0.72, "v": 0.07, "anchor": "L.shoulder" },
    { "u": 0.12, "v": 0.38, "anchor": "R.shoulder>R.elbow@1.3" },
    { "u": 0.30, "v": 0.45, "anchor": "R.waist" },
    { "u": 0.25, "v": 0.97, "anchor": "R.hip>R.knee@1.05" }
  ]
}
```
- `u, v`: position in the garment image (0–1)
- `anchor`: a named body point; `A>B@t` means "t of the way from A to B", which lets one scheme express any sleeve or hem length

### Data and caching
- Tracking model (~5.5 MB) and the WebAssembly runtime (~9 MB uncompressed, ~3 MB compressed) are hosted on our CDN, served with Brotli, and cached by a service worker, so repeat visits download almost nothing. **This is the biggest first-load cost; measuring it on real Pakistani 4G is a Phase 1 task.** A lighter tracking model is the fallback plan.
- Garment images are WebP, ≤ 1024 px, ≤ 150 KB, preloaded for the current product only.

## 3.4 Photo Mode (realistic AI image)
1. Shopper taps "Realistic photo" → consent dialog → one frame (≤ 1024 px JPEG) is uploaded.
2. The API queues a job: person image + garment image(s) → try-on model on a GPU → result stored under a signed URL for 24 h.
3. The widget polls for the result or receives it over a server-sent event (target: under 20 s) and shows share and download buttons.
4. Each generation is metered against the store's plan.

## 3.5 Garment pipeline (dashboard upload)
upload → background removal → classify slot/type → predict rig points → shopper-style preview on sample videos → manual correction → publish (WebP + rig JSON to the CDN).

Phase 2 uses heuristics plus manual rig editing. Automatic rig prediction with a small trained keypoint model comes later, once there are a few hundred manually rigged garments to train it on.

## 3.6 Repository layout (planned)
```
/packages/engine        Try-On Engine (TS library)
/apps/widget            Embeddable widget (Vite) – uses engine
/apps/dashboard         Store dashboard (Next.js)
/services/api           FastAPI service
/services/pipeline      garment processing + Photo Mode workers
/integrations/shopify   Shopify app
/integrations/woocommerce  WordPress plugin
/docs                   these documents
```
Monorepo with npm workspaces (JS) and a separate Python project under `/services`.
