"""
UK economic simulation - consolidated.
  1. load sheets 16,17,26,32,3,11 keyed by area code (missing years = 0, with an 'observed' mask)
  2. FDI (regional) copied onto every local authority in that region
  3. business deaths: post-COVID years only; its drift is held flat
  4. correlations on levels AND growth, Pearson vs Spearman side by side
  5. ridge-style damping of the coefficient matrix, then the iteration
  6. simulate(): the iteration as a function, so the map can push shocks into it
       - shocks        {variable: z}              every area, e.g. {"income": 1.0}
       - area_shocks   {code: {variable: z}}      one authority (FDI: its whole region)
       - rate_bias     -1..1                      extra push on the interest-rate signal
     With no arguments it gives exactly the same projection as before.
  7. build_payload() / forecast_payload(): the JSON the front end (forecast.js) reads from /api/forecast
     (years with no data go out as 0, matching the zero-filled grid; set ZERO_FILL_MISSING = False for null)

Running this file directly still writes the Excel report and prints the summary.
"""
import json
import os

import numpy as np
import pandas as pd

# ------------------------------ settings -------------------------------------
SRC = os.environ.get("FORECAST_SRC", "financial_ forecast/assets/data/all-datasets.xlsx")          # <- change to your local path
OUT = os.environ.get("FORECAST_OUT", "financial_ forecast/src/backend/matrixcoefffitting/minimatrices/simulation.xlsx")  # <- change to your local path

METHOD = "pearson"          # "pearson" or "spearman" - which matrix drives the simulation
POST_COVID_FROM = 2022      # business deaths: only years >= this count as data
FLAT_DRIFT = ["deaths"]     # variables with no built-in trend (move only via the others)
K_SHRINK = 500              # ridge-like shrinkage: r * n/(n+K); 0 = off. thin evidence -> pulled to 0
TARGET_RADIUS = 0.9         # feedback damping: largest eigenvalue of the loop (must be < 1)
HORIZON = 10

# interest-rate style damping (Taylor-type rule). ASSUMED, not estimated - tune or switch off.
RATE_RULE = True
A_INFL = 0.5     # reaction to wage inflation (weekly-pay growth is the inflation proxy; no CPI in these sheets)
A_GAP = 0.5      # reaction to labour-market tightness (employment growth)
RATE_LIMITS = (-1.0, 2.0)   # floor/ceiling on the rate signal (cuts are milder than hikes)
# how strongly a +1 rate signal pushes each variable's growth (in z units); negative = slows it
RATE_SENS = {"income": -0.15, "weeklypay": -0.25, "fdi": -0.20, "deaths": +0.15, "density": 0.0, "employment": -0.10}

# user edits from the map (weather sliders). ASSUMED, tune to taste.
SHOCK_DECAY = 0.6    # an edit is a push to growth that fades by this factor each projected year
SHOCK_LIMIT = 3.0    # sliders are clipped to +/- this many z units
MAX_EDITED_AREAS = 200

ZERO_FILL_MISSING = True   # years with no data are sent to the map as 0 (your zero-filled grid); False sends null

SHEETS = {"16": "income", "17": "weeklypay", "26": "fdi", "32": "deaths", "3": "density", "11": "employment"}
VARS = list(SHEETS.values())
YEARS = list(range(1991, 2026))

# ------------------------- LAD -> region lookup ------------------------------
# validated: summed LAD populations match every E12 region total in sheet 1 exactly

REGION_CODE = {"NE": "E12000001", "NW": "E12000002", "YH": "E12000003", "EM": "E12000004", "WM": "E12000005",
               "EE": "E12000006", "LON": "E12000007", "SE": "E12000008", "SW": "E12000009"}

# name, longitude, latitude (approximate centres, used to place wind arrows)
REGION_META = {
    "E12000001": ("North East", -1.70, 54.90), "E12000002": ("North West", -2.70, 54.00),
    "E12000003": ("Yorkshire and The Humber", -1.20, 53.90), "E12000004": ("East Midlands", -0.90, 52.90),
    "E12000005": ("West Midlands", -2.20, 52.50), "E12000006": ("East of England", 0.50, 52.30),
    "E12000007": ("London", -0.12, 51.50), "E12000008": ("South East", -0.80, 51.30),
    "E12000009": ("South West", -3.30, 50.90),
}

