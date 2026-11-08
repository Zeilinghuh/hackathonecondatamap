incomeperheadcoefficients={"weeklypay":0.68, "inwardfdi":0.29, "BusinessDeaths":-0.16,"population density":0.34,"Employment Rate":0.18}
populationdensitycoefficients={"incomeperhead":0.34,"weeklypay":0.41,"inwardfdi":0.13,"BusinessDeaths":0.38,"employmentrate":-0.12}
weeklypaycoefficients={"incomeperhead":0.68,"inwardfdi":0.39,"BusinessDeaths":0.1,"population density":0.41,"employmentrate":0.33}
inwardfdicoefficients={"incomeperhead":0.29,"weeklypay":0.39,"BusinessDeaths":0.18,"population density":0.13,"employmentrate":0.16}
Businessdeathcoeffs={"incomeperhead":-0.16,"weeklypay":0.1,"inwardfdi":0.18,"population density":0.38,"employmentrate":-0.21}
Employmentratecoeffs={"incomeperhead":0.18,"weeklypay":0.33,"inwardfdi":0.16,"population density":-0.12,"BusinessDeaths":-0.21}

import re
import pandas as pd

SRC = "financial_ forecast/assets/data/all-datasets.xlsx"
SHEETS = ["16", "17", "26", "32", "3", "11"]
print(pd.ExcelFile(SRC).sheet_names)

def load_sheet(name):
    raw = pd.read_excel(SRC, sheet_name=name, header=None)  # skip the first 7 rows of metadata
    # header row = the row whose first cell is "Area code"
    h = raw.index[raw[0].astype(str).str.strip() == "Area code"][0]
    df = raw.iloc[h + 1:].copy()
    df.columns = raw.iloc[h].tolist()
    df = df.dropna(subset=["Area code"])
    # footnotes / blank rows below the table: keep only real area codes
    df = df[df["Area code"].astype(str).str.match(r"^[A-Z]\d{8}$")]
    # sheets 17 and 11 hold 3 rows per area; keep only the observation value
    if "Measure" in df.columns:
        df = df[df["Measure"] == "Observation value"]
    df = df.drop(columns=[c for c in ["Area code", "Area name", "Measure"] if c in df.columns])
    # header -> month (YYYY-MM)
    df.columns = [re.match(r"(\d{4}-\d{2})", str(c)).group(1) for c in df.columns]
    return df.apply(pd.to_numeric, errors="coerce").reset_index(drop=True)


def as_vector(col):
    return "[" + ";".join("" if pd.isna(v) else f"{v:g}" for v in col) + "]"


tables = {s: load_sheet(s) for s in SHEETS}

with pd.ExcelWriter("financial_ forecast/src/backend/matrixcoefffitting/minimatrices/sheetsvertical.xlsx") as xw:
    # one sheet per source sheet: month header, values running down each column
    for s, df in tables.items():
        df.to_excel(xw, sheet_name=f"sheet_{s}", index=False)
    # one sheet per source sheet, each column collapsed to a [a;b;c;...] string
    rows = {s: {m: as_vector(df[m]) for m in df.columns} for s, df in tables.items()}
    for s, r in rows.items():
        pd.DataFrame([r]).to_excel(xw, sheet_name=f"vec_{s}", index=False)

if __name__ == "__main__":
    for s, df in tables.items():
        print(f"sheet {s}: {df.shape[0]} areas x {df.shape[1]} months  ({df.columns[0]} .. {df.columns[-1]})")
        m = df.columns[0]
        print("  ", m, as_vector(df[m].head(4))[:-1] + ";...]")