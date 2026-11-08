"""Print correlations between source indicators; not part of the running app."""

from dataset import load_indicators


def main():
    table, columns = load_indicators()
    for sheet, column in columns.items():
        print(f"sheet {sheet}: using column '{column}'")
    print("\nPearson correlation:")
    print(table.corr(method="pearson", min_periods=5).round(2))


if __name__ == "__main__":
    main()
