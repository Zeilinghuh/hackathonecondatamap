"""LAD code -> English region code (E12...), built from LAD names/code ranges.
Validated against the E12 population totals in sheet 1 (see check_region_map())."""
import pandas as pd

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


def check_region_map(src, year=2024):
    """Sum LAD populations (sheet 1) per region and compare with the E12 totals in the same sheet."""
    raw = pd.read_excel(src, sheet_name="1", header=None)
    h = raw.index[raw[0].astype(str).str.strip() == "Area code"][0]
    df = raw.iloc[h + 1:].copy(); df.columns = raw.iloc[h].tolist()
    col = [c for c in df.columns if str(c).startswith(str(year))][0]
    df["pop"] = pd.to_numeric(df[col], errors="coerce")
    lad = df[df["Area code"].astype(str).str.match(r"^E0[6-9]\d{6}$")].copy()
    lad["region"] = lad["Area code"].map(lad_to_region)
    out = pd.DataFrame({"sum_of_LADs": lad.groupby("region")["pop"].sum()})
    out["reported_E12"] = df.set_index("Area code").loc[out.index, "pop"].astype(float)
    out["diff"] = out["sum_of_LADs"] - out["reported_E12"]
    return out, lad[lad["region"].isna()]
