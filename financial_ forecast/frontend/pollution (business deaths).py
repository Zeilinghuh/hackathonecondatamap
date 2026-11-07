import pandas as pd
import geopandas as gpd
import matplotlib.pyplot as plt
from pathlib import Path

SHEET = "32"        # which indicator to map
COLUMN = None       # None = most recent column, or paste an exact column name
FILTER = {"Measure": "Observation value"}   # one row per area (drops the confidence intervals)

root = Path(__file__).resolve().parents[3]
xlsx_path = next(p for p in root.rglob("all-datasets.xlsx") if not p.name.startswith("~$"))

# Prefer a Local Authority District boundary file (codes match the spreadsheet);
# fall back to the LPA file, joined by name.
shape_path = next(root.rglob("Local_Authority_Districts*"), None) or next(root.rglob("LPA_JAN_2026*"))
print("Shapes file:", shape_path.name)


def load_sheet(sheet):
    raw = pd.read_excel(xlsx_path, sheet_name=sheet, header=None)
    title = str(raw.iloc[0, 0])
    header_row = raw.index[(raw == "Area code").any(axis=1)][0]
    table = raw.iloc[header_row + 1:].copy()
    table.columns = raw.iloc[header_row]
    return title, table.reset_index(drop=True)


def norm(s):
    return s.astype(str).str.lower().str.replace(r"[^a-z0-9 ]", "", regex=True).str.strip()


title, table = load_sheet(SHEET)
if COLUMN is None:
    COLUMN = table.columns[-1]
print("Mapping:", title, "|", COLUMN)

for col, val in FILTER.items():
    if col in table.columns:
        table = table[table[col] == val]

table[COLUMN] = pd.to_numeric(table[COLUMN], errors="coerce")   # [x] etc. become blanks
table = table.drop_duplicates("Area code")

shapes = gpd.read_file(shape_path)

# Find a shapes column whose values match the sheet's area codes
codes = set(table["Area code"].dropna())
code_col = next((c for c in shapes.columns
                 if c != "geometry" and len(set(shapes[c].dropna().astype(str)) & codes) > 0), None)

if code_col:
    print("Joining on codes:", code_col)
    merged = shapes.merge(table[["Area code", COLUMN]], left_on=code_col, right_on="Area code", how="left")
else:
    print("No matching codes, joining on names instead")
    name_col = "LPA26NM" if "LPA26NM" in shapes.columns else next(c for c in shapes.columns if c.endswith("NM"))
    shapes["join_key"] = norm(shapes[name_col].str.replace(r"\s+LPA$", "", regex=True))
    table["join_key"] = norm(table["Area name"])
    merged = shapes.merge(table[["join_key", COLUMN]], on="join_key", how="left")

# Drop National Park / Development Corporation shapes (no spreadsheet rows, overlap districts)
name_col = "LPA26NM" if "LPA26NM" in merged.columns else None
if name_col:
    merged = merged[~merged[name_col].str.contains("National Park|Development Corporation|Broads Authority", regex=True)]

print(f"{merged[COLUMN].notna().sum()} of {len(merged)} areas have data")

ax = merged.plot(
    column=COLUMN,
    cmap="viridis",
    legend=True,
    edgecolor="white",
    linewidth=0.1,
    figsize=(8, 11),
    missing_kwds={"color": "lightgrey"},
)
ax.set_title(f"{title}\n{COLUMN}", fontsize=10)
ax.set_axis_off()
plt.tight_layout()
plt.savefig("map.png", dpi=200)
plt.show()