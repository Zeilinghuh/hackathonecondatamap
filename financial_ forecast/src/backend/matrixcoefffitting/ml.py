import pandas as pd

FILE = "financial_ forecast/assets/data/all-datasets.xlsx"
SHEETS = {"16": "income_per_head", "17": "weekly_pay", "26": "inward_fdi", "32": "business_deaths","3": "population density","13":"Modelled unemployment Rate"}   # sheet number -> short name
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
    print(f"sheet {sheet}: using column '{col}'")

    values = pd.to_numeric(df[col], errors="coerce")     # [x], [c], [u] become NaN
    values.index = df["Area code"]
    data[name] = values[~values.index.duplicated()]

table = pd.DataFrame(data)                               # rows = areas, columns = the 4 indicators

#print("\nSpearman correlation:")
#print(table.corr(method="spearman", min_periods=5).round(2))
print("\nPearson correlation:")
print(table.corr(method="pearson", min_periods=5).round(2))
 
#print("\nAreas in common (n):")
#print((table.notna().astype(int).T @ table.notna().astype(int)))