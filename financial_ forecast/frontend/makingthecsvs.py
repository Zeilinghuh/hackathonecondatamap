import pandas as pd
def make_csvs(n):
    query = pd.read_excel("financial_ forecast/assets/data/all-datasets.xlsx", sheet_name=n, header=6)
    query_csv = query[["Area code", "Area name", "2022-01-01/P1Y (£)"]]
    finalval=query_csv.to_csv("financial_ forecast/assets/data/household_wealth.csv", index=False)
    return finalval
finalval1=make_csvs(16)
print(finalval1["Area name"])