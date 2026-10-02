# 5. Development Procedure

## 5.1 Workflow
1. Every piece of work starts as a GitHub **issue** linked to a requirement ID (e.g. `F-04`, `N-02`).
2. Branch from `main`: `feat/<short-name>`, `fix/<short-name>`.
3. Open a **pull request**. The CI checks in section 5.3 must pass, and the PR needs one review (human or Claude review).
4. Squash-merge to `main`. `main` always deploys to **staging** automatically.
5. Releases are tagged `vX.Y.Z` → deployed to **production**. The widget JS is versioned so stores can pin a version.

## 5.2 Definition of Done
- Code + tests written, CI green
- Requirement IDs in the PR description
- For engine changes: performance numbers attached (fps / tracking Hz on at least one Tier B phone)
- Docs updated if behaviour or architecture changed
- No new console errors; widget works with the camera denied

## 5.3 Automated checks (CI on every PR)
| Check | Tool |
|---|---|
| Type check + lint + format | `tsc`, ESLint, Prettier; `ruff` + `mypy` for Python |
| Unit tests | Vitest (smoothing filter, skinning, body model, anchor expressions); pytest (API) |
| End-to-end | Playwright + Chromium with a **fake camera fed from a recorded video of a person**; asserts the model loads, the pose is detected, the garment is drawn, and no errors occur |
| Visual regression | Screenshot of fixed frames compared to a baseline (catches warp and rendering bugs) |
| Bundle size budget | Fails if the widget or engine grows past its budget (section 2.3, N-07/N-08) |

## 5.4 Real-device quality lab (manual, before each release)
Automated tests can't measure real phone performance, so every release candidate is run on the device matrix:

| Scenario | Pass criteria |
|---|---|
| Stand still 10 s, front camera, good light | ≥ 30 fps, no visible jitter |
| Raise arms, turn 30° left/right | Sleeves follow; garment doesn't detach |
| Walk towards/away from camera | Scale follows smoothly; guidance appears when too close |
| Dim tube-light room | Tracking holds; "face the light" hint if needed |
| Phone on shelf, rear camera, 10 s timer | Snapshot captures full outfit |
| 3-minute session | No fps drop from heat; no memory growth |
| Slow 4G (throttled) first visit | Meets the N-06 load-time target |
| Instagram in-app browser | Clear "Open in Chrome" message |

Results are logged in `docs/qa/<version>.md` (device, fps, tracking Hz, issues).

## 5.5 Environments
| Env | Purpose | URL (placeholder) |
|---|---|---|
| local | development (`npm run dev`, camera works on localhost) | localhost |
| staging | auto-deploy from `main`, test stores | staging.<domain> |
| production | tagged releases | <domain> |

Camera access needs **HTTPS** (or localhost). To test on a phone during development, use a tunnel (e.g. Cloudflare Tunnel) or the staging deploy.

## 5.6 Telemetry (privacy-safe)
The widget reports **only**: device model or user-agent class, fps, tracking Hz, load time, errors, and funnel events. It never reports images, video or keypoints. This data drives device-tier decisions and catches regressions.

## 5.7 Documentation set
- `docs/01-product.md`: what and why
- `docs/02-requirements.md`: requirement IDs used in issues and PRs
- `docs/03-architecture.md`: how
- `docs/04-roadmap.md`: when
- `docs/05-process.md`: this file
- `docs/06-decisions-and-risks.md`: decision log and risk register
- Later: `docs/garment-guidelines.md` (how stores should photograph garments), `docs/integration.md` (embed/Shopify/Woo setup), `docs/qa/`
