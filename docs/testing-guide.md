# Testing Guide: Real Phones, Real Clothes, Real Stores

Three tests take this from "works in automated tests" to production-ready. Each says what you do and what to send back.

## 0. One-time setup (≈ 15 minutes)

### a) Make the repository private
GitHub → repository **Settings → General → Danger Zone → Change visibility → Private**.
This protects the code and any brand photos you upload.

### b) Put the try-on online (free, https, works with a private repo): Cloudflare Pages
1. Create a free account at cloudflare.com.
2. Dashboard → **Workers & Pages → Create → Pages → Connect to Git** → choose `AI-Clothing-Wear`.
3. Settings:
   - Production branch: `claude/virtual-clothing-try-on-v2wftm`
   - Build command: `npm run build:site`
   - Build output directory: `apps/widget/dist`
   - Environment variable: `NODE_VERSION` = `22`
4. **Save and Deploy.** You get a link like `https://ai-clothing-wear.pages.dev`:
   - `/`: the try-on
   - `/demo-store.html`: the try-on embedded in a sample store page
   - `/studio/`: the Garment Studio

Every push redeploys automatically. Cloudflare also serves Brotli compression, which brings the first download below the gzip figure measured in tests.

*(If the repository stays public, GitHub Pages also works: Settings → Pages → Source: GitHub Actions. The included workflow deploys on every push.)*

## 1. Phone test (the biggest unknown)
Open the link on each phone in **Chrome** (Android) or **Safari** (iPhone).

1. Tap **Start camera** → allow the camera.
2. Prop the phone up and stand back until the whole outfit shows.
3. Try each outfit: stand still, raise your arms, turn a little, walk closer and back.
4. Tap the **chart icon** → after ~30 seconds tap **Copy test report** → paste it in the chat.

Also tell me in a sentence or two: did it look attached to your body? Any shaking or lag? Anything ugly?

Phones that matter most, in order:
1. A **budget phone** (Infinix Hot / Smart, Tecno Spark, Redmi A-series): the hardest case.
2. A **mid-range phone** (Redmi Note, Samsung A1x–A3x, Infinix Note): the main market.
3. Any iPhone.

Also try once on mobile data, not Wi-Fi, for first-load time (a stopwatch is fine).

## 2. Real clothes
### a) Open datasets (automatic, hundreds of garments)
The system must work for *any* shalwar kameez, kurta or 3-piece suit, so it's tested on large sets of openly licensed photos, not one brand's catalogue:

| Source | What | Licence | Needs |
|---|---|---|---|
| [Openverse](https://openverse.org) | CC-licensed photos ("shalwar kameez", "kurta", …), commercial-use licences only | CC BY / CC BY-SA / CC0 | nothing |
| [Pexels](https://www.pexels.com) | free stock photos | Pexels License (commercial use allowed) | free API key → `PEXELS_API_KEY` |
| [Pakistani clothes](https://universe.roboflow.com/cooking-pot/pakistani-clothes), [Dupatta](https://universe.roboflow.com/cooking-pot/dupatta) (Roboflow) | 470+ photos with **kameez / shalwar / dupatta boxes**: used to *measure* hem-detection accuracy | CC BY 4.0 | free account → `ROBOFLOW_API_KEY` |
| [IndoFashion](https://indofashion.readthedocs.io) | 106k e-commerce images, 15 ethnic-wear classes | research use, access by form | request access (later, for training models) |
| [Pakistani fashion dataset](https://huggingface.co/datasets/mohummadmahad/pakistani_fashion_dataset) (Hugging Face) | ~10k photos from Pakistani e-commerce: the most realistic test set | photos belong to the brands → **internal accuracy testing only** (`datasets/internal-*`) | nothing |

```bash
npm run datasets -- --openverse              # no key needed
npm run datasets -- --hf-pk --limit 300      # internal test set (brand photos: never shown or shipped)
PEXELS_API_KEY=… npm run datasets -- --pexels
ROBOFLOW_API_KEY=… npm run datasets -- --roboflow
npm run import                               # → datasets/report.html with accuracy figures
```
`npm run import -- --store <folder> --limit 40` processes a subset for quick tuning rounds.

Every photo is saved with its licence and author (`source.json`). Photos are never scraped from search engines or shops: a picture being visible online doesn't make it free to use.

**Network access:** the cloud development environment blocks these hosts by default. Allow them in the session's environment settings (title bar → cloud environment menu → Edit → Network access): `api.openverse.org`, `api.pexels.com`, `images.pexels.com`, `api.roboflow.com`, `universe.roboflow.com`, `source.roboflow.com`, `storage.googleapis.com`. Openverse photos come from many hosts (Flickr, Wikimedia, …), so a broader access level works best for it. On your own computer, no setup is needed.

### b) Brand photos (pilots)
1. Collect photos (see `datasets/README.md` and `docs/garment-guidelines.md`): 5–10 products per brand to start, mixing 3-piece suits, kurtas and kameez.
2. Upload them to the repository's **`datasets` branch**: on github.com switch to `datasets` → Add file → Upload files, keeping the `datasets/<store>/<product>/photo.jpg` layout.
3. Tell me. I'll pull them, run `npm run import`, review the report, fix whatever the real photos expose, and send you screenshots. Running it yourself also works: `npm run import`, then `npm run dev` → `http://localhost:5173/?store=<store>`.

## 3. Real stores
### Shopify (free development store)
1. Join the **Shopify Partner Program** (free) at shopify.com/partners → Stores → **Add store → Development store**.
2. Add 2–3 products whose **handle** matches the imported product ids (e.g. `firozi-lawn-3pc`), with a Size option (S, M, L, XL).
3. Follow `docs/integration.md` §2 to add the snippet, with `tryon_host` = your Cloudflare link.
4. Open a product page on your phone → Try it on → pick a size → **Add to cart** → check the cart.

### WooCommerce
Any WordPress site with WooCommerce (a local install with LocalWP works too). Install the plugin from `integrations/woocommerce/` and follow `docs/integration.md` §3.

Share the store link (or the error you see), and I'll fix theme-specific issues.

## What I need from you (production checklist)
| # | Item | Why | Status |
|---|---|---|---|
| 1 | Repository private | Protect code and brand photos | ☐ |
| 2 | Cloudflare account + Pages project | https link for phones; production hosting | ☐ |
| 3 | Phone test reports (budget + mid-range + iPhone) | Prove 720p / 30 fps; tune smoothing and quality steps | ☐ |
| 4 | Network access for the open datasets (or run `npm run datasets` on your computer) | Test and tune on hundreds of real garments | ☐ |
| 4b | Free Pexels and Roboflow API keys | More photos; labelled photos for accuracy figures | ☐ |
| 4c | 5–10 product photos per pilot brand | Final check on their exact catalogue | Later |
| 5 | Shopify development store | Real cart integration test | ☐ |
| 6 | WooCommerce test site (optional) | Second platform | ☐ |
| 7 | Product name + domain (D-7) | Branding, production URL | ☐ |
| 8 | 2–3 pilot brands interested | Real usage data, written photo permission | ☐ |
| 9 | Photo Mode provider choice (D-3), later an API key | Realistic AI photo (Phase 5) | Later |

Items 1–4 unblock everything else. Item 3 decides whether budget phones need a lighter tracking model.
