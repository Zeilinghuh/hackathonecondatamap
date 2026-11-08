"""
UK economic simulation - consolidated.
  1. load sheets 16,17,26,32,3,11 keyed by area code (missing years = 0, with an 'observed' mask)
  2. FDI (regional) copied onto every local authority in that region
  3. business deaths: post-COVID years only; its drift is held flat
  4. correlations on levels AND growth, Pearson vs Spearman side by side
  5. ridge-style damping of the coefficient matrix, then the iteration
"""
import numpy as np
import pandas as pd

# ------------------------------ settings -------------------------------------
SRC = "financial_ forecast/assets/data/all-datasets.xlsx"          # <- change to your local path
OUT = "financial_ forecast/src/backend/matrixcoefffitting/minimatrices/simulation.xlsx"  # <- change to your local path

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

SHEETS = {"16": "income", "17": "weeklypay", "26": "fdi", "32": "deaths", "3": "density", "11": "employment"}
VARS = list(SHEETS.values())
YEARS = list(range(1991, 2026))

# ------------------------- LAD -> region lookup ------------------------------
# validated: summed LAD populations match every E12 region total in sheet 1 exactly

R = {"NE": "E12000001", "NW": "E12000002", "YH": "E12000003", "EM": "E12000004", "WM": "E12000005",
     "EE": "E12000006", "LON": "E12000007", "SE": "E12000008", "SW": "E12000009"}

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
        return R["LON"]
    if p == "E06":
        return next((R[k] for k, v in E06.items() if n in v), None)
    if p == "E07":
        return next((R[k] for k, v in E07.items() if _in(n, v)), None)
    if p == "E08":
        return next((R[k] for k, v in E08.items() if _in(n, v)), None)
    return None

# ------------------------------ 1. load --------------------------------------
def load_keyed(name):
    raw = pd.read_excel(SRC, sheet_name=name, header=None)
    h = raw.index[raw[0].astype(str).str.strip() == "Area code"][0]
    df = raw.iloc[h + 1:].copy()
    df.columns = raw.iloc[h].tolist()
    df = df[df["Area code"].astype(str).str.match(r"^[A-Z]\d{8}$")]
    if "Measure" in df.columns:
        df = df[df["Measure"] == "Observation value"]
    df = df.set_index("Area code").drop(columns=[c for c in ["Area name", "Measure"] if c in df.columns])
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

# ------------------------------ 7. iterate -----------------------------------
sens = np.array([RATE_SENS[v] for v in VARS])
iw, ie = VARS.index("weeklypay"), VARS.index("employment")
Z, L = Z0[VARS].to_numpy(copy=True), L0[VARS].to_numpy(copy=True)
proj = {v: {} for v in VARS}
rate_path = []
for step in range(1, HORIZON + 1):
    Zn = ALPHA * Z @ R_shrunk.T                                # knock-on effects between variables
    if RATE_RULE:
        # central bank reacts to last period's national overheating, then everyone feels it
        signal = A_INFL * Z[:, iw].mean() + A_GAP * Z[:, ie].mean()
        signal = float(np.clip(signal, *RATE_LIMITS))
        Zn = Zn + signal * sens                                # same signal for every area
        rate_path.append(signal)
    Z = Zn
    L = L * (1 + mu.values + sigma.values * Z)                 # back to real units
    for v in ("employment", "deaths"):
        L[:, VARS.index(v)] = L[:, VARS.index(v)].clip(0, 100)
    for j, v in enumerate(VARS):
        proj[v][2025 + step] = L[:, j].copy()
proj = {v: pd.DataFrame(d, index=L0.index) for v, d in proj.items()}

# ------------------------------ 8. save + report -----------------------------
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
    pd.set_option("display.width", 200)
    print(f"{len(L0)} areas simulated | method={METHOD} K_SHRINK={K_SHRINK} radius {radius:.3f} -> alpha {ALPHA:.3f}")
    for k in [("growth", "pearson"), ("growth", "spearman")]:
        print(f"\n{k[0]} / {k[1]}\n", corr[k].round(2))
    if rate_path:
        print("\nrate signal by year (positive = hike):", [round(x, 2) for x in rate_path])
    summ = pd.DataFrame({v: [L0[v].mean(), proj[v][2030].mean(), proj[v][2035].mean()] for v in VARS},
                        index=["latest", 2030, 2035]).T
    print("\nmean across areas:\n", summ.round(2))