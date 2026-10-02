# 08: Photo Try-On: Free-Route Stack and RunPod Plan

**Status:** proposed (Oct 2026). Replaces live AR as the first product. Live AR (`packages/engine`, `apps/widget`) is shelved, not deleted.

## Product
- **Web app** and **WhatsApp number**. The user sends:
  1. a photo of themselves;
  2. any clothing photo: a shop listing, a screenshot, a model shot, a flat-lay, or unstitched fabric.
- **They get back:**
  - an HD photo of themselves wearing it, ready to download;
  - optional **"360°" set:** 8 views of the same look (front, ¾ left/right, sides, ¾ back left/right, back) shown as a drag-to-rotate viewer.

## Principles
- **Only open models with commercial-use licences** (Apache-2.0 / MIT / BSD), so nothing can be switched off on us.
- **Free tiers everywhere except the GPU.** The GPU runs on RunPod *serverless*, so we pay per second used, with nothing to pay while idle.
- **Free checks first, in the browser:** MediaPipe and our existing studio pipeline run on the user's own phone, so bad photos never reach the GPU.

## Models (licences verified on Hugging Face)
| Job | Model | Licence | GPU need (to confirm in Phase 0) |
|---|---|---|---|
| Try-on (main) | **FASHN VTON v1.5** + FASHN Human Parser | Apache-2.0 | ~8 GB; ~5 s on H100, ~10–15 s expected on 4090; 576×864 output |
| Unstitched fabric → stitched outfit; hard cases (full 3-piece, dupatta) | **Qwen-Image-Edit-2511** (2509 as fallback; multi-image input) | Apache-2.0 | 20B: bf16 ≈ 48–80 GB; FP8 or 4-bit + Lightning (4–8 steps) LoRA ≈ 24 GB |
| 8 views from one photo | **Qwen-Image-Edit Multiple-Angles LoRA** (`fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA`, `dx8152/Qwen-Edit-2509-Multiple-angles`) | Apache-2.0 | same as above, ~1 image per view |
| 360° alternative | **Wan 2.2** TI2V-5B (turntable video → frames) | Apache-2.0 | 5B fits 24 GB; slower (minutes) |
| HD upscale | **Real-ESRGAN** x2/x4 (official, xinntao) | BSD-3 | <2 GB, ~1 s |
| Cut-out, photo checks | **BiRefNet** (server), MediaPipe (browser) | MIT / Apache-2.0 | <4 GB |
| Safety | **Falconsai/nsfw_image_detection** | Apache-2.0 | CPU or tiny GPU |

**Rejected (non-commercial or unclear licence):** CatVTON, IDM-VTON, OOTDiffusion (CC BY-NC), FLUX.1 Kontext dev, CodeFormer, Oxygen-TryOn (no licence).

## Pipeline
```
Browser: MediaPipe checks (full body? facing camera? lighting?) → resize to ≤1600 px → upload to R2
   │
Cloudflare Worker: rate limit, queue job on RunPod serverless (/run + webhook)
   │
RunPod GPU worker (one Docker image, models pre-loaded):
   1. NSFW check on both photos
   2. Garment photo type: worn / flat-lay / fabric (BiRefNet + simple classifier)
      └─ fabric → Qwen-Image-Edit: "stitch into <shalwar kameez | kurta | 3-piece>"
   3. FASHN VTON 1.5 try-on (Qwen-Image-Edit with garment reference as fallback)
   4. Paste the user's original face and hands back (identity stays exact)
   5. Real-ESRGAN x2 → ~1150×1730 HD, light sharpen, JPEG/WebP
   6. (optional, on request) Multiple-Angles LoRA → 8 views → Real-ESRGAN
   │
Results to R2 (auto-delete after 24 h) → web page / WhatsApp reply
```

## Free hosting (no server to run)
| Part | Service | Free tier |
|---|---|---|
| Web app | Cloudflare Pages | unlimited static, commercial use OK |
| API, WhatsApp webhook, job orchestration | Cloudflare Workers | 100k requests/day |
| Photos and results | Cloudflare R2 | 10 GB, free egress; lifecycle rule deletes after 24 h |
| Users, credits, jobs | Cloudflare D1 (SQLite) | 5 GB |
| Errors / analytics | Sentry, PostHog | free tiers |
| WhatsApp | Meta WhatsApp Cloud API (direct, no BSP) | replies inside the 24 h window to a user's message are free service messages |
| GPU | Modal (free monthly credit), RunPod reserve | pay per second; 0 workers when idle |

