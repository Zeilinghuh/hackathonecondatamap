# Financial Forecast

A UK income landscape with 2D contours, a 3D view and Capri as a chat companion.
Heights describe gross disposable household income, not physical altitude.

## Run

Use Python 3.11.7 and a C++17 compiler (`g++` or `clang++`) on PATH.
From the repository root, in your activated environment:

```powershell
python "financial_ forecast/src/backend/server.py"
```

Or use uv:

```powershell
uv sync --no-dev
uv run --no-dev python "financial_ forecast/src/backend/server.py"
```

Open [the local app](http://127.0.0.1:8000). No frontend build, Node runtime,
Python RichDEM, GDAL or extra Python runtime packages are needed. The browser
uses WebGL for both map views. The first request compiles native code if needed;
subsequent starts reuse generated terrain.

Drag/arrow keys pan. In 3D, Shift-drag/right-drag or Shift-arrow rotates.
Scroll/+/- zoom; two fingers pan/pinch; UK view/0 resets. With terrain off,
hover an authority for a cyan glow, click to select it, then choose **Ask Capri
to explain** in the side panel. That button submits a chat request about the
selected authority; hovering does not call AI.

## Layout

```text
financial_ forecast/
  src/backend/
    server.py             Web/API server
    terrain_service.py    C++ build, ZIP unpacking and response cache
    terrain/              C++ data pipeline, RichDEM and native CLI
    capri/                Server-side chat adapter
  src/frontend/
    GUI/                  Page, controls and Capri interface
    map/                  Navigation, picking and selection
      render/             Shared GPU renderer, textures and borders
  tests/                  Backend and frontend tests
  docs/                   Module guides and project review
    planning/             Original planning documents
  build/terrain/          Generated executable and caches (ignored)
  assets/                 Original data and visual assets
  richdem-src/            Vendored RichDEM and its licenses
```

The remaining Python is active infrastructure: C++ handles data parsing,
authority joins, geometry simplification, income interpolation, RichDEM analysis
and terrain JSON. Python handles the local web server, HTTPS chat, ZIP unpacking
and cached bytes. Source tests live under `tests/`; old duplicate paths and
obsolete bytecode were removed.

Both views share one GPU canvas. Terrain, boundary segments and highlight meshes
are prepared/uploaded once. Moving updates the camera; it does not re-stroke
Canvas paths. Terrain-off borders use screen-width vector strokes, and hover
glow animates only while needed. Reduced-motion preferences keep it steady.

See [the terrain guide](financial_%20forecast/docs/terrain.md),
[Capri guide](financial_%20forecast/docs/capri.md) and
[project review](financial_%20forecast/docs/project-review.md).
The original edited planning documents are preserved under `docs/planning/`.

The large GeoJSON uses Git LFS: run `git lfs pull` after cloning if it is a
pointer instead of the real boundary file. Chat credentials belong in the ignored
`financial_ forecast/.env`; see the supplied `.env.example`.

## Check

From `financial_ forecast`:

```powershell
python -m unittest discover -s tests/backend -p "test_*.py"
node --test tests/frontend/*.test.mjs
```

Node is only needed for the frontend tests. Chat tests mock the provider.