# E06 unitary authorities, by last 3 digits of the code
E06 = {
    "NE": [1, 2, 3, 4, 5, 47, 57],
    "NW": [6, 7, 8, 9, 49, 50, 63, 64],
    "YH": [10, 11, 12, 13, 14, 65],
    "EM": [15, 16, 17, 18, 61, 62],
    "WM": [19, 20, 21, 51],
    "EE": [31, 32, 33, 34, 55, 56],
    "SE": [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 60],
    "SW": [22, 23, 24, 25, 26, 27, 30, 52, 53, 54, 58, 59, 66],
}
# E07 districts, by (first, last) code ranges (inclusive)
E07 = {
    "EE": [(8, 12), (66, 77), (95, 103), (143, 149), (200, 203), (240, 245)],
    "EM": [(32, 39), (129, 142), (170, 176)],
    "SW": [(40, 47), (78, 83)],
    "SE": [(61, 65), (84, 94), (105, 116), (177, 181), (207, 217), (223, 229)],
    "NW": [(117, 128)],
    "WM": [(192, 199), (218, 222), (234, 239)],
}
# E08 metropolitan boroughs
E08 = {"NW": (1, 15), "YH": [(16, 19), (32, 36)], "NE": [(21, 24), (37, 37)], "WM": (25, 31)}


def _in(n, spec):
    spec = [spec] if isinstance(spec, tuple) else spec
    return any(a <= n <= b for a, b in spec)


def lad_to_region(code):
    p, n = code[:3], int(code[3:])
    if p == "E09":
        return REGION_CODE["LON"]
    if p == "E06":
        return next((REGION_CODE[k] for k, v in E06.items() if n in v), None)
    if p == "E07":
        return next((REGION_CODE[k] for k, v in E07.items() if _in(n, v)), None)
    if p == "E08":
        return next((REGION_CODE[k] for k, v in E08.items() if _in(n, v)), None)
    return None

# ------------------------------ 1. load --------------------------------------
NAMES = {}          # area code -> area name, picked up while loading


def load_keyed(name):
    raw = pd.read_excel(SRC, sheet_name=name, header=None)
    h = raw.index[raw[0].astype(str).str.strip() == "Area code"][0]
    df = raw.iloc[h + 1:].copy()
    df.columns = raw.iloc[h].tolist()
    df = df[df["Area code"].astype(str).str.match(r"^[A-Z]\d{8}$")]
    if "Measure" in df.columns:
        df = df[df["Measure"] == "Observation value"]
    df = df.set_index("Area code")
    if "Area name" in df.columns:
        for code, nm in df["Area name"].items():
            NAMES.setdefault(code, str(nm).strip())
    df = df.drop(columns=[c for c in ["Area name", "Measure"] if c in df.columns])
    df.columns = [int(str(c)[:4]) for c in df.columns]
    return df.apply(pd.to_numeric, errors="coerce")           # [x]/[c]/[u] -> NaN


raw = {v: load_keyed(k) for k, v in SHEETS.items()}
raw["deaths"] = raw["deaths"].loc[:, [c for c in raw["deaths"].columns if c >= POST_COVID_FROM]]

# ------------------------------ 2. areas + FDI by region ---------------------
lad_codes = sorted({c for v, d in raw.items() if v != "fdi" for c in d.index
                    if c[:3] in ("E06", "E07", "E08", "E09")})
region_of = pd.Series({c: lad_to_region(c) for c in lad_codes})
fdi = raw["fdi"].reindex(region_of.values)
fdi.index = region_of.index
raw["fdi"] = fdi

# ------------------------------ 3. zero-filled grid + masks ------------------
levels, observed, growth, valid = {}, {}, {}, {}
for v, d in raw.items():
    d = d.reindex(index=lad_codes, columns=YEARS)
    observed[v], levels[v] = d.notna(), d.fillna(0.0)
for v in VARS:
    L, ok = levels[v], observed[v]
    both = ok & ok.shift(1, axis=1, fill_value=False)         # change only between two real years
    prev = L.shift(1, axis=1)
    g = ((L - prev) / prev.replace(0, np.nan)).where(both)
    valid[v], growth[v] = g.notna(), g.fillna(0.0)

# ------------------------------ 4. correlations: levels vs growth, both methods
def to_long(tbl, mask):
    return pd.concat({v: tbl[v].where(mask[v]).stack() for v in VARS}, axis=1)

lev_long = to_long(levels, observed)
gro_long = to_long(growth, valid)
gro_long = gro_long.clip(gro_long.quantile(0.01), gro_long.quantile(0.99), axis=1)   # tame outliers

n_pairs = pd.DataFrame({a: {b: int((gro_long[a].notna() & gro_long[b].notna()).sum()) for b in VARS} for a in VARS})
corr = {(lab, m): d.corr(method=m) for lab, d in [("levels", lev_long), ("growth", gro_long)]
        for m in ("pearson", "spearman")}

