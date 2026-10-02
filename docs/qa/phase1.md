# Phase 1 QA: Try-On Engine

## What was built
| Area | Status | Where |
|---|---|---|
| Camera at 720p / 30 fps, front/back switch, step-by-step fallbacks | Done | `packages/engine/src/camera.ts` |
| Pose tracking in a Web Worker (MediaPipe 1.0.1, GPU → CPU fallback, worker → main-thread fallback) | Done | `packages/engine/src/pose/` |
| Swappable `PoseBackend` interface (ADR-005) | Done | `pose/backend.ts` |
| One-Euro smoothing + motion prediction + estimation of hidden joints | Done | `body.ts`, `one-euro.ts` |
| Garment skinning (chest, pelvis, arms, legs) | Done | `skinning.ts`, `garment.ts` |
| WebGL2 renderer: mirrored video, layered garments, lighting/exposure/tint matching | Done | `render/renderer.ts` |
| Adaptive quality (tracker input 640 → 320 px when tracking < 20 Hz) | Done | `engine.ts` |
| Guidance (step back / closer / show knees / face the light) + upper-body mode | Done | `guidance.ts` |
| Demo: 5 outfits (2 women's 3-piece suits, 2 kurtas, 1 shalwar kameez), sizes S–XL, timer, snapshot, WhatsApp share, EN/UR, performance panel | Done | `apps/demo` |
| Unit tests (15) | Passing | `packages/engine/test` |
| End-to-end test (fake 720p camera with a real person, 7 runs incl. fallback and Urdu) | Passing | `tests/e2e/run.mjs` |

## Automated results (cloud test machine, no GPU)
| Check | Result |
|---|---|
| Camera resolution delivered to the engine | 1280×720 ✅ |
| Person detected, garments drawn, all 5 outfits | ✅ |
| Worker + GPU delegate path | ✅ (`GPU/worker`) |
| Main-thread fallback path | ✅ (`GPU/main`) |
| Console errors | 0 ✅ |
| Hard pose (lunge, arms out, body turned) | Sleeves follow arms, kameez hangs, trousers follow legs ✅ |
| Speed | 5–8 fps, tracking 2–3 Hz. **Not meaningful:** the test machine renders with a software GPU (~1.5 s per tracking pass). Real phones use their GPU. |
| First-visit download | ≈ 8.5 MB (target 8 MB). See architecture §3.3. |

**What automated tests cannot prove:** real fps, latency, heat, and how the garment looks on a moving person. That needs the phone test below.

## Phone test (you)
### Run it
Option A, on your computer and phone over the same Wi-Fi:
```bash
npm install
npm run dev:phone          # prints a "Network: https://192.168.x.x:5173" address
```
Open that address on the phone. Accept the certificate warning (it's your own computer), tap **Start camera**, allow the camera.

Option B, a public https link: enable GitHub Pages (Settings → Pages → Source: GitHub Actions) and merge to `main`. The `Deploy demo` workflow publishes it.

Useful URL options: `?model=full` (more accurate, slower model), `?worker=0` (force main thread), `?camera=back`, `?lang=ur`, `?stats=0` (hide the performance panel).

### Checklist (fill one row per phone)
Tap the chart icon to show the performance panel. Read the numbers after 30 seconds of use.

| Phone (model, RAM) | Browser | video | render fps | track Hz | infer ms | input px | mode | Garment stays on? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

Scenarios (from `docs/05-process.md` §5.4): stand still 10 s · raise arms · turn 30° left/right · walk towards/away · dim room · phone on shelf with rear camera and 10 s timer · 3-minute session.

### Pass criteria (Phase 1 exit)
- video 1280×720 (or 720×1280 upright) and render ≥ 30 fps on mid-range phones, ≥ 24 on budget phones
- garment doesn't visibly shake when standing still
- garment keeps up with normal movement (no obvious lag)

## Known limitations (planned fixes)
- Arms crossed in front of the body are covered by the kameez (needs the segmentation mask, v2).
- Turning fully sideways or away: garments are front-view images.
- Sample garments are drawn artwork. Real products need photos (Phase 2 tooling).
- The two dupatta samples hang as two front panels; real dupatta photos will look better.
- Lighting-match strengths (`shade`, `ambient` in `engine.ts`) are first guesses, to be tuned on real rooms.
