# AI Clothing Wear: Virtual Try-On for Pakistani Clothing Stores

A "Try it on" button for online clothing stores in Pakistan: shoppers open their phone or laptop camera, pick an outfit (kurta, kameez, shalwar, dupatta, 3-piece suits), and see it on themselves live at 720p / 30 fps, then share a photo on WhatsApp before ordering.

**Status:** Phase 1 (try-on engine) built and passing automated tests; real-phone testing next. See [Phase 1 QA](docs/qa/phase1.md).

## Quick start
```bash
npm install
npm run dev          # http://localhost:5173 (camera works on localhost)
npm run dev:phone    # https on your Wi-Fi, to test on a phone
npm run check        # type-check + unit tests
npm run e2e          # end-to-end test with a fake 720p camera (headless Chromium)
npm run garments     # regenerate the sample garments + catalog
```
The first `dev`/`build` downloads the MediaPipe runtime and pose models into `apps/demo/public/mediapipe/` (self-hosted, git-ignored).

## Repository layout
```
packages/engine/     Try-on engine (TypeScript): camera, pose worker, body model, skinning, WebGL renderer
apps/demo/           Demo shopper page (Vite): 5 sample outfits, EN/UR, snapshot + share
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
| [Phase 1 QA](docs/qa/phase1.md) | What was built, test results, phone test checklist |
