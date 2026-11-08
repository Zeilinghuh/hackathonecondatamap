# Terrain and rendering

Run `python src/backend/server.py` from the project directory, then open
http://127.0.0.1:8000. The root README includes uv commands.

## Responsibilities

| Location | Owns |
| --- | --- |
| `src/backend/terrain/main.cpp` | Native command-line entry |
| `src/backend/terrain/dataPipeline.cpp` | Income/density XML and GeoJSON parsing, matching, geometry and JSON output |
| `src/backend/terrain/terrainDEM.cpp` | Interpolation, RichDEM raster/slopes and native contours |
| `src/backend/terrain_service.py` | Compilation, XLSX ZIP unpacking, cache and response bytes |
| `src/backend/server.py` | HTTP/static assets and chat routing |
| `src/frontend/map/mapnavigation.js` | Input, camera bounds, zoom and resize |
| `src/frontend/map/areas.js` | Projected authority geometry, picking and cached highlight triangles |
| `src/frontend/map/areainteraction.js` | Hover fade/pulse, selection and interaction state |
| `src/frontend/map/render/terrainrenderer.js` | Shared 2D/3D GPU rendering and camera |
| `src/frontend/map/render/arealayer.js` | Sharp GPU borders and cyan highlights |
| `src/frontend/map/render/terraintexture.js` | Colour raster, land mask and static fill textures |
| `src/frontend/map/terrainmath.js` | Projection, mesh and ray/triangle math |

There is one native executable, cached terrain/history products and one browser GPU renderer.
The old CPU contour renderer and second map canvas are removed. Python files
are active adapters, not duplicate terrain implementations.

## Data pipeline

The ZIP adapter resolves workbook tabs **16** (income) and **3** (population
density) through workbook relationships and unpacks those worksheets and the
shared strings. C++ RapidXML parses each table's latest dated column, keeps local-authority observations and normalizes names for the
planning-authority join. RapidJSON parses the boundary source. Both parsers are
already included with vendored RichDEM and retain their licenses.

C++ simplifies boundary geometry with radial filtering and Douglas–Peucker,
preserving holes and small islands. This is display geometry; original source
assets remain untouched. Matched representative LONG/LAT points and raw income
feed the unchanged 200 × 320 Mercator interpolation. RichDEM owns the grid and
calculates synthetic slope. Native marching squares extracts 5-unit contours.

The product represents 2024 gross disposable household income per head:
361/382 planning authorities match. Missing special-authority income remains
unshaded. Heights are an income metaphor, not physical altitude or wealth.

Each feature also carries `population_density`: residents per km² at mid-2025
from the same ONS workbook, joined by the same name match (361/382). C++ feeds
log₁₀ density samples through the same `writeDEM` (interpolation, RichDEM grid
and slope, 5-unit marching-squares contours) into a second product field,
`density_dem`. Log scaling keeps the Highlands (8/km²) and inner London
(16,906/km²) on one readable surface. `metadata.population_density.log10_range`
maps height back: `log10(d) = low + height / 1000 × (high − low)`. Density
never changes the income `dem`.
No depression filling, hydrology or weather simulation modifies the surface.

C++ writes the terrain JSON plus a small authority/context index. Python serves
cached compressed bytes without loading the large GeoJSON/DEM into dictionaries
or repeatedly serializing it. Capri reads the small indexed context.

## Cache

`/api/history` lazily generates/caches compact annual RichDEM grids and their
authority observations. C++ uses one normalization range per indicator across
all years; no repeated geometry, slope arrays or contour segments are sent for
history frames. The browser reuses existing GPU buffers/textures when the year
changes. Historical chat uses a small year-specific context index. History
products use the `history` prefix beside the normal terrain cache files.

All outputs live under ignored `build/terrain/`:

- `terrainDEM.exe`/`terrainDEM` and `native-build.key`
- `terrain.json.gz`, `terrain-context.json` and `terrain-cache.key`

Source/header/compiler-flag changes invalidate native compilation. Source assets
and data-pipeline changes invalidate the product. Remove the product key and
restart to force regeneration. Temporary products are published only after a
successful build; corrupt gzip/context caches are rebuilt. HTTP uses ETags and
gzip negotiation.

## GPU rendering

Both views use the same mesh, textures and contour shader. 2D is a top-down,
unraised camera projection. 3D adds a fixed linear display exaggeration and soft
lighting; it does not recalculate or renormalize heights.

The colour ramp remains blue through cyan, green, yellow, red and dark crimson.
The main range spans the DEM's 2nd–98th percentiles; the red tail reaches the
actual maximum. The shader draws anti-aliased 5-unit isolines with heavier
25-unit lines and screen-width scaling. Dense lines fade on steep slopes.

