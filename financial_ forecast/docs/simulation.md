# Economic simulation

`src/backend/forecast_service.py` is the single production model. The local API
and `simulation.py` export CLI use it; research in `matrixcoefffitting/` remains
separate. No spreadsheet is read at import or server startup. The first scenario
opens the workbook once, reads the required sheets, fits and retains the
model; later runs are vectorised NumPy operations. Eight compressed scenario
responses are cached in memory. Restart the server after replacing source data.

## Inputs and interpretation

Workbook sheets 16 (income per head), 17 (weekly pay), 26 (regional inward FDI),
32 (business deaths), 3 (population density) and 11 (employment ages 16–64) feed
the model. Employment rows use Observation value, not confidence intervals.
All 361 UK LADs with observed income/density starting levels enter the model.
Scotland, Wales and Northern Ireland use country-level FDI; English LADs use
regional FDI. These values are shared across LADs for fitting, so those samples
are not independent. Special planning authorities without matching source
observations remain unavailable, rather than inventing measurements.
Business-death fitting uses 2022 onwards and its drift is held flat.

Consecutive observed annual fractional changes are winsorised at the 1st/99th
percentiles. Pearson cross-correlations have zero diagonal and evidence-weighted
shrinkage n/(n+500). The feedback matrix is capped at spectral radius 0.9 without
amplifying weak correlations. Constant series use zero growth variance safely.
Each LAD starts at its latest available level and standardised observed growth;
source years differ and are returned explicitly in the API. Missing growth
history (including NI employment with only 2023 observations) starts at the
model mean, zero standardised growth. Missing auxiliary starting levels use
an internal regional median for cross-variable feedback, but that metric
remains unavailable in the displayed projection; income/density remain usable.
Per-area `estimated_inputs` lists these assumptions. Historical gaps stay null;
no unobserved intervening years are added.

For each of ten annual steps, cross-variable feedback and an assumed rate rule
update standardised growth. User shocks (−3 to +3 standard deviations) are added
with a 0.6 annual decay. Multiplicative level factors are nonnegative, and
employment/business-death percentages are clamped to 0–100. The rate rule uses
mean wage/employment growth and fixed assumed sensitivities, with a dimensionless
signal bounded −1 to +2; the stance control adds −1 to +1. It is not calibrated
to CPI, policy decisions or actual interest rates. FDI edits selected through a
LAD affect all modelled LADs in its region; multiple edits in one region are
averaged. Other area edits are local, with possible shared rate feedback.

This is an exploratory correlation scenario, not a validated economic forecast
or causal model. There is no confidence interval, out-of-sample validation,
inflation adjustment or disaster model. National summaries are unweighted LAD
means except FDI, which sums regional output. Missing historical observations
remain null; source data is never rewritten by scenario controls.

## Application integration

`GET /api/forecast` accepts `shock_<variable>`, `rate_bias` and JSON `area_shocks`.
Unknown, repeated, nonfinite or out-of-range inputs return 400. Area edits accept
model LAD codes, at most 200 areas. Responses include years, observations,
projections, model inputs, source years, coverage, fixed baseline ranges and
model notes, with gzip/ETag support. Core UI surfaces reuse recorded fixed
scales; rain/arrows use fixed baseline model ranges.

The sole UI controller, `GUI/forecast.js`, maps LAD names to planning authorities.
Simulation mode supplies 2026–2035 to `GUI/timeline.js`; switching off restores
recorded positions. The existing WebGL renderer updates heights, contours and
colours for income/density/employment, and the business-closure field follows the
selected simulated year. Weekly pay rain, fixed-size regional investment arrow concentrations and the
rate readout share the map and stacked legends. Rain/wind controls live under Additional data and also work with recorded values; their legends disclose the actual available source year. All app sliders share the pixel-style thumb/track treatment. Areas outside coverage use the
same no-data colour in both views. All simulated years and selected-area values
are labelled. Capri uses the applied scenario, not pending slider edits.

## Export

From the repository root after `uv sync`:

```powershell
uv run python "financial_ forecast/src/backend/simulation.py"
uv run python "financial_ forecast/src/backend/simulation.py" --output "financial_ forecast/build/scenario.json" --inputs '{"shocks":{"income":1}}'
```

The default workbook is generated under ignored `build/`. The CLI does not
modify the source workbook or research spreadsheets.
