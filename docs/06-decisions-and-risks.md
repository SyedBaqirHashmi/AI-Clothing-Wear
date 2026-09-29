# 6. Decisions and Risks

## 6.1 Decisions to finalise (owner: you)

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D-1 | Live Mode approach | 2D garment image + MLS mesh warp (not 3D) | Proposed |
| D-2 | Photo Mode at launch? | Yes, as Phase 5, after Live Mode is solid | Proposed |
| D-3 | Photo Mode model source | Commercial API first (licence-safe); evaluate self-hosting later | **Needs your decision** (cost vs. control) |
| D-4 | First store platform | Shopify first, then WooCommerce (confirm with pilot brands) | **Needs your input** |
| D-5 | First garment categories | Women's 3-piece lawn suits + men's kurta/shalwar kameez | **Needs your input** |
| D-6 | Target device floor | Tier C = 3–4 GB RAM Android phones from 2020 onwards | Proposed |
| D-7 | Brand / product name + domain | — | **Needs your input** |
| D-8 | Business model | Monthly PKR subscription + Photo Mode credits | Proposed, validate in Phase 0 |
| D-9 | Team | Solo + Claude, or add a designer and a backend developer | **Needs your input** |

## 6.2 Architecture decision records (ADRs)

**ADR-001 — Run tracking on the device, not the server.**
Streaming 720p video to a server would cost a lot of bandwidth, add latency over Pakistani mobile networks, and raise serious privacy concerns. On-device tracking avoids all three and costs nothing per session.

**ADR-002 — MediaPipe Pose Landmarker (Lite) for body tracking.**
It gives full-body keypoints including knees and ankles (needed for long garments), runs on the GPU in browsers, and is Apache-2.0 licensed. Alternatives considered: MoveNet (fewer points, no visibility data for off-screen joints) and BlazePose via TF.js (larger bundle). Revisit if first-load size fails budget N-07.

**ADR-003 — Raw WebGL2 instead of Three.js.**
We draw one video quad and a few textured meshes. Raw WebGL keeps the bundle small and gives exact control over the lighting shader.

**ADR-004 — MLS deformation of 2D garment images.**
Stores already have 2D product photos. 3D garments would need a 3D artist per product, which isn't feasible at Pakistani catalogue volume (hundreds of new designs per season).

## 6.3 Risk register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Budget phones can't hold 30 fps | High | Medium | Separate render and tracking rates; downscaled tracking input; adaptive quality; Photo Mode fallback; test real phones in Phase 1 before building anything else |
| First-load size (~8 MB) too heavy on mobile data | High | Medium | CDN + Brotli + service worker cache; load the model only after "Try on" is tapped; evaluate lighter models |
| **Open-source AI try-on models are mostly non-commercial licences** (e.g. IDM-VTON, CatVTON and OOTDiffusion were released under CC BY-NC-SA–style terms at last check) | High | High | Use a commercial API for Photo Mode, or get a commercial licence; verify each licence before shipping |
| AI models trained mostly on Western clothes look wrong on long kurtas and dupattas | Medium | High | Test in Phase 5; fine-tuning data plan; keep Live Mode as the main experience |
| Live overlay looks "sticker-like" and shoppers don't trust it | High | Medium | Mesh warp + lighting + layers; honest "preview" wording; Photo Mode for realism |
| Stores only have unstitched fabric photos | Medium | High | Garment photo guidelines; stitched-sample requirement; flag in the dashboard |
| Rigging each garment by hand is too slow for stores | Medium | Medium | Category templates + automatic rig suggestion; train a rig model later |
| In-app browsers (Instagram/Facebook, where many PK shoppers come from) block the camera | Medium | High | Detect them and show "Open in Chrome" with a copy-link button |
| Privacy concerns (women's images) | High | Medium | On-device only; consent; 24 h deletion; clear Urdu notice |
| Arms crossing in front of the body get covered by the garment | Low | High | Accept for v1; segmentation-mask occlusion in v2 |
| Pakistani payment gateway onboarding delays | Medium | Medium | Start the gateway application in Phase 3; manual invoicing for pilots |

## 6.4 Open questions for pilot brands
1. What % of COD orders are refused, and what does each refusal cost?
2. Which platform: Shopify, WooCommerce, or custom?
3. Do they have stitched-sample or model photos for every design?
4. Would they pay monthly? What price range in PKR?
5. Is WhatsApp sharing important to their customers?
