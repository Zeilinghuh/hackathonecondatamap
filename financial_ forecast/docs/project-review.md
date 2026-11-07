# Project review — 7 November 2026

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