# ------------------------------ 5. ridge-style damping -----------------------
R = corr[("growth", METHOD)].loc[VARS, VARS].to_numpy(copy=True)
np.fill_diagonal(R, 0.0)                                       # no direct self-effect
N = n_pairs.loc[VARS, VARS].to_numpy(dtype=float)
R_shrunk = R * N / (N + K_SHRINK) if K_SHRINK else R.copy()    # (a) evidence-weighted shrinkage
radius = max(abs(np.linalg.eigvals(R_shrunk)))
ALPHA = TARGET_RADIUS / radius                                 # (b) spectral damping, loop radius = TARGET_RADIUS

mu, sigma = gro_long.mean(), gro_long.std()
mu[FLAT_DRIFT] = 0.0

# ------------------------------ 6. start state -------------------------------
def last_real(tbl, mask):
    pos = mask.values[:, ::-1].argmax(axis=1)
    has = mask.values.any(axis=1)
    vals = tbl.values[np.arange(len(tbl)), len(YEARS) - 1 - pos]
    return pd.Series(np.where(has, vals, np.nan), index=tbl.index)

L0 = pd.DataFrame({v: last_real(levels[v], observed[v]) for v in VARS})
G0 = pd.DataFrame({v: last_real(growth[v], valid[v]) for v in VARS})
Z0 = (G0 - mu) / sigma
keep = L0.notna().all(axis=1) & Z0.notna().all(axis=1)
L0, Z0 = L0[keep], Z0[keep].clip(-3, 3)

sens = np.array([RATE_SENS[v] for v in VARS])
iw, ie = VARS.index("weeklypay"), VARS.index("employment")
REGION_OF = region_of.reindex(L0.index)
POS = {c: i for i, c in enumerate(L0.index)}


# ------------------------------ 7. iterate (as a function) -------------------
def _shock_matrix(shocks, area_shocks):
    """areas x variables matrix of the growth push (z units) the user has asked for."""
    S = np.zeros((len(L0), len(VARS)))
    clip = lambda x: float(np.clip(x, -SHOCK_LIMIT, SHOCK_LIMIT))

    for v, x in (shocks or {}).items():                        # whole-UK what-if
        if v in VARS and x:
            S[:, VARS.index(v)] += clip(x)

    fdi_by_region = {}                                         # FDI is regional: average the edits within a region
    for code, edits in list((area_shocks or {}).items())[:MAX_EDITED_AREAS]:
        if code not in POS or not isinstance(edits, dict):
            continue
        for v, x in edits.items():
            if v not in VARS or not x:
                continue
            if v == "fdi":
                fdi_by_region.setdefault(REGION_OF[code], []).append(clip(x))
            else:
                S[POS[code], VARS.index(v)] += clip(x)
    for region, xs in fdi_by_region.items():
        S[(REGION_OF == region).to_numpy(), VARS.index("fdi")] += float(np.mean(xs))
    return S


def simulate(shocks=None, area_shocks=None, rate_bias=0.0, horizon=HORIZON):
    """Run the projection. Returns ({variable: DataFrame(area x year)}, [rate signal per year])."""
    S = _shock_matrix(shocks, area_shocks)
    rate_bias = float(np.clip(rate_bias or 0.0, -1.0, 1.0))
    Z, L = Z0[VARS].to_numpy(copy=True), L0[VARS].to_numpy(copy=True)
    proj = {v: {} for v in VARS}
    rate_path = []
    for step in range(1, horizon + 1):
        Zn = ALPHA * Z @ R_shrunk.T                            # knock-on effects between variables
        if RATE_RULE or rate_bias:
            # central bank reacts to last period's national overheating, then everyone feels it
            signal = rate_bias
            if RATE_RULE:
                signal += A_INFL * Z[:, iw].mean() + A_GAP * Z[:, ie].mean()
            signal = float(np.clip(signal, *RATE_LIMITS))
            Zn = Zn + signal * sens                            # same signal for every area
            rate_path.append(signal)
        Zn = Zn + S * SHOCK_DECAY ** (step - 1)                # the user's push, fading
        Z = Zn
        L = L * np.maximum(1 + mu.values + sigma.values * Z, 0.0)   # back to real units
        for v in ("employment", "deaths"):
            L[:, VARS.index(v)] = L[:, VARS.index(v)].clip(0, 100)
        for j, v in enumerate(VARS):
            proj[v][2025 + step] = L[:, j].copy()
    return {v: pd.DataFrame(d, index=L0.index) for v, d in proj.items()}, rate_path


# ------------------------------ 8. payload for the map -----------------------
_RANGES = {}


def _clean(a, nd=2):
    fill = 0.0 if ZERO_FILL_MISSING else None
    return [fill if not np.isfinite(x) else round(float(x), nd) for x in a]


