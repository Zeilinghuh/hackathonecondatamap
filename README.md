# Financial Forecast

A UK income landscape with 2D contours, a 3D view, a population density layer
and Capri as a chat companion. Heights describe gross disposable household
income, not physical altitude.

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
Python RichDEM, GDAL or extra Python runtime packages are needed for the map or typed chat. Offline voice uses an optional extra described below. The browser
uses WebGL for both map views. The first request compiles native code if needed;
subsequent starts reuse generated terrain.

Drag/arrow keys pan. In 3D, Shift-drag or Shift-arrow rotates. Right-click an area for Capri actions and comparisons.
Scroll/+/- zoom; two fingers pan/pinch; UK view/0 resets. **Map layer** picks
TERRAIN (income heights), DENSITY (a second terrain from log₁₀ ONS residents
per km², with its own contours, in 2D and 3D) or BORDERS. On BORDERS,
hover an authority for a cyan glow. Right-click an area and choose **Explain this area** to submit a question to Capri; hovering does not call AI.

For reliable local voice, run once from the repository root:

```powershell
uv sync --no-dev --extra voice
uv run --no-dev --extra voice python "financial_ forecast/src/backend/capri/speech.py"
uv run --no-dev --extra voice python "financial_ forecast/src/backend/server.py"
```

The setup downloads a 40 MB English model into ignored `build/speech/`.
Enable MIC, allow microphone access, and say **Hey Capri** followed by a question.
Questions auto-send after a pause. Mute stops capture; hidden tabs pause it.
When local voice is installed, speech is processed on the local app server.
Browser speech recognition remains a fallback when local voice is not installed.
The voice label confirms when capture actually starts and shows what was heard.
Drag Capri's chat header to reposition it. Fling the orb for dizzy/annoyed reactions;
idle peeking and occasional mischief are always enabled (reduced motion is respected).

Use **Data year** to drag, scroll or step through the available observations;
**Play** advances one year at a time. Income covers 1997–2024 and density
1991–2025. History loads once in the background and is cached. Height/colour
scales stay fixed across years. Missing values remain unshaded; income is
nominal (not inflation-adjusted) and all years use the current map boundaries.

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

The scripts under `src/backend/matrixcoefffitting/` are offline research, not obsolete runtime code. They share `dataset.py`; install `uv sync --extra analysis` to use their pandas/openpyxl dependencies. They do not affect map heights or forecasts. Regression reports insufficient overlapping data rather than returning invalid coefficients.

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
