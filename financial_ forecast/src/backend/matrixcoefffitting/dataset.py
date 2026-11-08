"""Shared workbook reader for the optional, offline analysis scripts."""

from pathlib import Path

WORKBOOK = Path(__file__).resolve().parents[3] / "assets" / "data" / "all-datasets.xlsx"
SHEETS = {
    "16": "income_per_head",
    "17": "weekly_pay",
    "26": "inward_fdi",
    "32": "business_deaths",
    "3": "population density",
    "13": "Modelled unemployment Rate",
}


def load_indicators(year="2022", workbook=WORKBOOK):
    import pandas as pd

    data, selected_columns = {}, {}
    with pd.ExcelFile(workbook) as source:
        for sheet, name in SHEETS.items():
            raw = source.parse(sheet, header=None)
            start = raw.index[raw[0] == "Area code"][0]
            frame = raw.iloc[start + 1 :].copy()
            frame.columns = raw.iloc[start].astype(str)
            if "Measure" in frame.columns:
                frame = frame[frame["Measure"] == "Observation value"]
            dates = [column for column in frame.columns if column[:4].isdigit()]
            column = next((column for column in dates if column.startswith(year)), dates[-1])
            selected_columns[sheet] = column
            values = pd.to_numeric(frame[column], errors="coerce")
            values.index = frame["Area code"]
            data[name] = values[~values.index.duplicated() & values.index.notna()]
    return pd.DataFrame(data), selected_columns
