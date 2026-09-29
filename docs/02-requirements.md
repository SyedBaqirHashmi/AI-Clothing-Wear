# 2. Requirements

Priority: **P0** = required for launch, **P1** = soon after launch, **P2** = later.

## 2.1 Functional requirements — Shopper widget

| ID | Requirement | Priority |
|---|---|---|
| F-01 | Open try-on from a product page in one tap; no login, no app install | P0 |
| F-02 | Start front or rear camera; switch camera at any time | P0 |
| F-03 | Show a privacy notice (EN/UR) before the camera starts; the camera starts only after the shopper taps | P0 |
| F-04 | Live overlay of the selected garment on the body, following shoulders, arms, torso, hips and legs | P0 |
| F-05 | Support garment slots: **top** (shirt, kurta, kameez), **bottom** (shalwar, trouser), **drape** (dupatta, shawl), **outer** (waistcoat) | P0 top+bottom+drape, P1 outer |
| F-06 | Multi-layer products (3-piece suits) render all pieces in the correct order | P0 |
| F-07 | Positioning guidance: "step back", "show your knees", "face the light", with a body-frame outline | P0 |
| F-08 | Upper-body mode when legs aren't visible (tops only; bottoms hidden with a message) | P0 |
| F-09 | Size selector (S/M/L/XL) that changes the overlay width and length within realistic bounds | P1 |
| F-10 | Snapshot with 3 s / 10 s countdown (phone on a shelf) | P0 |
| F-11 | Share the snapshot to WhatsApp and other apps via the Web Share API; download as a fallback | P0 |
| F-12 | Browse other products and variants (colours) from inside the widget | P1 |
| F-13 | "Add to cart" from the widget (calls the host store's cart) | P1 |
| F-14 | **Photo Mode**: capture a frame → realistic AI try-on image, with a progress state | P1 |
| F-15 | English + Urdu UI, right-to-left layout for Urdu | P0 |
| F-16 | Works in Chrome and Samsung Internet on Android, Safari on iOS, desktop Chrome/Edge | P0 |

## 2.2 Functional requirements — Store dashboard

| ID | Requirement | Priority |
|---|---|---|
| S-01 | Store sign-up, login, team members | P0 |
| S-02 | Upload a product image (JPG/PNG/WebP) or import from Shopify/WooCommerce | P0 |
| S-03 | Automatic background removal and garment cut-out | P0 |
| S-04 | Automatic garment type detection and **rig** (keypoints: collar, shoulders, sleeve ends, hem, waist…) | P0 auto with manual correction |
| S-05 | Manual rig editor: drag keypoints on the garment image | P0 |
| S-06 | Live preview on a sample body video before publishing | P0 |
| S-07 | Group pieces into a suit (kameez + shalwar + dupatta) | P0 |
| S-08 | Embed code, Shopify app install, WooCommerce plugin | P0 embed, P1 Shopify, P1 Woo |
| S-09 | Analytics: sessions, try-ons per product, shares, add-to-cart from widget | P1 |
| S-10 | Billing in PKR (JazzCash / Easypaisa / card) with plan limits | P1 |
| S-11 | Flag unstitched-fabric photos that won't work well | P2 |

## 2.3 Non-functional requirements

### Performance (the core quality promise)

| ID | Requirement | Target |
|---|---|---|
| N-01 | Camera capture and display resolution | **≥ 1280×720** (720p), portrait or landscape |
| N-02 | Rendered output frame rate | **≥ 30 fps** on Tier A and B devices; ≥ 24 fps on Tier C |
| N-03 | Pose tracking rate | ≥ 30 Hz on Tier A, ≥ 20 Hz on Tier B, ≥ 12 Hz on Tier C, with smoothing and prediction in between so rendering stays at 30 fps |
| N-04 | Motion-to-overlay latency | < 100 ms on Tier A/B |
| N-05 | Jitter while standing still | < 1% of shoulder width, frame to frame |
| N-06 | Time from tapping "Try on" to live overlay | < 4 s on repeat visits; < 12 s on first visit over 4G |
| N-07 | First-visit download | ≤ 8 MB compressed total (tracking model + runtime + UI + first garment) |
| N-08 | Repeat-visit download | ≤ 300 KB (everything else cached) |
| N-09 | Garment image size | ≤ 150 KB (WebP), ≤ 1024 px on the long side |
| N-10 | No thermal throttling in a 3-minute session on Tier B | fps stays ≥ 30 for 3 min |

**Device tiers** (to be finalised by testing real phones; examples are indicative):
- **Tier A — flagship / upper-mid:** e.g. Samsung Galaxy S / A5x series, recent iPhones, Pixel
- **Tier B — mid-range (main market):** e.g. Redmi Note series, Samsung A1x/A2x/A3x, Infinix Note, Tecno Camon (2021+)
- **Tier C — budget:** e.g. Infinix Hot / Smart, Tecno Spark, older Redmi (3–4 GB RAM)

Performance is graded honestly per tier. If a device can't meet Tier C targets, the widget offers Photo Mode instead of a laggy live view.

### Privacy and security

| ID | Requirement |
|---|---|
| N-20 | Live video is processed **only on the device**. No frames are sent anywhere in Live Mode. |
| N-21 | Photo Mode uploads one frame only after explicit consent. The image is deleted from servers within 24 h; it's never used for training without opt-in. |
| N-22 | No face data or biometric templates stored |
| N-23 | HTTPS everywhere; the widget runs in an isolated iframe so the host store can't read the camera |
| N-24 | Follow Pakistan's data-protection rules as they stand at launch (the Personal Data Protection Bill was still a draft at last check); GDPR-style practices as a baseline |

### Reliability and compatibility
- **N-30:** Graceful fallbacks: GPU → CPU tracking; Web Worker → main thread; WebGL2 → WebGL1 → "Photo Mode only".
- **N-31:** Clear messages for camera permission denied, no camera, or in-app browsers (Instagram and Facebook in-app browsers often block the camera) with an "Open in Chrome" prompt.
- **N-32:** Widget errors never break the host store page.

### Accessibility and UX
- Large touch targets (≥ 44 px), readable in bright light
- All text is translatable; Urdu uses a Nastaliq or Naskh font loaded only when Urdu is selected