def build_payload(shocks=None, area_shocks=None, rate_bias=0.0):
    proj, rate_path = simulate(shocks, area_shocks, rate_bias)
    years = YEARS + list(range(2026, 2026 + HORIZON))
    idx = L0.index

    # NaN = no data. Colour ranges and national averages use only real observations;
    # _clean() turns the gaps into 0 (or null) on the way out.
    full = {v: pd.concat([levels[v].where(observed[v]).loc[idx], proj[v]], axis=1) for v in VARS}

    if not _RANGES:                                            # colour ranges come from the no-edit run so they stay fixed
        base = full if not (shocks or area_shocks or rate_bias) else {
            v: pd.concat([levels[v].where(observed[v]).loc[idx], simulate()[0][v]], axis=1) for v in VARS}
        for v in VARS:
            vals = base[v].to_numpy().ravel()
            vals = vals[np.isfinite(vals)]
            lo, hi = np.percentile(vals, [1, 99])
            _RANGES[v] = [round(float(lo), 2), round(float(max(hi, lo + 1e-6)), 2)]

    regions = []
    for code, (name, lon, lat) in REGION_META.items():
        inside = (REGION_OF == code).to_numpy()
        if not inside.any():
            continue
        series = full["fdi"][inside].mean(axis=0).to_numpy()
        regions.append({"code": code, "name": name, "lon": lon, "lat": lat, "fdi": _clean(series, 1)})

    national = {v: _clean(full[v].mean(axis=0).to_numpy()) for v in VARS}
    national["fdi"] = [round(sum(r["fdi"][i] or 0 for r in regions), 1) for i in range(len(years))]
    if not ZERO_FILL_MISSING:
        national["fdi"] = [x if x else None for x in national["fdi"]]

    return {
        "years": years,
        "projected_from": 2026,
        "variables": {v: {"range": _RANGES[v]} for v in VARS},
        "regions": regions,
        "areas": [{"code": c, "name": NAMES.get(c, c), "region": REGION_OF[c]} for c in idx],
        "values": {v: [_clean(row) for row in full[v].to_numpy()] for v in VARS},
        "national": national,
        "rate": [None] * len(YEARS) + (_clean(rate_path, 3) if rate_path else [None] * HORIZON),
        "rate_limits": list(RATE_LIMITS),
    }


def forecast_payload(params):
    """params: dict of query-string values, e.g. {"shock_income": "1", "rate_bias": "0.5", "area_shocks": "{...}"}"""
    def num(x):
        try:
            return float(x)
        except (TypeError, ValueError):
            return 0.0
    shocks = {k[6:]: num(v) for k, v in params.items() if k.startswith("shock_")}
    try:
        area_shocks = json.loads(params.get("area_shocks") or "{}")
    except ValueError:
        area_shocks = {}
    if not isinstance(area_shocks, dict):
        area_shocks = {}
    area_shocks = {c: {v: num(x) for v, x in e.items()} for c, e in area_shocks.items() if isinstance(e, dict)}
    return build_payload(shocks, area_shocks, num(params.get("rate_bias")))


# ------------------------------ 9. save + report -----------------------------
def save_workbook(proj, rate_path):
    with pd.ExcelWriter(OUT) as xw:
        for (lab, m), c in corr.items():
            c.round(3).to_excel(xw, sheet_name=f"{lab}_{m}")
        n_pairs.to_excel(xw, sheet_name="pairs_used")
        pd.DataFrame(R_shrunk, index=VARS, columns=VARS).round(3).to_excel(xw, sheet_name="matrix_used")
        if rate_path:
            pd.Series(rate_path, index=range(2026, 2026 + HORIZON), name="rate_signal").to_excel(xw, sheet_name="rate_path")
        for v in VARS:
            pd.concat([levels[v].loc[L0.index], proj[v]], axis=1).to_excel(xw, sheet_name=f"{v}_zero_filled+proj")


if __name__ == "__main__":
    proj, rate_path = simulate()
    save_workbook(proj, rate_path)
    pd.set_option("display.width", 200)
    print(f"{len(L0)} areas simulated | method={METHOD} K_SHRINK={K_SHRINK} radius {radius:.3f} -> alpha {ALPHA:.3f}")
    for k in [("growth", "pearson"), ("growth", "spearman")]:
        print(f"\n{k[0]} / {k[1]}\n", corr[k].round(2))
    if rate_path:
        print("\nrate signal by year (positive = hike):", [round(x, 2) for x in rate_path])
    summ = pd.DataFrame({v: [L0[v].mean(), proj[v][2030].mean(), proj[v][2035].mean()] for v in VARS},
                        index=["latest", 2030, 2035]).T
    print("\nmean across areas:\n", summ.round(2))
