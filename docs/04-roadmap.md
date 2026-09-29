# 4. Roadmap and Milestones

Durations assume one full-time developer working with Claude. Each phase ends with a **demo and a go/no-go check** against its exit criteria.

## Phase 0 — Plan and validate (1 week)
- Finalise these documents (decisions in section 6)
- Talk to 3–5 Pakistani clothing brands: COD refusal rates, platforms used, willingness to pay, image formats they have
- Collect 5–10 test phones across Tiers A/B/C (own, friends, or a device-testing service)
- Collect 20 real garment images (kurta, kameez, shalwar, dupatta, 3-piece suit) with permission

**Exit:** decisions signed off; at least 2 brands willing to pilot.

## Phase 1 — Try-On Engine (3–4 weeks) ← highest risk, done first
- Camera module (720p30, front/rear, orientation)
- Pose worker + fallbacks, One-Euro filtering + prediction
- Body model (anchors, estimation of missing points)
- MLS garment warp + WebGL2 renderer + lighting transfer + layers
- Adaptive quality + performance heads-up display (fps, tracking Hz, latency)
- Guidance system + upper-body mode
- Demo page with 5 hand-rigged Pakistani garments, including a 3-piece suit
- Unit tests + automated end-to-end test with a recorded person video

**Exit (measured on real phones):** 720p at ≥ 30 fps on Tier A/B, ≥ 24 fps on Tier C; jitter and latency within the section 2.3 targets; 10 non-technical testers say the garment "stays on me".

## Phase 2 — Widget + garment tooling (3 weeks)
- Embeddable widget (iframe + `<script>` loader), privacy notice, EN/UR + right-to-left
- Snapshot + countdown + WhatsApp share
- Service worker caching; first-load and repeat-load budgets met
- Internal rig editor (drag keypoints on a garment image) + preview
- Background-removal script for store images

**Exit:** widget embedded on a test Shopify store and a test WooCommerce store; load budgets met on 4G.

## Phase 3 — Backend + dashboard (4 weeks)
- FastAPI + Postgres + R2; stores, products, rigs, embed keys
- Dashboard: upload → auto cut-out → rig editor → preview → publish
- Analytics events (open, try-on, share, add-to-cart)

**Exit:** a pilot brand onboards 20 products without our help.

## Phase 4 — Pilot (4 weeks, overlaps with Phase 5)
- Go live with 2–3 brands; weekly fps/error/device reports
- A/B test: try-on button shown vs. hidden → conversion and COD refusal rates

**Exit:** measurable conversion lift or refusal drop; no critical bugs.

## Phase 5 — Photo Mode (3 weeks)
- Integrate the chosen AI try-on provider; consent + 24 h deletion
- Test realism on Pakistani garments (long kurtas, dupattas); decide on fine-tuning
- Metering per plan

## Phase 6 — Launch (3 weeks)
- Shopify app listing, WooCommerce plugin release
- PKR billing (local gateway)
- Marketing site in EN/UR, onboarding docs for stores

## Later (v2+)
- Automatic rig prediction model
- Size recommendation from body proportions
- Arm-in-front-of-body occlusion using the segmentation mask
- Fine-tuned Photo Mode model for South Asian clothing
- Native app SDKs if stores ask for them

## Timeline summary
| Phase | Weeks | Cumulative |
|---|---|---|
| 0 Plan | 1 | 1 |
| 1 Engine | 4 | 5 |
| 2 Widget | 3 | 8 |
| 3 Backend | 4 | 12 |
| 4 Pilot | 4 (parallel) | — |
| 5 Photo Mode | 3 | 15 |
| 6 Launch | 3 | ~18 weeks |
