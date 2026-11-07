import pandas as pd

def make_csvs(n):
    path = "financial_ forecast/assets/data/all-datasets.xlsx"
    query = pd.read_excel(path, sheet_name=n, header=6)
    query.columns = query.columns.astype(str).str.replace("\n", " ").str.strip()

    query = query[query["Measure"] == "Observation value"]
    out = query[["Area code", "Area name", "2025-04-30 (£)"]].copy()
    out.columns = ["code", "name", "value"]
    out["value"] = pd.to_numeric(out["value"], errors="coerce")

    out.to_csv("financial_ forecast/assets/data/household_wealth.csv", index=False)
    return out

df = make_csvs("17")
