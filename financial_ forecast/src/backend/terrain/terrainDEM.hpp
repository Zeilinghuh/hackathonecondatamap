#pragma once
#include <array>
#include <iosfwd>
#include <optional>
#include <vector>

namespace terrain {
struct GridSpec {
    int width = 200;
    int height = 320;
    std::array<double, 4> bounds = {-8.75, 49.75, 1.95, 60.95};
    std::optional<std::array<double,2>> valueRange;
    bool valuesOnly = false;
};
using Sample = std::array<double, 3>; // longitude, latitude, non-negative value (income or log10 density)
void writeDEM(std::ostream& out, const GridSpec& spec, const std::vector<Sample>& samples,
              const char* heightSource = "Income-derived synthetic elevation");
void readDEM(std::istream& input, std::ostream& out);
}
