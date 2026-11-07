import os
os.environ["OGR_GEOJSON_MAX_OBJ_SIZE"] = "0"   # allow very large GeoJSON features

import pandas as pd
import geopandas as gpd
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
from pathlib import Path

SHEET = "26"
COLUMN = None          # None = most recent column, or an exact column name
FILTER = {"Measure": "Observation value"}   # only applied if the sheet has a "Measure" column

root = Path(__file__).resolve().parents[3]
xlsx_path = next(p for p in root.rglob("all-datasets.xlsx") if not p.name.startswith("~$"))

# England's 9 regions + Wales, Scotland, Northern Ireland as whole countries
ROW_CODES = r"^(E12|W92|S92|N92)"
BOUNDARY_PATTERNS = [["*Regions*", "*RGN*"], ["*Countries*", "*CTRY*"]]


def load_sheet(sheet):
    raw = pd.read_excel(xlsx_path, sheet_name=sheet, header=None)
    title = str(raw.iloc[0, 0])
    header_row = raw.index[(raw == "Area code").any(axis=1)][0]
    table = raw.iloc[header_row + 1:].copy()
    table.columns = raw.iloc[header_row]
    return title, table.reset_index(drop=True)


title, table = load_sheet(SHEET)
if COLUMN is None:
    COLUMN = table.columns[-1]
print("Mapping:", title, "|", COLUMN)

for col, val in FILTER.items():
    if col in table.columns:
        table = table[table[col] == val]

table = table.dropna(subset=["Area code"])
table["Area code"] = table["Area code"].astype(str).str.strip()
table[COLUMN] = pd.to_numeric(table[COLUMN], errors="coerce")
table = table[table["Area code"].str.match(ROW_CODES)].copy()
print(f"\n{len(table)} rows to map:")
print(table[["Area code", "Area name", COLUMN]].to_string(index=False))

# Load each boundary file and keep just (code, geometry)
codes = set(table["Area code"])
parts = []
for patterns in BOUNDARY_PATTERNS:
    path = next((p for pat in patterns for p in root.rglob(pat)
                 if p.suffix.lower() in (".geojson", ".json", ".shp", ".gpkg")), None)
    if path is None:
        raise SystemExit(f"Missing boundary file matching {patterns}. "
                         f"Download it and save it in assets/data.")
    g = gpd.read_file(path)
    code_col = next((c for c in g.columns
                     if c != "geometry" and len(set(g[c].dropna().astype(str)) & codes) > 0), None)
    if code_col is None:
        print(f"WARNING: no matching codes in {path.name}; columns: {g.columns.tolist()}")
        continue
    print(f"{path.name}: joining on {code_col}")
    g = g[[code_col, "geometry"]].rename(columns={code_col: "Area code"})
    g["Area code"] = g["Area code"].astype(str)
    parts.append(g)

if not parts:
    raise SystemExit("No boundary file matched the sheet's codes.")

crs = parts[0].crs
shapes = gpd.GeoDataFrame(pd.concat([p.to_crs(crs) for p in parts], ignore_index=True), crs=crs)
shapes = shapes[shapes["Area code"].isin(codes)]   # drops England-as-a-whole, which overlaps the regions

merged = shapes.merge(table[["Area code", COLUMN]], on="Area code", how="left")
print(f"{merged[COLUMN].notna().sum()} of {len(merged)} areas have data")

ax = merged.plot(
    column=COLUMN,
    cmap="viridis",
    norm=LogNorm(vmin=merged[COLUMN].min(), vmax=merged[COLUMN].max()),   # log scale so London doesn't wash out the rest
    legend=True,
    edgecolor="white",
    linewidth=0.3,
    figsize=(8, 11),
    missing_kwds={"color": "lightgrey"},
)
ax.set_title(f"{title}\n{COLUMN}", fontsize=10)
ax.set_axis_off()
plt.tight_layout()
plt.savefig("map.png", dpi=200)
plt.show()