The **Map layer** switch picks TERRAIN, DENSITY or BORDERS. DENSITY behaves
like the income terrain: its own mesh (sharing the index buffer), colour texture
and the same contour shader, flat in 2D and raised in 3D. Its display
exaggeration is lower (`DENSITY_HEIGHT_SCALE`) because log heights fill most of
0–1000. Fills are constant between contour levels. Each band takes the class of
its density: nine classes (breaks at 50, 100, 250, 500, 1k, 2.5k, 5k and
10k per km²) on an electric blue → purple → hot pink ramp: blue is sparse
and pink is dense.
Density contours are white, with stronger major lines. Unmatched authorities
stay slate grey.

With BORDERS selected, cached boundary segments are drawn as instanced screen-width
quads, so borders stay sharp at any zoom. A one-time expanded-buffer fallback
supports browsers without instancing. Polygon highlight triangles are prepared
once using locally vendored Earcut 3.0.2, including holes and disconnected
islands. Hover and selection reuse those buffers; they do not triangulate or
upload geometry during interaction.

Hover fades/pulses cyan, then fades out on leave. Selected areas retain a quieter
outline. Reduced-motion preferences disable pulsing. The map stops scheduling
frames when idle; hovering never requests AI. **Explain this area** explicitly
submits the selected authority's code with a chat message.

The browser needs WebGL and standard shader derivatives for these views.
Context restoration recreates GPU resources from retained geometry/textures.
Rendering follows [instancing guidance](https://developer.mozilla.org/en-US/docs/Web/API/ANGLE_instanced_arrays)
and [standard derivatives](https://developer.mozilla.org/en-US/docs/Web/API/OES_standard_derivatives).
Earcut's source/license are under `render/vendor/`; no CDN or runtime network
dependency is added.

Drag/arrows pan; Shift-drag or Shift-arrow rotates in 3D. Scroll/+/-,
pinch and UK view/0 zoom/reset. Right-click an area for Capri explanations, local comparisons and future simulation actions. Ask Capri brings the orb over with a dismissible speech bubble; Explain this area opens chat and requests an explanation directly. Hold the bottom-left Speak to Capri button and release to transcribe and send a voice question. A sparse, dim sea grid provides a camera-aligned reference in both 2D and 3D. Zoom stays 1–12×. 2D locks a fitted axis; the 3D
camera target can move inside the UK bounds even at fit zoom. Neither view allows
unbounded panning. Pixel density is capped at 2×.

The native grid still limits income detail. Land colour textures can soften at
extreme zoom; GPU contour and boundary strokes remain screen-width sharp.

## Employment rate

Choose **Employment rate**, then use **Data year** or **Play** to change the green
landscape through recorded years. Select an authority to see its employment
rate and change against the previous calendar year, in percentage points.

The native pipeline reads actual employment rates for people aged 16–64 from
workbook tabs **11** (ONS, Great Britain) and **12** (NISRA, Northern Ireland).
It filters Measure to Observation value, excluding confidence intervals.
The latest year is **2023**, matching **359/382** planning authorities. Great
Britain has 2004–2023 observations; Northern Ireland has 2023 only. Suppressed,
unavailable and unmatched values remain missing. No rate is inferred from
unemployment, and the unfinished regression does not generate these observations.

The terrain response includes an employment series with per-year authority
observations. Features and Capri's indexed context include employment rate and
annual change. A previous-year comparison is unavailable when either year is
missing; it is never substituted with zero or a different earlier year.

[vegetation.css](../src/frontend/GUI/vegetation.css) defines the green map palette
and draws the small trees with CSS gradients, rounded shapes and pseudo-elements.
Employment shares the existing 2D/3D terrain renderer. On a fixed 50–95% height
scale, a small inverse-distance field is bilinearly expanded onto the common
GPU grid. Green colour classes use the same 65%, 75%, 80% and 85% breaks as the
marker eligibility logic in `map/vegetation.js`. Areas without observations
retain the base no-data colour. Heights are synthetic, not geographic altitude
or measured land cover.

The employment mesh, colour texture and contour mask update when the year changes.
Camera movement reuses GPU resources; tree anchors sample the displayed employment
height in 3D. All views share the dark sea and sparse grid. During Play, the
renderer blends previous/current heights, normals, colours and masks over 550 ms
inside each 650 ms step. Manual year changes and Pause settle immediately on the
recorded frame, and reduced-motion mode skips interpolation.

Decorative trees are restricted to employment rates of **85%+**. Stable anchors
reuse Earcut triangles and respect holes and islands. A reusable pool holds at
most **48** CSS tree elements, with no more than **28** shown on desktop or
**16** on narrow maps. Screen spacing prevents clumps, and labels sit above the
trees. Normal picking remains available; no animation loop runs while idle.
