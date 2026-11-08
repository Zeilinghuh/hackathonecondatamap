"""Forecast service for the UK economic-terrain map.

It reads assets/data/all-datasets.xlsx once on first use, fits the Pearson growth matrix, and can re-run the damped
iteration in milliseconds, so the browser can apply "what if" shocks.

Variables: income (sheet 16), weeklypay (17), fdi (26, regional), deaths (32),
density (3), employment (11).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
import threading
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

# ------------------------------ settings -------------------------------------
POST_COVID_FROM = 2022  # business deaths: only years >= this feed the model
FLAT_DRIFT = ("deaths",)  # no built-in trend; moves only via the other variables
K_SHRINK = 500  # evidence-weighted shrinkage r * n/(n+K)
TARGET_RADIUS = 0.9  # feedback damping, must be < 1
HORIZON = 10  # years projected after 2025
FIRST_YEAR = 2010  # first year sent to the browser
LAST_REAL_YEAR = 2025
SHOCK_DECAY = 0.6
MAX_EDITED_AREAS = 200

# interest-rate (Taylor-type) rule - assumed, not estimated
A_INFL, A_GAP = 0.5, 0.5
RATE_LIMITS = (-1.0, 2.0)
RATE_SENS = {
    "income": -0.15,
    "weeklypay": -0.25,
    "fdi": -0.20,
    "deaths": +0.15,
    "density": 0.0,
    "employment": -0.10,
}

SHEETS = {
    "16": "income",
    "17": "weeklypay",
    "26": "fdi",
    "32": "deaths",
    "3": "density",
    "11": "employment",
}
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
    "S92000003": ("Scotland", 56.8, -4.2),
    "W92000004": ("Wales", 52.3, -3.7),
    "N92000002": ("Northern Ireland", 54.7, -6.7),
}

# ------------------------- LAD -> region lookup ------------------------------
# Validated: summed LAD populations match every E12 region total in sheet 1 exactly.
_N = {
    "NE": "E12000001",
    "NW": "E12000002",
    "YH": "E12000003",
    "EM": "E12000004",
    "WM": "E12000005",
    "EE": "E12000006",
    "LON": "E12000007",
    "SE": "E12000008",
    "SW": "E12000009",
}
_E06 = {
    "NE": [1, 2, 3, 4, 5, 47, 57],
    "NW": [6, 7, 8, 9, 49, 50, 63, 64],
    "YH": [10, 11, 12, 13, 14, 65],
    "EM": [15, 16, 17, 18, 61, 62],
    "WM": [19, 20, 21, 51],
    "EE": [31, 32, 33, 34, 55, 56],
    "SE": [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 60],
    "SW": [22, 23, 24, 25, 26, 27, 30, 52, 53, 54, 58, 59, 66],
}
_E07 = {
    "EE": [(8, 12), (66, 77), (95, 103), (143, 149), (200, 203), (240, 245)],
    "EM": [(32, 39), (129, 142), (170, 176)],
    "SW": [(40, 47), (78, 83)],
    "SE": [(61, 65), (84, 94), (105, 116), (177, 181), (207, 217), (223, 229)],
    "NW": [(117, 128)],
    "WM": [(192, 199), (218, 222), (234, 239)],
}
_E08 = {
    "NW": [(1, 15)],
    "YH": [(16, 19), (32, 36)],
    "NE": [(21, 24), (37, 37)],
    "WM": [(25, 31)],
}


def lad_to_region(code: str) -> str | None:
    if not isinstance(code, str) or len(code) != 9 or not code[3:].isdigit():
        return None
    p, n = code[:3], int(code[3:])
    country = {"S12": "S92000003", "W06": "W92000004", "N09": "N92000002"}
    if p in country:
        return country[p]
    if p == "E09":
        return _N["LON"]
    if p == "E06":
        return next((_N[k] for k, v in _E06.items() if n in v), None)
    table = _E07 if p == "E07" else _E08 if p == "E08" else {}
    return next(
        (_N[k] for k, v in table.items() if any(a <= n <= b for a, b in v)), None
    )


# ------------------------------ loading --------------------------------------
def _load_keyed(src: Path, sheet: str) -> tuple[pd.DataFrame, dict[str, str]]:
    raw = pd.read_excel(src, sheet_name=sheet, header=None)
    headers = raw.index[raw[0].astype(str).str.strip() == "Area code"]
    if headers.empty:
        raise ValueError(f"Workbook sheet {sheet} is missing its Area code header.")
    h = headers[0]
    df = raw.iloc[h + 1 :].copy()
    df.columns = raw.iloc[h].tolist()
    df = df[df["Area code"].astype(str).str.match(r"^[A-Z]\d{8}$")]
    if "Measure" in df.columns:
        df = df[df["Measure"] == "Observation value"]
    names = dict(zip(df["Area code"], df["Area name"]))
    df = df.set_index("Area code").drop(
        columns=[c for c in ["Area name", "Measure"] if c in df.columns]
    )
    df.columns = [int(str(c)[:4]) for c in df.columns]
    return df.apply(pd.to_numeric, errors="coerce"), names


def _clean(a: np.ndarray, nd: int) -> list:
    """numpy -> JSON-safe nested list (NaN -> None)."""
    return np.where(np.isfinite(a), np.round(a, nd), None).tolist()


def validate_inputs(shocks=None, rate_bias=0.0, area_shocks=None):
    """One boundary for HTTP, CLI and chat scenario inputs; never accept NaN."""

    def number(value, limit):
        if isinstance(value, bool):
            raise ValueError("Scenario values must be finite numbers.")  # noqa: TRY004 - one public validation error
        try:
            value = float(value)
        except (ValueError, TypeError):
            raise ValueError("Scenario values must be finite numbers.") from None
        if not math.isfinite(value) or abs(value) > limit:
            raise ValueError(
                f"Scenario value must be between {-limit:g} and {limit:g}."
            )
        return value

    def edits(values):
        if not isinstance(values, dict) or any(v not in VARS for v in values):
            raise ValueError("Unknown simulation variable.")
        cleaned = {v: number(x, 3) for v, x in values.items()}
        return {v: x for v, x in cleaned.items() if x != 0}

    if area_shocks is None:
        area_shocks = {}
    if not isinstance(area_shocks, dict) or len(area_shocks) > MAX_EDITED_AREAS:
        raise ValueError(f"Edit at most {MAX_EDITED_AREAS} areas per scenario.")
    local = {}
    for code, values in area_shocks.items():
        if not isinstance(code, str) or lad_to_region(code) is None:
            raise ValueError("Unknown UK authority code in scenario.")
        if clean := edits(values):
            local[code] = clean
    return edits({} if shocks is None else shocks), number(rate_bias, 1), local


class ForecastService:
    def __init__(self, xlsx_path: Path) -> None:
        self.src = Path(xlsx_path)
        self._lock = threading.Lock()
        self._s: dict | None = None
        self._cache: dict[str, tuple[bytes, bytes, str]] = {}
        self._cache_lock = threading.Lock()

    # ------------------------------------------------------------------ fit
    def prepare(self) -> None:
        with self._lock:
            if self._s is not None:
                return
            raw, names = {}, {}
            with pd.ExcelFile(self.src) as workbook:
                for sheet, v in SHEETS.items():
                    raw[v], nm = _load_keyed(workbook, sheet)
                    names.update(nm)
                # Northern Ireland's employment observations are a separate table.
                if "12" in workbook.sheet_names:
                    ni, nm = _load_keyed(workbook, "12")
                    raw["employment"] = raw["employment"].combine_first(ni)
                    names.update(nm)
            display = {v: d.copy() for v, d in raw.items()}  # full history for the map
            raw["deaths"] = raw["deaths"].loc[
                :, [c for c in raw["deaths"].columns if c >= POST_COVID_FROM]
            ]

            lads = sorted(
                {
                    c
                    for v, d in raw.items()
                    if v != "fdi"
                    for c in d.index
                    if c[:3] in ("E06", "E07", "E08", "E09", "S12", "W06", "N09")
                }
            )
            region_of = pd.Series({c: lad_to_region(c) for c in lads})
            for store in (raw, display):
                f = store["fdi"].reindex(
                    region_of.values
                )  # regional value copied onto each LAD
                f.index = region_of.index
                store["fdi_lad"] = f
            fdi_region_hist = display["fdi"]  # untouched regional rows

            levels, observed, growth, valid = {}, {}, {}, {}
            for v in VARS:
                d = (raw["fdi_lad"] if v == "fdi" else raw[v]).reindex(
                    index=lads, columns=GRID_YEARS
                )
                observed[v], levels[v] = d.notna(), d.fillna(0.0)
            for v in VARS:
                L, ok = levels[v], observed[v]
                both = ok & ok.shift(1, axis=1, fill_value=False)
                prev = L.shift(1, axis=1)
                g = ((L - prev) / prev.replace(0, np.nan)).where(both)
                valid[v], growth[v] = g.notna(), g.fillna(0.0)

            long = pd.concat(
                {v: growth[v].where(valid[v]).stack() for v in VARS}, axis=1
            )
            long = long.clip(long.quantile(0.01), long.quantile(0.99), axis=1)
            R = np.nan_to_num(
                long.corr(method="pearson")
                .reindex(index=VARS, columns=VARS)
                .to_numpy(copy=True)
            )
            np.fill_diagonal(R, 0.0)
            n = np.array(
                [
                    [(long[a].notna() & long[b].notna()).sum() for b in VARS]
                    for a in VARS
                ],
                float,
            )
            R = R * n / (n + K_SHRINK) if K_SHRINK else R
            radius = float(max(abs(np.linalg.eigvals(R))))
            alpha = min(1.0, TARGET_RADIUS / radius) if radius > 0 else 0.0
            mu, sigma = long.mean().fillna(0), long.std().fillna(0)
            for v in FLAT_DRIFT:
                mu[v] = 0.0

            def last_real(tbl, mask):
                pos = mask.values[:, ::-1].argmax(axis=1)
                vals = tbl.values[np.arange(len(tbl)), len(GRID_YEARS) - 1 - pos]
                return pd.Series(
                    np.where(mask.values.any(axis=1), vals, np.nan), index=tbl.index
                )

            L0 = pd.DataFrame({v: last_real(levels[v], observed[v]) for v in VARS})
            G0 = pd.DataFrame({v: last_real(growth[v], valid[v]) for v in VARS})
            # A single missing auxiliary series must not blank an area's observed
            # income/density. Missing growth starts at the model mean (zero z).
            # Missing levels are internal regional-median assumptions, never
            # published as that authority's observed or projected measurement.
            keep = L0[["income", "density"]].notna().all(axis=1) & region_of.notna()
            L0, G0 = L0[keep], G0[keep]
            available = L0.notna()
            estimated_inputs = {
                c: [v for v in VARS if pd.isna(L0.at[c, v]) or pd.isna(G0.at[c, v])]
                for c in L0.index
            }
            local_regions = region_of.reindex(L0.index)
            L0 = (
                L0.fillna(L0.groupby(local_regions).transform("median"))
                .fillna(L0.median())
                .fillna(0)
            )
            Z0 = ((G0 - mu) / sigma.replace(0, 1)).fillna(0).clip(-3, 3)
            if L0.empty:
                raise ValueError(
                    "The workbook has no authorities with sufficient simulation data."
                )

            hist_years = list(range(FIRST_YEAR, LAST_REAL_YEAR + 1))
            hist = {}
            for v in VARS:
                src_tbl = display["fdi_lad"] if v == "fdi" else display[v]
                h = src_tbl.reindex(index=L0.index, columns=hist_years).astype(float)
                hist[v] = h.to_numpy()  # missing observations remain missing

            region_hist = fdi_region_hist.reindex(
                index=list(REGIONS), columns=hist_years
            ).astype(float)
            self._s = {
                "codes": list(L0.index),
                "names": [names.get(c, c) for c in L0.index],
                "regions": [region_of[c] for c in L0.index],
                "R": R,
                "alpha": alpha,
                "mu": mu[VARS].to_numpy(),
                "sigma": sigma[VARS].to_numpy(),
                "L0": L0[VARS].to_numpy(),
                "Z0": Z0[VARS].to_numpy(),
                "hist": hist,
                "hist_years": hist_years,
                "region_hist": region_hist.to_numpy(),
                "rate_pairs": n.astype(int).tolist(),
                "available": available[VARS].to_numpy(),
                "estimated_inputs": estimated_inputs,
                "source_years": {
                    v: [
                        int(levels[v].columns[observed[v].loc[c].to_numpy()].max())
                        if observed[v].loc[c].any()
                        else None
                        for c in L0.index
                    ]
                    for v in VARS
                },
            }

    # ------------------------------------------------------------------ run
    def run(
        self,
        shocks: dict[str, float] | None = None,
        rate_bias: float = 0.0,
        area_shocks=None,
    ) -> dict:
        shocks, rate_bias, area_shocks = validate_inputs(shocks, rate_bias, area_shocks)
        self.prepare()
        s = self._s
        sens = np.array([RATE_SENS[v] for v in VARS])
        iw, ie, idt = (
            VARS.index("weeklypay"),
            VARS.index("employment"),
            VARS.index("deaths"),
        )
        Z, L = s["Z0"].copy(), s["L0"].copy()
        push = np.zeros_like(Z)
        for v, z in shocks.items():
            push[:, VARS.index(v)] += z
        positions = {c: i for i, c in enumerate(s["codes"])}
        fdi_edits = {}
        for code, edits in area_shocks.items():
            if code not in positions:
                raise ValueError(f"{code} has insufficient data for simulation.")
            for variable, value in edits.items():
                if variable == "fdi":
                    fdi_edits.setdefault(lad_to_region(code), []).append(value)
                else:
                    push[positions[code], VARS.index(variable)] += value
        for region, edits in fdi_edits.items():
            push[np.array(s["regions"]) == region, VARS.index("fdi")] += np.mean(edits)
        proj, rate = np.zeros((len(VARS), len(L), HORIZON)), []
        for t in range(HORIZON):
            Zn = s["alpha"] * Z @ s["R"].T
            sig = float(
                np.clip(
                    A_INFL * Z[:, iw].mean() + A_GAP * Z[:, ie].mean() + rate_bias,
                    *RATE_LIMITS,
                )
            )
            Z = Zn + sig * sens + push * SHOCK_DECAY**t
            rate.append(sig)
            L = L * np.maximum(1 + s["mu"] + s["sigma"] * Z, 0)
            L[:, idt] = L[:, idt].clip(0, 100)
            L[:, ie] = L[:, ie].clip(0, 100)
            proj[:, :, t] = L.T

        years = s["hist_years"] + list(
            range(LAST_REAL_YEAR + 1, LAST_REAL_YEAR + 1 + HORIZON)
        )
        values, national = {}, {}
        for j, v in enumerate(VARS):
            full = np.concatenate(
                [s["hist"][v], np.where(s["available"][:, j, None], proj[j], np.nan)],
                axis=1,
            )
            with warnings.catch_warnings():
                warnings.simplefilter(
                    "ignore", RuntimeWarning
                )  # early deaths years are all-empty
                national[v] = _clean(np.nanmean(full, axis=0), 3)
            if v != "fdi":  # fdi is sent per region below
                values[v] = _clean(full, 2)
        reg_codes = list(REGIONS)
        fdi_full = np.concatenate([s["hist"]["fdi"], proj[VARS.index("fdi")]], axis=1)
        reg_proj = []
        for code in reg_codes:
            rows = fdi_full[np.array(s["regions"]) == code, len(s["hist_years"]) :]
            reg_proj.append(
                rows.mean(axis=0) if len(rows) else np.full(HORIZON, np.nan)
            )
        reg_proj = np.array(reg_proj)
        fdi_regions = np.concatenate([s["region_hist"], reg_proj], axis=1)
        national["fdi"] = _clean(
            np.where(
                np.isfinite(fdi_regions).any(axis=0),
                np.nansum(fdi_regions, axis=0),
                np.nan,
            ),
            1,
        )

        # Fixed scales let a shock visibly change the map instead of rescaling it away.
        ranges = s.get("ranges")
        if ranges is None and (shocks or area_shocks or rate_bias):
            ranges = {
                v: definition["range"]
                for v, definition in self.run()["variables"].items()
            }
        if ranges is None:
            ranges = {}
            for j, v in enumerate(VARS):
                arr = (
                    fdi_regions
                    if v == "fdi"
                    else np.concatenate([s["hist"][v], proj[j]], axis=1)
                )
                lo, hi = np.nanpercentile(arr, [2, 98])
                ranges[v] = [float(lo), float(max(hi, lo + 1))]
            s["ranges"] = ranges
        return {
            "years": years,
            "projected_from": LAST_REAL_YEAR + 1,
            "variables": {
                v: {"label": LABELS[v][0], "unit": LABELS[v][1], "range": ranges[v]}
                for v in VARS
            },
            "areas": [
                {
                    "code": c,
                    "name": n,
                    "region": r,
                    "estimated_inputs": s["estimated_inputs"][c],
                }
                for c, n, r in zip(s["codes"], s["names"], s["regions"])
            ],
            "values": values,
            "regions": [
                {
                    "code": c,
                    "name": REGIONS[c][0],
                    "lat": REGIONS[c][1],
                    "lon": REGIONS[c][2],
                    "fdi": _clean(fdi_regions[i], 1),
                }
                for i, c in enumerate(reg_codes)
            ],
            "national": national,
            "rate": [None] * len(s["hist_years"]) + [round(x, 3) for x in rate],
            "rate_limits": list(RATE_LIMITS),
            "matrix": {
                "vars": VARS,
                "values": np.round(s["alpha"] * s["R"], 3).tolist(),
            },
            "inputs": {
                "shocks": shocks,
                "rate_bias": rate_bias,
                "area_shocks": area_shocks,
            },
            "source_years": s["source_years"],
            "coverage": f"{len(s['codes'])} UK local authorities with observed income and density inputs, including Scotland, Wales and Northern Ireland. Special planning authorities without source observations stay unavailable; FDI is regional or country-level.",
            "model_note": "Exploratory correlation model, not a validated economic prediction. Shocks are growth standard deviations, fading by 0.6 each year. Latest available observations seed 2026, with different source years. Where growth history is absent, the model starts at average growth (zero standardised growth); missing auxiliary levels use an internal regional median but that metric's output remains unavailable. Such inputs are listed per area. Recorded history is never filled. Means are unweighted authority averages; FDI is a regional/country total. Rate signal is dimensionless, not an actual interest rate.",
        }

    def context(self, facts, year, shocks=None, rate_bias=0.0, area_shocks=None):
        """Resolve displayed scenario facts on the server, not from claimed client values."""
        try:
            year = int(year)
        except (ValueError, TypeError):
            raise ValueError("Choose a simulation year from 2026 to 2035.") from None
        if not LAST_REAL_YEAR < year <= LAST_REAL_YEAR + HORIZON:
            raise ValueError("Choose a simulation year from 2026 to 2035.")
        data = json.loads(self.response(shocks, rate_bias, area_shocks)[0])
        yi = data["years"].index(year)
        result = {
            "source_year": year,
            "display": "simulation",
            "model_note": data["model_note"],
            "coverage": data["coverage"],
            "scenario": data["inputs"],
            "rate_signal": data["rate"][yi],
            "national_summary": {
                v: values[yi] for v, values in data["national"].items()
            },
            "summary_definition": "Unweighted modelled-authority means; FDI sums regional/country totals.",
            "growth_feedback_matrix": data["matrix"],
            "units": {
                v: definition["unit"] for v, definition in data["variables"].items()
            },
        }
        selected = facts.get("selected_authority")
        if selected:
            normalise = lambda name: (
                re.sub(r"[^a-z0-9]", "", name.lower())
                .replace("lpa", "")
                .replace("cityof", "")
            )
            index = next(
                (
                    i
                    for i, a in enumerate(data["areas"])
                    if normalise(a["name"]) == normalise(selected["authority_name"])
                ),
                None,
            )
            area = {k: selected[k] for k in ("authority_code", "authority_name")}
            for variable, field in {
                "income": "income_per_head",
                "density": "population_density",
                "employment": "employment_rate",
                "deaths": "business_death_rate_percent",
                "weeklypay": "weekly_pay",
            }.items():
                area[field] = (
                    data["values"][variable][index][yi] if index is not None else None
                )
            if index is not None:
                baseline = json.loads(self.response()[0])
                area["calculated_series"] = {
                    v: {
                        "years": data["years"],
                        "scenario": values[index],
                        "baseline": baseline["values"][v][index],
                    }
                    for v, values in data["values"].items()
                }
                area["scenario_effect"] = {}
                for variable, values in data["values"].items():
                    value, base = (
                        values[index][yi],
                        baseline["values"][variable][index][yi],
                    )
                    if value is not None and base is not None:
                        area["scenario_effect"][variable] = {
                            "difference": round(value - base, 3),
                            "percent": round((value / base - 1) * 100, 3)
                            if base
                            else None,
                        }
                region = next(
                    r
                    for r in data["regions"]
                    if r["code"] == data["areas"][index]["region"]
                )
                area["regional_fdi_gbp_million"] = region["fdi"][yi]
                area["input_source_years"] = {
                    v: years[index] for v, years in data["source_years"].items()
                }
                area["estimated_inputs"] = data["areas"][index]["estimated_inputs"]
            result["selected_authority"] = area
        return result

    def response(
        self, shocks=None, rate_bias=0.0, area_shocks=None
    ) -> tuple[bytes, bytes, str]:
        shocks, rate_bias, area_shocks = validate_inputs(shocks, rate_bias, area_shocks)
        key = json.dumps([shocks, rate_bias, area_shocks], sort_keys=True)
        with self._cache_lock:
            if key not in self._cache:
                body = json.dumps(
                    self.run(shocks, rate_bias, area_shocks),
                    separators=(",", ":"),
                    allow_nan=False,
                ).encode()
                etag = '"' + hashlib.sha256(body).hexdigest()[:16] + '"'
                if len(self._cache) >= 8:
                    self._cache.pop(next(iter(self._cache)))
                self._cache[key] = (body, gzip.compress(body), etag)
            return self._cache[key]
