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
| Body tracking | **MediaPipe Pose Landmarker** (`@mediapipe/tasks-vision` **1.0.x**, latest stable), Lite/Full models, behind a swappable `PoseBackend` interface | 33 body keypoints with visibility, actively maintained by Google, Apache 2.0. Benchmarked against an **ONNX Runtime Web + RTMPose/RTMO** backend on real phones (see ADR-005) |
| Tracking thread | **Web Worker** (ES module worker, supported natively since MediaPipe 1.0), main-thread fallback | Keeps rendering at 30 fps even when tracking is slower |
| Rendering | **WebGL2** (raw, no Three.js) | Full control; a textured deformable mesh is all we need; Three.js would add about 150 KB |
| Widget UI | Vanilla TS + CSS (or Preact if it grows, about 4 KB) | Bundle size |
| Dashboard | **Next.js + TypeScript + Tailwind** | Standard, fast to build, easy hosting |
| API | **Python FastAPI** | Same language as the image/AI pipeline |
| Database | **PostgreSQL** | Stores, products, rigs, usage |
| Queue | **Redis + RQ/Celery** | Garment processing and Photo Mode jobs |
| File storage | **Cloudflare R2** (or S3) + Cloudflare CDN | Cheap egress, CDN edge coverage for Pakistani users (to be verified with speed tests) |
| Garment cut-out | **rembg / BiRefNet**-class segmentation | Good open-source quality; check each model's licence before use |
| Photo Mode AI | Behind a `TryOnProvider` interface. Candidates (Oct 2026): FASHN v1.6, FLUX Virtual Try-On Pro, Kling Kolors (APIs); Leffa (reported MIT, self-hostable); newer research such as Oxygen-TryOn | Chosen by a blind quality test on Pakistani garments in Phase 5; switching provider is a config change |
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
  └─► [when tracker idle] downscale to 320–640 px → ImageBitmap → Worker
                                         │                           │
                         MediaPipe Pose (GPU delegate)               │
                                         │ 33 landmarks + visibility │
                                         ▼                           │
                     One-Euro filter + short-term motion prediction  │
                                         ▼                           │
                     Body model: skeleton (shoulders, elbows, wrists, │
                     hips, knees, ankles + body axes and scale);     │
                     missing points estimated from body proportions  │
                                         ▼                           │
                     Garment skinning: each mesh vertex follows      │
                     chest / pelvis / arm / leg bones (blended)      │
                                         ▼                           ▼
                     WebGL2 draw: video → bottom → top → drape → outer
                     + lighting transfer + soft edges → canvas (720p)
```

Key techniques:
1. **Decoupled rendering and tracking.** Video is drawn at the camera's full 30 fps. Tracking runs in a worker as fast as the phone allows. Between tracking results, keypoints are predicted from velocity, so the garment still moves smoothly at 30 fps on slow phones.
2. **Downscaled tracking input.** The model works at about 256 px internally, so the tracker gets 320–640 px frames instead of full 720p, which saves time between threads at little accuracy cost.
3. **One-Euro filter.** The standard filter for tracking jitter: heavy smoothing when still, low lag when moving fast.
4. **Skeletal skinning** (the technique used to animate game characters). The garment image is a mesh of about 1,500 vertices and carries its own **skeleton**: where the wearer's shoulders, elbows, wrists, hips, knees and ankles are in the image. Each vertex is attached to up to 4 bones (chest, pelvis, upper arm, forearm, thigh, shin) with smooth weights, and every frame each bone gets a 2D transform from the garment skeleton to the tracked body. Sleeves follow arms; a kurta or kameez body follows only the torso and pelvis, so it **hangs** instead of stretching when the legs move; only shalwar and trousers follow the legs. Arm bones only move pixels outside the torso column, so raising an arm never drags the kameez skirt. Cost is tiny: about 6k operations per layer per frame.
   *(Phase 1 first tried one global Moving Least Squares warp. Real-pose tests showed tearing and stretched hems because distant parts pulled on each other, so it was replaced.)*
5. **Mirror handling.** All body maths runs in camera space and the final image is mirrored once, so text and prints on garments behave like a real mirror.
6. **Lighting transfer.** The shader samples the blurred brightness of the camera image under the garment and applies it at partial strength, so room shadows and brightness fall on the garment. This is a large realism gain for little cost.
7. **Layer order.** bottom → top → drape → outer. Kameez hems cover the shalwar waist, and the dupatta goes on top.
8. **Adaptive quality.** Measure tracking time and fps. Step down the tracking input size, then the tracking rate, then mesh density. Never drop video below 720p30 unless the camera itself can't deliver it.
9. **Guidance.** Keypoint visibility decides which messages to show and whether bottoms can render (bottoms need knees and ankles visible).

### Garment format (per garment layer)
```json
{
  "id": "maroon-kameez",
  "slot": "top",
  "coverage": "knees",
  "image": "garments/maroon-kameez.webp",
  "size": [800, 1400],
  "joints": {
    "R.shoulder": [0.31, 0.08], "L.shoulder": [0.69, 0.08],
    "R.elbow": [0.21, 0.30], "L.elbow": [0.79, 0.30],
    "R.hip": [0.39, 0.38], "L.hip": [0.61, 0.38]
  },
  "bones": ["chest", "pelvis", "R.upperArm", "L.upperArm", "R.forearm", "L.forearm"],
  "opacity": 1
}
```
- `joints`: where the wearer's joints are in the image, as fractions (0–1). `R` = wearer's right = image left. Only **shoulders and hips are required**; missing joints are filled in from body proportions. This is what the Phase 2 rig editor asks a store to mark: "tap the shoulders, elbows, hips".
- `bones`: optional; defaults by slot (top → torso + arms, bottom → pelvis + legs, drape → torso).
- `coverage`: lowest body region the garment reaches; drives guidance ("show your knees").
- The sample garments are generated by `scripts/make-garments.ts`, which draws each outline with **anchor expressions** on a reference mannequin (e.g. `R.elbow>R.wrist@0.5 n:0.11` = halfway down the forearm, 0.11 shoulder-widths outward), so artwork and skeleton always match.

### Data and caching
- **Measured (Phase 1 build):** WebAssembly runtime 11.8 MB raw / **3.4 MB gzip**; Lite model **5.8 MB** (already compressed, doesn't shrink further); app code **16 KB** gzip + worker ~44 KB gzip. **First visit ≈ 8.5 MB**, just over the 8 MB budget (N-07). Next steps: Brotli on the CDN, service-worker caching (Phase 2), then test a lighter model if real 4G load times miss N-06.
- All runtime and model files are self-hosted (`scripts/fetch-assets.mjs`), never loaded from a third-party CDN at runtime.
- Garment images are WebP, ≤ 1024 px, ≤ 150 KB, preloaded for the current product only.

## 3.4 Photo Mode (realistic AI image)
1. Shopper taps "Realistic photo" → consent dialog → one frame (≤ 1024 px JPEG) is uploaded.
2. The API queues a job: person image + garment image(s) → try-on model on a GPU → result stored under a signed URL for 24 h.
3. The widget polls for the result or receives it over a server-sent event (target: under 20 s) and shows share and download buttons.
4. Each generation is metered against the store's plan.

## 3.5 Garment pipeline (dashboard upload)
upload → background removal → classify slot/type → predict garment joints → shopper-style preview on sample videos → manual correction → publish (WebP + rig JSON to the CDN).

Phase 2 uses heuristics plus manual rig editing. Automatic joint prediction with a small trained keypoint model comes later, once there are a few hundred manually rigged garments to train it on.

## 3.6 Repository layout
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
