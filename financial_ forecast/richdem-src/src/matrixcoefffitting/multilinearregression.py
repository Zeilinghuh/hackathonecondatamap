import numpy as np
import pandas as pd

FILE = "financial_ forecast/assets/data/all-datasets.xlsx"
SHEETS = {"16": "income_per_head", "17": "weekly_pay", "32": "business_deaths","26": "inward_fdi","3": "population density","13":"Modelled unemployment Rate"}   # sheet number -> short name
YEAR = "2022"   # use this year's column; if a sheet has none, use its latest column

xl = pd.ExcelFile(FILE)
data = {}

for sheet, name in SHEETS.items():
    raw = xl.parse(sheet, header=None)

    start = raw.index[raw[0] == "Area code"][0]          # the real table starts at "Area code"
    df = raw.iloc[start + 1:].copy()
    df.columns = raw.iloc[start].astype(str)

    if "Measure" in df.columns:                          # sheet 17: drop the confidence-interval rows
        df = df[df["Measure"] == "Observation value"]

    date_cols = [c for c in df.columns if c[:4].isdigit()]
    col = next((c for c in date_cols if c.startswith(YEAR)), date_cols[-1])

    values = pd.to_numeric(df[col], errors="coerce")     # [x], [c], [u] become NaN
    values.index = df["Area code"]
    data[name] = values[~values.index.duplicated()]

# keep only local authority districts (not counties, regions or countries, which overlap them)
d = pd.DataFrame(data)
d = d[d.index.str.startswith(("E06", "E07", "E08", "E09", "W06", "S12", "N09"))]
d = d.dropna()                                           # and only areas with a value for every indicator
print(f"{len(d)} areas with all of: {list(d.columns)}\n")

# regress each indicator on the others
for target in d.columns:
    predictors = [c for c in d.columns if c != target]
    y = d[target].values
    X = np.column_stack([np.ones(len(d)), d[predictors].values])
    coefs, *_ = np.linalg.lstsq(X, y, rcond=None)
    r2 = 1 - ((y - X @ coefs) ** 2).sum() / ((y - y.mean()) ** 2).sum()

    # same regression on standardised data, so coefficients are comparable across different units
    z = (d - d.mean()) / d.std()
    zc, *_ = np.linalg.lstsq(z[predictors].values, z[target].values, rcond=None)

    print(f"{target} = {coefs[0]:.4g}" + "".join(f" + {c:.4g} * {p}" for c, p in zip(coefs[1:], predictors)))
    print(f"   R² = {r2:.2f}   standardised: " + ", ".join(f"{p} {c:+.2f}" for p, c in zip(predictors, zc)) + "\n")