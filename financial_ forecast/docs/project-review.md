# Code and packaging review — 8 November 2026

## Scope and organisation

Static review of first-party backend/frontend source, the frontend import graph,
Python dependency imports, source hashes, packaging and module guides. The original static cleanup was followed by simulation integration, model/API unit checks and browser checks of map, timeline, selection and Capri actions. Vendored RichDEM/Earcut are dependencies with their
own licences; their internals were not rewritten.

The current layout is appropriate: native data/terrain work in `src/backend/terrain`,
HTTP/cache adapters under `src/backend`, chat/transcription in `src/backend/capri`,
map rendering under `src/frontend/map`, and controls/companion UI under
`src/frontend/GUI`. The audio worklet is a separate browser execution context and
belongs beside push-to-talk. No runtime files were moved or split.

The root `pyproject.toml` and `uv.lock` describe the app. The simulation runtime requires NumPy, pandas and openpyxl; these are declared as core dependencies. Local transcription is the optional `voice` extra. Node is used for existing frontend checks, not production bundling.
The repository-root `.gitignore` covers root and nested environments, credentials,
generated products, logs, editor artefacts and reports. Existing local log files
are retained on disk but excluded from future commits.

## Simulation integration

- Removed `forecast(1).js`, duplicate mount IDs and the independent forecast
  timeline. `GUI/forecast.js` drives the existing timeline and renderer.
- Consolidated production simulation in `forecast_service.py`; `simulation.py`
  exports that same model to JSON/Excel without fitting at import time.
- Connected global and area shocks to terrain and weather. FDI edits are regional;
  source observations stay separate and missing data remains unavailable.
- Reused employment interpolation for simulated surfaces; GPU buffers and fixed
  scales are reused across scenarios. Selection highlights conform to raised terrain.
- Added bounded scenario caching, finite/range validation, gzip/ETag handling,
  zero-correlation handling and model/source-year disclosures.
- Capri's action registry reuses existing controls; clear navigation commands
  run locally and provider tool calls use the same validated operations.

## Earlier cleanup findings

- No identical first-party source files or missing/unreachable frontend modules
  were found. The worklet is explicitly loaded by the voice capture code.
- Consolidated repeated texture allocation, filtering and size-limited uploads
  inside the existing renderer. Creation, year updates and playback reuse these
  helpers and the same upload canvas.
- Removed shader switches/uniforms for the superseded flat employment contour
  pass; current employment uses its own raised mesh and the shared contour shader.
- Employment raster colours now reuse the same band classification as tree
  eligibility, rather than maintaining a second copy of the thresholds.
- Removed the unused sidebar explanation reference and obsolete employment-legend
  styling. Current legends continue to use their shared markup and stylesheet.
- Corrected outdated documentation about flat employment rendering, borrowed
  income contours, wake-word recognition and playback timing.

## Retained intentionally

`matrixcoefffitting` contains offline research scripts and experimental simulation
workbooks; these are not imported by the running app. The correlation/regression
entry points share `dataset.py`; newer experiments have different modelling
assumptions and were not merged into production or treated as equivalent code.
Original source data, the root LAD boundary file, planning notes, sprites, sound
licences and third-party sources remain available. Ignored native caches and
voice model weights are generated/local products, not source replacements.

The root README is the current run/setup guide. `terrain.md` and `capri.md`
describe the active rendering and companion paths; planning documents are original
project notes rather than a specification of current behaviour.
