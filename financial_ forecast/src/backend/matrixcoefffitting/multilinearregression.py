"""Fit indicator regressions for offline exploration, not map predictions."""

from dataset import load_indicators


def main():
    import numpy as np

    data, _ = load_indicators()
    data = data[data.index.str.startswith(("E06", "E07", "E08", "E09", "W06", "S12", "N09"))].dropna()
    print(f"{len(data)} areas with all of: {list(data.columns)}\n")
    if len(data) <= len(data.columns) or (data.std() == 0).any():
        print("Not enough overlapping, varying observations to fit these indicators. No regression fitted; choose compatible indicators or a different year.")
        return
    standardized = (data - data.mean()) / data.std()
    for target in data.columns:
        predictors = [column for column in data.columns if column != target]
        y = data[target].values
        matrix = np.column_stack([np.ones(len(data)), data[predictors].values])
        coefficients, *_ = np.linalg.lstsq(matrix, y, rcond=None)
        r2 = 1 - ((y - matrix @ coefficients) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        standard, *_ = np.linalg.lstsq(standardized[predictors].values, standardized[target].values, rcond=None)
        print(f"{target} = {coefficients[0]:.4g}" + "".join(f" + {c:.4g} * {p}" for c, p in zip(coefficients[1:], predictors)))
        print(f"   R² = {r2:.2f}   standardised: " + ", ".join(f"{p} {c:+.2f}" for p, c in zip(predictors, standard)) + "\n")


if __name__ == "__main__":
    main()