## GPU cost estimates (RunPod serverless, flex workers; verify on runpod.io/pricing)
| Request | GPU | Time | Cost/request |
|---|---|---|---|
| Try-on + HD | 24 GB (4090) ~$0.0003/s | ~12–20 s | **~$0.004–0.006 (≈ PKR 1–2)** |
| Unstitched → stitched + try-on + HD | 48 GB (L40S) ~$0.0005/s | ~30–40 s | ~$0.02 (≈ PKR 5) |
| 8-view 360° set | 48 GB ~$0.0005/s | ~60–90 s | ~$0.03–0.05 (≈ PKR 8–14) |
| Cold start (first request after idle) | | +20–60 s | partly billed; FlashBoot reduces it |

**Model storage:** bake the weights into the Docker image (free on Docker Hub/GHCR) or use a RunPod network volume (~$0.07/GB/month, ~60 GB ≈ $4/month).

**What $5 buys:** ~1,000 try-ons, or ~125 try-ons + 360° sets.

**Free beta limits:**
- 3 try-ons and one 360° set per user per day;
- small watermark;
- a global daily GPU cap so the budget can't be exhausted.

## Budget: $5 (Oct 2026), so free GPUs first
| Use | Where | Free allowance | Cost |
|---|---|---|---|
| Phase 0 bake-off, development, batch tests | **Kaggle notebooks** (T4 16 GB ×2 or P100), driven from here with the Kaggle API (`kaggle kernels push` / `output`) | ~30 GPU h/week | $0 |
| Backup for quick experiments | Google Colab free (T4) | a few h/day, not guaranteed | $0 |
| Live service (web + WhatsApp) | **Modal** serverless GPU (starter plan's monthly free credit, check current terms) | ~$30/month of credit ≈ several thousand try-ons | $0 |
| Reserve: launch day, peaks, 48 GB jobs | RunPod serverless | your $5 ≈ 1,000 try-ons | only if needed |

**Rules for the $5:**
- Spend none of it on experiments.
- Hard spending cap and a daily request cap in the API.
- 360° sets are rationed: 1 per user per day, 6 views instead of 8 until funded.

**On a 16 GB T4:**
- FASHN VTON (~8 GB) and Real-ESRGAN fit.
- Qwen-Image-Edit (20B) needs a 4-bit build with offloading. That's slower but fine for testing, and fine for production on Modal's larger GPUs.

## Phase 0: model bake-off (free, on Kaggle)
1. **Test set** (private Kaggle dataset, internal only, never public): 30 garments from `datasets/`, covering kurta, 3-piece, lawn fabric, men's shalwar kameez and long kameez, on 6 person photos (CC-licensed, different body types and poses).
2. **Kaggle notebooks**, pushed and collected automatically, one per model:
   - FASHN VTON 1.5 + Real-ESRGAN;
   - Qwen-Image-Edit-2511 (4-bit) for try-on, unstitched → stitched, and Multiple-Angles views.
3. **Score:**
   - garment fidelity (print, embroidery, length);
   - identity kept;
   - realism;
   - time;
   - VRAM.
4. **Deliverable:**
   - `docs/qa/phase0-bakeoff.md` with contact sheets;
   - the chosen model per step;
   - measured time per request, used to replace the cost estimates above.

## Phase 1: MVP (after Phase 0)
- GPU worker (`gpu/`: one `handler.py`, deployable to Modal (primary, free credit) and RunPod (reserve) from the same code).
- Cloudflare Worker API (`workers/api/`).
- Web app (`apps/web/`): Urdu/English; upload or camera; result with download and share; 360° viewer.
- WhatsApp bot: send a photo of yourself, then the cloth → result, with "360" as a reply option.
- Privacy page: photos deleted after 24 h, never used for training without consent.

## Honest limits
- **Back and side views are invented by the AI.** They're plausible, not exact.
- FASHN output is 576×864. The "HD" result is an upscale, as other apps do. True detail comes from the input photo.
- **Very long kameez, heavy dupattas and lehengas are the hardest cases.** Phase 0 measures this before we promise anything.
- **A shop's product photos belong to the shop.** The user uploads them for personal try-on; we never store or reuse them.
