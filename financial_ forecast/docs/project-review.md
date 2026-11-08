# Code and packaging review — 8 November 2026

## Scope and organisation

Static review of first-party backend/frontend source, the frontend import graph,
Python dependency imports, source hashes, packaging and module guides. No tests
were run during this cleanup. Vendored RichDEM/Earcut are dependencies with their
own licences; their internals were not rewritten.

The current layout is appropriate: native data/terrain work in `src/backend/terrain`,
HTTP/cache adapters under `src/backend`, chat/transcription in `src/backend/capri`,
map rendering under `src/frontend/map`, and controls/companion UI under
`src/frontend/GUI`. The audio worklet is a separate browser execution context and
belongs beside push-to-talk. No runtime files were moved or split.

The root `pyproject.toml` and `uv.lock` describe the app. Default map/typed-chat
runtime needs no third-party Python packages; `voice` and `analysis` are optional
extras. Node is used for existing frontend checks, not production bundling.
The repository-root `.gitignore` covers root and nested environments, credentials,
generated products, logs, editor artefacts and reports. Existing local log files
are retained on disk but excluded from future commits.

## Findings and changes

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
