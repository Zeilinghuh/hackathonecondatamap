# CAPRICORN — Financial Forecast

A UK income landscape with 2D contours, a 3D view, a population density layer
and Capri as an interactive companion. An optional economic simulation explores 2026–2035. Heights describe gross disposable household
income, not physical altitude.

The **Employment rate** layer displays employment rates as contoured hills from pale to dark green, with
small CSS trees only in the highest band (85%+). Use **Data year** or **Play** to explore 2004–2023,
then select an authority to see its rate and annual change in percentage points.
The figures come from ONS/NISRA employment observations for ages 16–64; the
height and tree markers are visual representations of employment. Northern Ireland is available for 2023 only.

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
Python RichDEM or GDAL are needed. Run `uv sync` first (or install the project dependencies in your activated environment) for NumPy, pandas and openpyxl. Offline voice uses an optional extra described below. The browser
uses WebGL for both map views. The first request compiles native code if needed;
subsequent starts reuse generated terrain.

Drag/arrow keys pan. In 3D, Shift-drag or Shift-arrow rotates. Right-click an area for Capri actions and comparisons.
Scroll/+/- zoom; two fingers pan/pinch; UK view/0 resets. **Data layer** picks **Income per head** (gross disposable household income, £),
**Population density** (residents per km² on a log height scale), **Employment rate**
(ages 16–64, %) or **Area boundaries**. All data surfaces have contours and a 3D view.
**Weekly pay** adds blue rain (heavier means higher pay), and **Foreign investment** adds fixed-size wind arrows (denser means more regional FDI). Both controls are under **Additional data** and work in recorded or simulation mode, with the actual source year in their legends.
**Business failure** adds the fixed 2024 business-closure rate (% of active businesses,
ONS business deaths) as a density overlay. On Area boundaries,
hover an authority for a cyan glow. Right-click an area and choose **Explain this area** to submit a question to Capri; hovering does not call AI.

For reliable local voice, run once from the repository root:

```powershell
uv sync --no-dev --extra voice
uv run --no-dev --extra voice python "financial_ forecast/src/backend/capri/speech.py"
uv run --no-dev --extra voice python "financial_ forecast/src/backend/server.py"
```

The setup downloads the roughly 500 MB Whisper small.en model into ignored `build/speech/`.
Whisper runs locally on the CPU with int8 inference; an already installed Vosk model is a fallback.
The first transcription loads the model; subsequent questions reuse it.
Hold **Speak to Capri** at the bottom left, speak, then release to transcribe and auto-send.
Microphone capture runs only during a hold; keyboard users can hold Space or Enter on the button.
Voice uses the local server and the optional voice setup above.
Drag Capri's chat header to move it. The original character/orb art is retained.
Capri's frontend is grouped in `src/frontend/GUI/capri/`: `capri.js` contains the companion and area actions, `voice.js` handles push-to-talk, and `voiceprocessor.js` is the browser's separate audio worklet.

Use **Data year** to drag, scroll or step through the available observations;
**Play** advances one year at a time.
During Play, each step blends the terrain heights, lighting, colours and contours
over 550 ms within the 650 ms year interval. These intermediate shapes are visual
interpolations, not extra observations. Manual year selection morphs between displayed frames; Pause settles on
the selected frame immediately; reduced-motion mode keeps discrete steps.
Income covers 1997–2024 and population density 1991–2025. Employment covers 2004–2023. Business failure is a fixed 2024 overlay and does not change with the year slider. The sea grid is visible in both 2D and 3D. History loads once in the background and is cached. Height/colour
scales stay fixed across years. Missing values remain unshaded; income is
nominal (not inflation-adjusted) and all years use the current map boundaries.

## Simulation and Capri controls

Choose **Enable simulation** in **WHAT IF?**. The existing **Data year** slider
then explores **2026–2035**; **Play** morphs the same terrain meshes as recorded
playback. **Return to recorded data** restores the previous recorded year for
each layer. Recorded observations are never overwritten by scenarios.

