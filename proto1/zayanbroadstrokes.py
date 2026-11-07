import geopandas as gpd
import pandas as pd
import csv
import matplotlib.pyplot as plt

# --- 1. Load boundaries ---
# ONS Open Geography Portal: "Local Authority Districts (December 2024) Boundaries UK BGC"
gdf = gpd.read_file("enggeojason.geojson")   # <- your boundary file
gdf = gdf.to_crs(epsg=27700)

GEO_KEY = "LAD24CD"        # <- code column in the boundary file (year suffix may differ)

# --- 2. Load wealth data and keep only local authority rows ---



wealth = pd.read_xlsx("household_wealth.xlsx", sheet_name="16")       # <- your file


CODE_COL = "Area code"     # <- the column holding E06000001, TLC31, etc.
VALUE_COL = "avg_wealth"   # <- column to plot

lad_pattern = r"^(?:E0[6-9]|N09|S12|W06)"
wealth = wealth[wealth[CODE_COL].str.match(lad_pattern, na=False)]

# Sanity check: each LAD should appear once
dupes = wealth[CODE_COL].duplicated().sum()
if dupes:
    print(f"Warning: {dupes} duplicate codes in wealth data")

# --- 3. Merge on code ---
merged = gdf.merge(wealth, left_on=GEO_KEY, right_on=CODE_COL, how="left")

unmatched = merged[merged[VALUE_COL].isna()][GEO_KEY].tolist()
if unmatched:
    print("No data for:", unmatched)

# --- 4. Plot ---
fig, ax = plt.subplots(figsize=(8, 10))

merged.plot(
    column=VALUE_COL,
    cmap="viridis",
    linewidth=0.2,
    edgecolor="white",
    legend=True,
    legend_kwds={"label": "Average household wealth (£)", "shrink": 0.6},
    missing_kwds={"color": "lightgrey", "label": "No data"},
    ax=ax,
)

ax.set_title("Average Household Wealth by Local Authority", fontsize=14)
ax.set_axis_off()
plt.tight_layout()
plt.savefig("uk_household_wealth.png", dpi=300)
plt.show()