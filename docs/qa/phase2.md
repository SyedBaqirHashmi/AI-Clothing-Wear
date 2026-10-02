# Phase 2 QA: Widget + Garment Tooling

## What was built
| Area | Status | Where |
|---|---|---|
| Embeddable loader `tryon.js` (2.7 KB): button attribute, JS API, events, back-button close, Escape | Done | `apps/widget/src/loader.ts` |
| Isolated iframe widget, origin-checked messaging, close button, add-to-cart hand-off with toast | Done | `apps/widget/src/main.ts`, `protocol.ts` |
| Per-store catalogs (`catalog/<store>.json`), product preselected from the store page | Done | `apps/widget/public/catalog/` |
| Model preloading while the privacy note is shown | Done | `main.ts` (`loadEngine`) |
| Service worker caching; versioned model folders (`mediapipe/1.0.1/`) | Done | `public/sw.js`, `scripts/fetch-assets.mjs` |
| Demo store page showing a real embed | Done | `apps/widget/demo-store.html` |
| **Garment Studio**: AI clothes cut-out, automatic joints, plain-background removal, edge refinement, gap filling, suit splitting, preview (photo / other photo / webcam), WebP export + catalog JSON | Done | `apps/studio` |
| Engine: `startStream()` for previews; sleeve/torso split that follows the photo's actual arm positions | Done | `packages/engine` |
| Shopify snippet (size → variant → `/cart/add.js`) | Done, tested on a simulated store | `integrations/shopify` |
| WooCommerce plugin (settings page, button, size → attribute → form submit) | Done, tested on a simulated store, PHP lint clean | `integrations/woocommerce` |
| Docs: integration guide, garment photo guidelines | Done | `docs/integration.md`, `docs/garment-guidelines.md` |

## Automated results
| Test | Result |
|---|---|
| Unit tests (engine + Studio image processing) | 21 passing |
| `npm run e2e`: 5 outfits + main-thread fallback + Urdu UI + embedded store flow on a 390×844 phone (open → camera → size L → add to cart → store cart updated → close → back button) | All pass, 0 console errors |
| `npm run e2e:studio`: real photo → AI cut-out → joints → top + bottom layers → preview on the same and a mirrored photo | Pass, 0 errors |
| `npm run e2e:integrations`: Shopify variant matching (incl. sold-out size), WooCommerce dropdown + form submit | Pass |
| `npm run e2e:caching` (production build, bytes counted server-side) | First visit **8.4 MB** gzip (model 4.9 MB, runtime 3.4 MB); repeat visit **21 KB** |

## Against the Phase 2 exit criteria
| Criterion | Status |
|---|---|
| Widget embedded on a test Shopify store and a test WooCommerce store | **Not yet.** Code is tested on simulated stores; needs real test stores (a Shopify development store is free through a Partner account; WooCommerce needs any WordPress host). |
| Repeat-visit budget N-08 (≤ 300 KB) | ✅ 21 KB |
| First-visit budget N-07 (≤ 8 MB) | ⚠️ 8.4 MB. Options: Brotli on the CDN (the runtime compresses better than with gzip), or a smaller tracking model. Measure real 4G load time first (N-06). |
| Load time on real 4G | Not measured yet (needs a phone) |

## Not done / next
- Real Shopify and WooCommerce test stores (needs your accounts).
- Phone measurements from Phase 1 are still pending.
- Studio output on real brand photos: needs a few sample photos in `datasets/` (kept out of git).

## Real-photo testing (after Phase 2)
| Test | Result |
|---|---|
| Import of 375 real photos (298 Pakistani catalogue photos, internal only; 76 CC-licensed Openverse photos; 1 sample) | 257 ready, 116 skipped (unstitched fabric / no person), 0 failed; person detected in 100% of usable photos |
| Real garments in the live try-on on a standing person (portrait phone camera) | Garments sit on torso and shoulders, sleeves follow arms, dupattas hang; prints and embroidery stay sharp |

Fixes made from real photos: skin carved out and hand holes filled with fabric colour; stray fragments removed; conservative kameez/shalwar split; dupattas beside the arm no longer fly with a raised arm (arm bones only move sleeve pixels); a broken layer is skipped instead of failing the try-on; full imports rewrite the store catalog.

Open issues:
- Automatic kameez/shalwar split triggers rarely (~3%), so most outfits are one layer; the shalwar won't follow leg movement.
- Hand patches on printed fabric become soft solid colour (needs AI inpainting).
- Garment sleeves shorter than the shopper's own sleeves let the shopper's clothes show at the wrist.
- No hand-labelled photos yet for a hem-accuracy number (needs a free Roboflow API key).
