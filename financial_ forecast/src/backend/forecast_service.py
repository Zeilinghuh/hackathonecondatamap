"""Forecast service for the UK economic-terrain map.

Place next to server.py (src/backend/). It reads assets/data/all-datasets.xlsx once
(in a background thread), fits the Pearson growth matrix, and can re-run the damped
iteration in milliseconds, so the browser can apply "what if" shocks.

Variables: income (sheet 16), weeklypay (17), fdi (26, regional), deaths (32),
density (3), employment (11).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import threading
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

# ------------------------------ settings -------------------------------------
POST_COVID_FROM = 2022      # business deaths: only years >= this feed the model
FLAT_DRIFT = ("deaths",)    # no built-in trend; moves only via the other variables
K_SHRINK = 500              # evidence-weighted shrinkage r * n/(n+K)
TARGET_RADIUS = 0.9         # feedback damping, must be < 1
HORIZON = 10                # years projected after 2025
FIRST_YEAR = 2010           # first year sent to the browser
LAST_REAL_YEAR = 2025

# interest-rate (Taylor-type) rule - assumed, not estimated
A_INFL, A_GAP = 0.5, 0.5
RATE_LIMITS = (-1.0, 2.0)
RATE_SENS = {"income": -0.15, "weeklypay": -0.25, "fdi": -0.20,
             "deaths": +0.15, "density": 0.0, "employment": -0.10}

SHEETS = {"16": "income", "17": "weeklypay", "26": "fdi", "32": "deaths", "3": "density", "11": "employment"}
VARS = list(SHEETS.values())
GRID_YEARS = list(range(1991, LAST_REAL_YEAR + 1))

LABELS = {
    "income": ("Gross disposable household income per head", "GBP"),
    "weeklypay": ("Median gross weekly pay", "GBP/week"),
    "fdi": ("Inward foreign direct investment", "GBP million"),
    "deaths": ("Business deaths", "% of businesses"),
    "density": ("Population density", "people per km2"),
    "employment": ("Employment rate (16-64)", "%"),
}

REGIONS = {  # code: (name, lat, lon)
    "E12000001": ("North East", 54.95, -1.75),
    "E12000002": ("North West", 53.95, -2.65),
    "E12000003": ("Yorkshire and The Humber", 53.85, -1.15),
    "E12000004": ("East Midlands", 52.85, -0.95),
    "E12000005": ("West Midlands", 52.50, -2.20),
    "E12000006": ("East of England", 52.30, 0.55),
    "E12000007": ("London", 51.50, -0.12),
    "E12000008": ("South East", 51.25, -0.85),
    "E12000009": ("South West", 50.95, -3.45),
}

# ------------------------- LAD -> region lookup ------------------------------
# Validated: summed LAD populations match every E12 region total in sheet 1 exactly.
_N = {"NE": "E12000001", "NW": "E12000002", "YH": "E12000003", "EM": "E12000004", "WM": "E12000005",
      "EE": "E12000006", "LON": "E12000007", "SE": "E12000008", "SW": "E12000009"}
_E06 = {
    "NE": [1, 2, 3, 4, 5, 47, 57], "NW": [6, 7, 8, 9, 49, 50, 63, 64],
    "YH": [10, 11, 12, 13, 14, 65], "EM": [15, 16, 17, 18, 61, 62], "WM": [19, 20, 21, 51],
    "EE": [31, 32, 33, 34, 55, 56], "SE": [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 60],
    "SW": [22, 23, 24, 25, 26, 27, 30, 52, 53, 54, 58, 59, 66],
}
_E07 = {
    "EE": [(8, 12), (66, 77), (95, 103), (143, 149), (200, 203), (240, 245)],
    "EM": [(32, 39), (129, 142), (170, 176)], "SW": [(40, 47), (78, 83)],
    "SE": [(61, 65), (84, 94), (105, 116), (177, 181), (207, 217), (223, 229)],
    "NW": [(117, 128)], "WM": [(192, 199), (218, 222), (234, 239)],
}
_E08 = {"NW": [(1, 15)], "YH": [(16, 19), (32, 36)], "NE": [(21, 24), (37, 37)], "WM": [(25, 31)]}


def lad_to_region(code: str) -> str | None:
    p, n = code[:3], int(code[3:])
    if p == "E09":
        return _N["LON"]
    if p == "E06":
        return next((_N[k] for k, v in _E06.items() if n in v), None)
    table = _E07 if p == "E07" else _E08 if p == "E08" else {}
    return next((_N[k] for k, v in table.items() if any(a <= n <= b for a, b in v)), None)


# ------------------------------ loading --------------------------------------
def _load_keyed(src: Path, sheet: str) -> tuple[pd.DataFrame, dict[str, str]]:
    raw = pd.read_excel(src, sheet_name=sheet, header=None)
    h = raw.index[raw[0].astype(str).str.strip() == "Area code"][0]
    df = raw.iloc[h + 1:].copy()
    df.columns = raw.iloc[h].tolist()
    df = df[df["Area code"].astype(str).str.match(r"^[A-Z]\d{8}$")]
    if "Measure" in df.columns:
        df = df[df["Measure"] == "Observation value"]
    names = dict(zip(df["Area code"], df["Area name"]))
    df = df.set_index("Area code").drop(columns=[c for c in ["Area name", "Measure"] if c in df.columns])
    df.columns = [int(str(c)[:4]) for c in df.columns]
    return df.apply(pd.to_numeric, errors="coerce"), names


def _clean(a: np.ndarray, nd: int) -> list:
    """numpy -> JSON-safe nested list (NaN -> None)."""
    return np.where(np.isnan(a), None, np.round(a, nd)).tolist()


class ForecastService:
    def __init__(self, xlsx_path: Path) -> None:
        self.src = Path(xlsx_path)
        self._lock = threading.Lock()
        self._s: dict | None = None
        self._cache: dict[str, tuple[bytes, bytes, str]] = {}

    # ------------------------------------------------------------------ fit
    def prepare(self) -> None:
        with self._lock:
            if self._s is not None:
                return
            raw, names = {}, {}
            for sheet, v in SHEETS.items():
                raw[v], nm = _load_keyed(self.src, sheet)
                names.update(nm)
            display = {v: d.copy() for v, d in raw.items()}      # full history for the map
            raw["deaths"] = raw["deaths"].loc[:, [c for c in raw["deaths"].columns if c >= POST_COVID_FROM]]

            lads = sorted({c for v, d in raw.items() if v != "fdi" for c in d.index if c[:3] in ("E06", "E07", "E08", "E09")})
            region_of = pd.Series({c: lad_to_region(c) for c in lads})
            for store in (raw, display):
                f = store["fdi"].reindex(region_of.values)       # regional value copied onto each LAD
                f.index = region_of.index
                store["fdi_lad"] = f
            fdi_region_hist = display["fdi"]                      # untouched regional rows

            levels, observed, growth, valid = {}, {}, {}, {}
            for v in VARS:
                d = (raw["fdi_lad"] if v == "fdi" else raw[v]).reindex(index=lads, columns=GRID_YEARS)
                observed[v], levels[v] = d.notna(), d.fillna(0.0)
            for v in VARS:
                L, ok = levels[v], observed[v]
                both = ok & ok.shift(1, axis=1, fill_value=False)
                prev = L.shift(1, axis=1)
                g = ((L - prev) / prev.replace(0, np.nan)).where(both)
                valid[v], growth[v] = g.notna(), g.fillna(0.0)

            long = pd.concat({v: growth[v].where(valid[v]).stack() for v in VARS}, axis=1)
            long = long.clip(long.quantile(0.01), long.quantile(0.99), axis=1)
            R = long.corr(method="pearson").loc[VARS, VARS].to_numpy(copy=True)
            np.fill_diagonal(R, 0.0)
            n = np.array([[(long[a].notna() & long[b].notna()).sum() for b in VARS] for a in VARS], float)
            R = R * n / (n + K_SHRINK) if K_SHRINK else R
            alpha = TARGET_RADIUS / max(abs(np.linalg.eigvals(R)))
            mu, sigma = long.mean(), long.std()
            for v in FLAT_DRIFT:
                mu[v] = 0.0

            def last_real(tbl, mask):
                pos = mask.values[:, ::-1].argmax(axis=1)
                vals = tbl.values[np.arange(len(tbl)), len(GRID_YEARS) - 1 - pos]
                return pd.Series(np.where(mask.values.any(axis=1), vals, np.nan), index=tbl.index)

            L0 = pd.DataFrame({v: last_real(levels[v], observed[v]) for v in VARS})
            G0 = pd.DataFrame({v: last_real(growth[v], valid[v]) for v in VARS})
            Z0 = (G0 - mu) / sigma
            keep = L0.notna().all(axis=1) & Z0.notna().all(axis=1)
            L0, Z0 = L0[keep], Z0[keep].clip(-3, 3)

            hist_years = list(range(FIRST_YEAR, LAST_REAL_YEAR + 1))
            hist = {}
            for v in VARS:
                src_tbl = display["fdi_lad"] if v == "fdi" else display[v]
                h = src_tbl.reindex(index=L0.index, columns=hist_years).astype(float)
                hist[v] = h.ffill(axis=1).to_numpy()              # carry last real value across the gap to 2025

            region_hist = fdi_region_hist.reindex(index=list(REGIONS), columns=hist_years).astype(float).ffill(axis=1)
            self._s = dict(
                codes=list(L0.index), names=[names.get(c, c) for c in L0.index],
                regions=[region_of[c] for c in L0.index], R=R, alpha=alpha, mu=mu[VARS].to_numpy(),
                sigma=sigma[VARS].to_numpy(), L0=L0[VARS].to_numpy(), Z0=Z0[VARS].to_numpy(),
                hist=hist, hist_years=hist_years, region_hist=region_hist.to_numpy(),
                rate_pairs=n.astype(int).tolist(),
            )

    # ------------------------------------------------------------------ run
    def run(self, shocks: dict[str, float] | None = None, rate_bias: float = 0.0) -> dict:
        self.prepare()
        s = self._s
        sens = np.array([RATE_SENS[v] for v in VARS])
        iw, ie, idt = VARS.index("weeklypay"), VARS.index("employment"), VARS.index("deaths")
        Z, L = s["Z0"].copy(), s["L0"].copy()
        for v, z in (shocks or {}).items():                        # what-if: push a variable's starting growth
            Z[:, VARS.index(v)] += z
        proj, rate = np.zeros((len(VARS), len(L), HORIZON)), []
        for t in range(HORIZON):
            Zn = s["alpha"] * Z @ s["R"].T
            sig = float(np.clip(A_INFL * Z[:, iw].mean() + A_GAP * Z[:, ie].mean() + rate_bias, *RATE_LIMITS))
            Z = Zn + sig * sens
            rate.append(sig)
            L = L * (1 + s["mu"] + s["sigma"] * Z)
            L[:, idt] = L[:, idt].clip(0, 100)
            L[:, ie] = L[:, ie].clip(0, 100)
            proj[:, :, t] = L.T

        years = s["hist_years"] + list(range(LAST_REAL_YEAR + 1, LAST_REAL_YEAR + 1 + HORIZON))
        values, national = {}, {}
        for j, v in enumerate(VARS):
            full = np.concatenate([s["hist"][v], proj[j]], axis=1)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)   # early deaths years are all-empty
                national[v] = _clean(np.nanmean(full, axis=0), 3)
            if v != "fdi":                                         # fdi is sent per region below
                values[v] = _clean(full, 2)
        reg_codes = list(REGIONS)
        fdi_full = np.concatenate([s["hist"]["fdi"], proj[VARS.index("fdi")]], axis=1)
        reg_proj = np.array([fdi_full[[r == c for r in s["regions"]]][:, len(s["hist_years"]):].mean(axis=0) for c in reg_codes])
        fdi_regions = np.concatenate([s["region_hist"], reg_proj], axis=1)

        ranges = {}
        for j, v in enumerate(VARS):
            arr = fdi_regions if v == "fdi" else np.concatenate([s["hist"][v], proj[j]], axis=1)
            lo, hi = np.nanpercentile(arr, [2, 98])
            ranges[v] = [round(float(lo), 3), round(float(hi), 3)]
        return {
            "years": years, "projected_from": LAST_REAL_YEAR + 1,
            "variables": {v: {"label": LABELS[v][0], "unit": LABELS[v][1], "range": ranges[v]} for v in VARS},
            "areas": [{"code": c, "name": n, "region": r} for c, n, r in zip(s["codes"], s["names"], s["regions"])],
            "values": values,
            "regions": [{"code": c, "name": REGIONS[c][0], "lat": REGIONS[c][1], "lon": REGIONS[c][2],
                         "fdi": _clean(fdi_regions[i], 1)} for i, c in enumerate(reg_codes)],
            "national": national,
            "rate": [None] * len(s["hist_years"]) + [round(x, 3) for x in rate],
            "rate_limits": list(RATE_LIMITS),
            "matrix": {"vars": VARS, "values": np.round(s["alpha"] * s["R"], 3).tolist()},
            "inputs": {"shocks": shocks or {}, "rate_bias": rate_bias},
        }

    def response(self, shocks: dict[str, float] | None = None, rate_bias: float = 0.0) -> tuple[bytes, bytes, str]:
        key = json.dumps([sorted((shocks or {}).items()), round(rate_bias, 3)])
        if key not in self._cache:
            body = json.dumps(self.run(shocks, rate_bias), separators=(",", ":"), allow_nan=False).encode()
            etag = '"' + hashlib.sha1(body).hexdigest()[:16] + '"'
            if len(self._cache) > 64:
                self._cache.clear()
            self._cache[key] = (body, gzip.compress(body), etag)
        return self._cache[key]
