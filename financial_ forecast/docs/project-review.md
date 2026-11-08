# Project review — 7 November 2026

## Follow-up — 8 November 2026

Checked first-party source hashes and the frontend import graph: no identical source files, missing imports or unused modules. `voiceprocessor.js` is a separate AudioWorklet entry loaded by `localrecognition.js`. Kept vendored RichDEM/Earcut, their licenses, source assets and original planning notes. Kept the offline indicator analysis scripts, which serve different research purposes; consolidated their duplicated workbook-reading code into `dataset.py`. Before/after data comparison matches all 689 source-area observations across six indicators. The current indicators have too few complete local-authority rows for regression, so the script now reports that limitation cleanly. Analysis dependencies are an optional uv extra.

Removed stale sidebar explanation references, unused busy events, mischief toggle state/styles and the old decorative reaction overlay. Companion animation shares frame lists, caps visual updates at 30 Hz and stops its animation loop in hidden tabs. GPU terrain buffers and camera rendering remain shared between views.

The browser's cloud speech service failed a generated-audio check. Added optional offline native Vosk recognition behind the existing web server, with one lazily loaded model, bounded audio uploads and expiring/released sessions. Recognition status now distinguishes startup from confirmed capture, shows the heard transcript and accepts the phonetic Capri variants found in real transcription. The optional voice extra and ignored model setup are documented in README and `docs/capri.md`.

Focused verification: wake-phrase regressions; speech session validation, limits and expiry; browser fallback setup and UI; new reaction sprite rendering; permanent 12–22-second idle timing; and a complete generated-audio → real offline transcription → wake → chat → auto-send flow. Muting released the generated audio track and stopped uploads. Chat was mocked for these checks, so no paid provider requests were required.

Reviewed first-party backend/frontend, data flow, tests, uv and Git/LFS setup.
RichDEM and installed packages remain dependencies; their internals were not
comprehensively audited or rewritten.

## Current cleanup

Native terrain code is under `src/backend/terrain/`. The web server and native
adapter are separate under `src/backend/`. Tests moved out of runtime source
into `tests/backend/` and `tests/frontend/`. Module guides/review moved to
`docs/`, original planning documents to `docs/planning/`, and generated products
to ignored `build/terrain/`. The obsolete `terrainGen` folder and old bytecode
were removed. Planning content, source assets and Capri art are preserved.

The remaining Python is required: it serves the local app, manages the native
build/cache, unpacks XLSX ZIP entries and makes Capri HTTPS requests. C++ owns
workbook-record parsing, GeoJSON parsing, authority matching, simplification,
income interpolation, RichDEM analysis and terrain JSON generation.

## Rendering changes

2D and 3D now share one GPU canvas and contour shader. Static terrain, textures,
boundary instances and all highlight triangles are uploaded once. The CPU
Canvas contour draw loop and duplicate renderer/canvas are removed.

Terrain-off boundaries are screen-width GPU strokes. Hover shows a cyan
fill/outline with a fading pulse; leaving fades it out. Selection retains a
quieter outline. Reduced-motion users get steady highlights. The map stops
requesting frames when idle.

The selected-area panel includes **Ask Capri to explain**. Clicking opens chat
and submits the selected authority code; the server resolves verified income
facts. Hovering/selection alone sends no AI request. Existing chat, sprite
animation and API-key handling are preserved.

## Local evidence

Edge headless, 1440 × 960, 60 wheel-driven updates per view:

| View | 95th-percentile main-thread drawing work |
| --- | ---: |
| 2D terrain | 0.5 ms |
| 3D terrain | 0.2 ms |
| Terrain-off borders | 0.3 ms |

The same browser check recorded **zero Canvas strokes** during interaction and
unchanged **five buffer uploads / three texture uploads** across pan, zoom, mode
changes, hover and selection. All highlight geometry is prepared up front.

These measurements cover main-thread work, not guaranteed GPU frame rates.
Earlier native product preparation measured about 3.3 seconds without compiler
work, cached product loading 0.17 seconds, and the gzip response about 1.98 MB.

## Validation and limits

All 24 automated tests and Ruff pass. Browser checks also cover 3D hover,
reduced-motion idle behavior, graphics-context recovery, the non-instanced
border fallback and touch pinch.

Checks cover native DEM/slope invariants, workbook tab/year selection, geometry
reduction, indexed chat context, cache invalidation/corruption, HTTP compression
and ETags, camera bounds/projection/picking, and highlight holes/islands.

Browser checks cover GPU reuse, visible borders/contours, hover fade/pulse,
selection, correct authority sent to Capri, no AI request on hover, idle frame
stopping, 2D/3D switching, zoom and responsive layout. Provider calls are mocked
for these checks.

The same 361/382 authorities match the income source. Missing special-authority
income remains unshaded. The 200 × 320 grid and simplified display boundaries
limit precision; they are not survey geometry or physical altitude. No weather
model was introduced. Vendored Earcut includes its original license and pinned
source provenance.
