# AI Clothing Wear — Virtual Try-On for Pakistani Clothing Stores

A "Try it on" button for online clothing stores in Pakistan: shoppers open their phone or laptop camera, pick an outfit (kurta, kameez, shalwar, dupatta, 3-piece suits), and see it on themselves live at 720p / 30 fps, then share a realistic photo on WhatsApp before ordering.

**Status:** Planning (Phase 0). The code in the root (`index.html`, `app.js`, `garments/`) is an early throwaway prototype, not the product.

## Documentation
| Doc | Contents |
|---|---|
| [1. Product](docs/01-product.md) | Problem, users, Pakistan-specific constraints, quality bar, metrics |
| [2. Requirements](docs/02-requirements.md) | Functional + non-functional requirements with IDs (720p30, latency, load size, privacy) |
| [3. Architecture](docs/03-architecture.md) | Tech stack, engine pipeline, garment rig format, Photo Mode, repo layout |
| [4. Roadmap](docs/04-roadmap.md) | Phases 0–6 with exit criteria (~18 weeks) |
| [5. Process](docs/05-process.md) | Git workflow, Definition of Done, CI, real-device QA lab |
| [6. Decisions & Risks](docs/06-decisions-and-risks.md) | Open decisions, ADRs, risk register |

## Prototype (for reference only)
```
python3 -m http.server 8000   # then open http://localhost:8000
```
