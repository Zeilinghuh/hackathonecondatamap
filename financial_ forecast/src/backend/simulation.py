"""Export the same simulation used by the app; no model fitting on import."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from forecast_service import VARS, ForecastService


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path, default=root / "assets/data/all-datasets.xlsx"
    )
    parser.add_argument("--output", type=Path, default=root / "build/simulation.xlsx")
    parser.add_argument(
        "--inputs", default="{}", help="JSON: shocks, area_shocks and rate_bias"
    )
    args = parser.parse_args()
    inputs = json.loads(args.inputs)
    data = ForecastService(args.source).run(**inputs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.suffix.lower() == ".json":
        args.output.write_text(json.dumps(data, allow_nan=False), encoding="utf-8")
    else:
        import pandas as pd

        codes = [a["code"] for a in data["areas"]]
        with pd.ExcelWriter(args.output) as writer:
            for variable in VARS:
                if variable in data["values"]:
                    pd.DataFrame(
                        data["values"][variable], index=codes, columns=data["years"]
                    ).to_excel(writer, sheet_name=variable)
            pd.DataFrame(
                {r["name"]: r["fdi"] for r in data["regions"]}, index=data["years"]
            ).to_excel(writer, sheet_name="regional_fdi")
            pd.DataFrame(data["matrix"]["values"], index=VARS, columns=VARS).to_excel(
                writer, sheet_name="growth_matrix"
            )
            pd.DataFrame({"year": data["years"], "rate_signal": data["rate"]}).to_excel(
                writer, sheet_name="rate_signal", index=False
            )
    print(f"Saved {len(data['areas'])} authorities to {args.output}")


if __name__ == "__main__":
    main()
