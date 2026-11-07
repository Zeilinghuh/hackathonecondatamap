
import re
from pathlib import Path
import geopandas as gpd
import pandas as pd
import matplotlib.pyplot as plt

def norm(s):
    s = str(s).lower().replace("&", "and")
    s = re.sub(r"\blpa\b", "", s) # "Darlington LPA" -> "darlington"
    s = re.sub(r",?\s(city|county) of\s$", "", s) # "Bristol, City of" -> "bristol"
    s = re.sub(r"[^a-z0-9 ]", "", s) # drop punctuation
    return re.sub(r"\s+", " ", s).strip()
gdf = gpd.read_file("financial_ forecast/assets/data/LPA_JAN_2026_UK_BFC_V2_3368052445060871350 (1) (1).geojson")
if gdf.crs is None:
    gdf = gdf.set_crs(epsg=4326)
    gdf = gdf.to_crs(epsg=27700)
    gdf["key"] = gdf["LPA26NM"].map(norm)

df = pd.read_excel("financial_ forecast/assets/data/all-datasets.xlsx", sheet_name="17", header=4)

df = df[df["Area code"].astype(str).str.match(r"^(?:E0[6-9]|N09|S12|W06)", na=False)].copy()
df["key"] = df["Area name"].map(norm)

year_cols = [c for c in df.columns if re.match(r"^\d{4}-", str(c))]
VALUE_COL = year_cols[-1] # <- or set e.g. "2022-01-01/P1Y (£)"
print("Plotting:", VALUE_COL)
df[VALUE_COL] = pd.to_numeric(df[VALUE_COL], errors="coerce")

merged = gdf.merge(df[["key", VALUE_COL]], on="key", how="left")
print("Map areas with no data:", merged.loc[merged[VALUE_COL].isna(), "LPA26NM"].tolist())
print("Data areas with no map:", sorted(set(df["key"]) - set(gdf["key"])))

fig, ax = plt.subplots(figsize=(8, 10))
merged.plot(
column=VALUE_COL,
cmap="viridis",
linewidth=0.2,
edgecolor="white",
legend=True,
legend_kwds={"label": "Gross disposable household income per head (£)", "shrink": 0.6},
missing_kwds={"color": "lightgrey", "label": "No data"},
ax=ax,
)
ax.set_title("Household Income per Head by Local Planning Authority", fontsize=14)
ax.set_axis_off()
plt.tight_layout()
plt.savefig("uk_household_income.png", dpi=300)
plt.show()