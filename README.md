# AI Clothing Wear: Virtual Try-On for Pakistani Clothing Stores

A "Try it on" button for online clothing stores in Pakistan: shoppers open their phone or laptop camera, pick an outfit (kurta, kameez, shalwar, dupatta, 3-piece suits), and see it on themselves live at 720p / 30 fps, then share a photo on WhatsApp before ordering.

**Status:** Phase 1 (try-on engine) and Phase 2 (embeddable widget, Garment Studio, Shopify/WooCommerce integrations) built and passing automated tests. Real-phone and real-store testing next. See [Phase 1 QA](docs/qa/phase1.md) and [Phase 2 QA](docs/qa/phase2.md).

## Quick start
```bash
npm install
npm run dev          # widget: http://localhost:5173  (demo store: /demo-store.html)
npm run dev:phone    # same over https on your Wi-Fi, to test on a phone
npm run studio       # Garment Studio: http://localhost:5174
npm run check        # type-check + unit tests
npm run e2e          # widget + embed flow with a fake 720p camera (headless Chromium)
npm run e2e:studio   # Garment Studio pipeline on a real photo
npm run e2e:integrations  # Shopify / WooCommerce cart hand-off
npm run build && npm run e2e:caching   # download budgets on the production build
npm run garments     # regenerate the sample garments + demo catalog
npm run import       # real product photos in datasets/ → try-on garments + review report
npm run build:site   # widget + demo store + studio, ready to host (Cloudflare Pages)
```
The first `dev`/`build` downloads the MediaPipe runtime and pose models into `apps/widget/public/mediapipe/` (self-hosted, git-ignored).

## Repository layout
```
packages/engine/     Try-on engine (TypeScript): camera, pose worker, body model, skinning, WebGL renderer
apps/widget/         Shopper widget + tryon.js loader + demo store page; 5 sample outfits, EN/UR
apps/studio/         Garment Studio: product photo → try-on garment (AI cut-out, joints, export) + batch import
datasets/            Your real product photos (git-ignored; see datasets/README.md)
integrations/        Shopify snippet, WooCommerce plugin
scripts/             Garment generator, asset fetcher
tests/e2e/           End-to-end test (Playwright + fake camera)
docs/                Product plan, requirements, architecture, roadmap, process, decisions, QA
```

## Documentation
| Doc | Contents |
|---|---|
| [1. Product](docs/01-product.md) | Problem, users, Pakistan-specific constraints, quality bar, metrics |
| [2. Requirements](docs/02-requirements.md) | Functional + non-functional requirements with IDs (720p30, latency, load size, privacy) |
| [3. Architecture](docs/03-architecture.md) | Tech stack, engine pipeline, garment format, Photo Mode, repo layout |
| [4. Roadmap](docs/04-roadmap.md) | Phases 0–6 with exit criteria (~18 weeks) |
| [5. Process](docs/05-process.md) | Git workflow, Definition of Done, CI, real-device QA lab |
| [6. Decisions & Risks](docs/06-decisions-and-risks.md) | Open decisions, ADRs, risk register |
| [7. Target Brands](docs/07-target-brands.md) | Target brands, their platforms, what data we use and how |
| [**Testing guide**](docs/testing-guide.md) | Phone tests, real clothes, real stores; what's needed for production |
| [Integration guide](docs/integration.md) | Embedding on any site, Shopify, WooCommerce; catalog format |
| [Garment guidelines](docs/garment-guidelines.md) | Which product photos work; Garment Studio workflow |
| [Phase 1 QA](docs/qa/phase1.md) | What was built, test results, phone test checklist |
| [Phase 2 QA](docs/qa/phase2.md) | Widget, Studio, integrations, download budgets |