Edit growth shocks for all modelled areas, or choose an authority in **Edit**.
Edits apply automatically after a short pause. Income, density and employment alter both the contours and 3D heights.
Business failure alters the closure overlay; **Weekly pay** adds blue rain,
**Foreign investment** adds regional arrow concentrations, and **Rate signal** shows model
output in the legend stack. **Reset all edits** restores the baseline scenario.
All controls use the existing dark arcade theme.

The model currently fits **361 UK local authorities**;
special planning areas without matching data stay grey in simulation mode. It
uses damped correlations in observed growth, not causal estimates. A shock is
in growth standard deviations, not a percentage-point change, and fades by 0.6
each year. FDI edits apply to the whole model region (English region or devolved country). The rate signal is dimensionless,
not an actual interest rate. Each authority starts from its latest available
observations, which may have different source years. Missing growth starts at
the model mean; estimated baseline inputs are disclosed in the API and selected-area context. This is an exploratory
what-if model, **not a validated economic prediction**. See [model details](financial_%20forecast/docs/simulation.md).

Type or hold **Speak to Capri**, for example:

- “Find Barnet in 2019” selects, highlights and zooms to Barnet, changes the year
  and reports the displayed observations.
- “Show employment in 3D”, “hide the panel”, “pause” and “zoom out” use the normal
  app controls.
- “Find Barnet in 2030” opens the simulated future.
- Requests, such as “increase Barnet’s income growth by one standard
  deviation”, use the configured chat model to select validated app actions.

Capri can control layers, views, area selection, years, playback, overlays,
simulation shocks/rate stance/reset, zoom/reset, sidebar and sound. She reports
actual displayed values after actions finish. Other conversation uses the upgraded Kimi K3 model on Fireworks;
tests mock that service and never spend chat credits. Source files and system
settings are outside her app controls.

## Layout

```text
financial_ forecast/
  src/backend/
    server.py             Web/API server
    terrain_service.py    C++ build, ZIP unpacking and response cache
    forecast_service.py   One fitted simulation model and scenario cache
    simulation.py         CLI export using that same model
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
cached bytes and the vectorised simulation model. Source tests live under `tests/`; old duplicate paths and
obsolete bytecode were removed.

Both views share one GPU canvas. Terrain, boundary segments and highlight meshes
are prepared/uploaded once. Moving updates the camera; it does not re-stroke
Canvas paths. Terrain-off borders use screen-width vector strokes, and hover
glow animates only while needed. Reduced-motion preferences keep it steady.

See [the terrain guide](financial_%20forecast/docs/terrain.md),
[Capri guide](financial_%20forecast/docs/capri.md) and
[project review](financial_%20forecast/docs/project-review.md).
The original edited planning documents are preserved under `docs/planning/`.

The scripts under `src/backend/matrixcoefffitting/` are offline research, not obsolete runtime code. They share `dataset.py`; their pandas/openpyxl dependencies are included by `uv sync`. They do not affect map heights or forecasts. Regression reports insufficient overlapping data rather than returning invalid coefficients.

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

Capri drives map controls for recorded/simulation switching, scenarios and playback. Area requests use a smooth camera flight, centred on the displayed terrain height in 3D. Manual year scrubbing also morphs the shared contour surface; rapid input reuses and retargets the active transition. Reduced-motion preferences keep camera and terrain changes immediate.

Capri can search simulation parameters, for example “change the parameters to find minimum income per head in London”. She uses 2028 if no future year is specified, searches global shock/rate settings, applies the best result found to the map and sliders, and focuses the winning authority. This bounded search does not establish a global optimum.

Capri interprets typed/spoken requests through Kimi K3 using the current metric, camera, scenario parameters and recent chat. After applying actions she receives execution results and freshly computed map facts, then finishes the requested explanation or remaining controls. Regional focus and mean/extreme search objectives support country-wide and local scenarios. A configured chat key is required for conversational controls; direct GUI controls continue to work independently.
