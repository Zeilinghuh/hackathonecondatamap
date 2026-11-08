// Numerical terrain only; data ingestion and HTTP do not belong in this file.
#include "terrainDEM.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>
// RichDEM's terrain-attribute headers use this non-standard math constant.
// Supply it here for strict C++17 builds on Windows without changing the vendor.
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
#include <richdem/common/Array2D.hpp>
#include <richdem/methods/terrain_attributes.hpp>

namespace terrain {
constexpr double pi = 3.14159265358979323846;
constexpr double earthRadius = 6378137.0;
constexpr int contourInterval = 5;
double projectY(double lat) { return std::log(std::tan(pi / 4 + lat * pi / 360)); }
double latitude(double y) { return (2 * std::atan(std::exp(y)) - pi / 2) * 180 / pi; }
struct Point { double x, y, value; };

double interpolate(double x, double y, const std::vector<Point>& points) {
    double weighted = 0, weights = 0;
    constexpr double radius = 0.001; // Smoothing radius, ~6 km in Mercator units.
    for (const auto& p : points) {
        const double dx = x - p.x, dy = y - p.y;
        const double weight = 1 / (dx * dx + dy * dy + radius * radius);
        weighted += p.value * weight;
        weights += weight;
    }
    return weighted / weights;
}
void writeDEM(std::ostream& out, const GridSpec& spec, const std::vector<Sample>& samples, const char* heightSource) {
    const int width = spec.width, height = spec.height;
    const auto [west, south, east, north] = spec.bounds;
    const auto count = samples.size();
    if (width < 2 || height < 2 || width > 1024 || height > 1024 || count < 1 || count > 10000 ||
        !std::isfinite(west) || !std::isfinite(east) || !std::isfinite(south) || !std::isfinite(north) ||
        west >= east || south >= north || west < -180 || east > 180 || south <= -85 || north >= 85)
        throw std::runtime_error("Invalid grid size, bounds or sample count.");
    std::vector<Point> points;
    double minimum = std::numeric_limits<double>::infinity(), maximum = -minimum;
    points.reserve(count);
    for (const auto& sample : samples) {
        const auto [lon, lat, income] = sample;
        if (!std::isfinite(lon) || !std::isfinite(lat) ||
            !std::isfinite(income) || lon < west || lon > east || lat < south || lat > north || income < 0)
            throw std::runtime_error("Invalid terrain sample.");
        points.push_back({lon * pi / 180, projectY(lat), income});
        minimum = std::min(minimum, income);
        maximum = std::max(maximum, income);
    }
    for (auto& p : points) p.value = maximum > minimum ? 1000 * (p.value - minimum) / (maximum - minimum) : 500;
    const double left = west * pi / 180, right = east * pi / 180;
    const double top = projectY(north), bottom = projectY(south);
    const double dx = (right - left) / (width - 1), dy = (top - bottom) / (height - 1);
    // RichDEM owns the elevation raster and its spatial metadata. Input values
    // are synthetic economic/demographic heights, so analysis is not physical topography.
    richdem::Array2D<double> grid(width, height);
    grid.setNoData(-9999);
    grid.projection = "EPSG:3857";
    grid.geotransform = {earthRadius * (left - dx / 2), earthRadius * dx, 0,
                         earthRadius * (top + dy / 2), 0, -earthRadius * dy};
    grid.metadata["HEIGHT_SOURCE"] = heightSource;
    for (int row = 0; row < height; ++row)
        for (int col = 0; col < width; ++col)
            grid(col, row) = maximum == minimum ? 500 : interpolate(left + col * dx, top - row * dy, points);

    // Run actual RichDEM analysis on the same grid used for the contour map.
    // This layer can feed subsequent terrain/weather modules without altering
    // the income surface (depression filling would change those heights).
    richdem::Array2D<float> slopes;
    richdem::TA_slope_riserun(grid, slopes);

    out << std::setprecision(9) << "{\"width\":" << width << ",\"height\":" << height
              << ",\"backend\":\"RichDEM\",\"nodata\":" << grid.noData()
              << ",\"projection\":\"EPSG:3857\",\"contour_interval\":" << contourInterval << ",\"bounds\":[" << west << ',' << south << ',' << east << ',' << north
              << "],\"geotransform\":[";
    for (std::size_t i = 0; i < grid.geotransform.size(); ++i) { if (i) out << ','; out << grid.geotransform[i]; }
    out << "],\"values\":[";
    for (richdem::Array2D<double>::i_t i = 0; i < grid.size(); ++i) { if (i) out << ','; out << grid(i); }
    out << "],\"analysis\":{\"backend\":\"RichDEM\",\"slope_units\":\"synthetic height per Web Mercator metre\",\"slope_riserun\":[";
    for (richdem::Array2D<float>::i_t i = 0; i < slopes.size(); ++i) { if (i) out << ','; out << slopes(i); }
    out << "]}";
    out << ",\"contours\":[";
    bool first = true;
    // Marching squares, with the bilinear centre deciding ambiguous saddles.
    const auto range = std::minmax_element(grid.data(), grid.data() + grid.size());
    const int firstLevel = std::max(contourInterval, int(std::floor(*range.first / contourInterval) + 1) * contourInterval);
    for (int level = firstLevel; level <= *range.second && level < 1000; level += contourInterval) {
        for (int row = 0; row < height - 1; ++row) {
            for (int col = 0; col < width - 1; ++col) {
                const std::array<double, 4> v = {grid(col, row), grid(col + 1, row),
                    grid(col + 1, row + 1), grid(col, row + 1)};
                const std::array<std::array<double, 2>, 4> corners = {{{double(col), double(row)},
                    {double(col + 1), double(row)}, {double(col + 1), double(row + 1)}, {double(col), double(row + 1)}}};
                std::array<std::array<double, 2>, 4> crossings{};
                std::array<int, 4> edges{};
                int edgeCount = 0;
                for (int edge = 0; edge < 4; ++edge) {
                    const int next = (edge + 1) % 4;
                    if ((v[edge] >= level) == (v[next] >= level)) continue;
                    const double t = (level - v[edge]) / (v[next] - v[edge]);
                    const double x = corners[edge][0] + t * (corners[next][0] - corners[edge][0]);
                    const double y = corners[edge][1] + t * (corners[next][1] - corners[edge][1]);
                    crossings[edge] = {(left + x * dx) * 180 / pi, latitude(top - y * dy)};
                    edges[edgeCount++] = edge;
                }
                auto emit = [&](int a, int b) {
                    if (!first) out << ',';
                    first = false;
                    out << "{\"elevation_m\":" << level << ",\"coordinates\":[[" << crossings[a][0] << ','
                              << crossings[a][1] << "],[" << crossings[b][0] << ',' << crossings[b][1] << "]]}";
                };
                if (edgeCount == 2) emit(edges[0], edges[1]);
                if (edgeCount == 4) {
                    const bool centreHigh = (v[0] + v[1] + v[2] + v[3]) / 4 >= level;
                    if ((v[0] >= level) == centreHigh) { emit(0, 1); emit(2, 3); }
                    else { emit(0, 3); emit(1, 2); }
                }
            }
        }
    }
    out << "]}";
}

void readDEM(std::istream& input, std::ostream& out) {
    GridSpec spec;
    int count;
    if (!(input >> spec.width >> spec.height >> spec.bounds[0] >> spec.bounds[1]
                >> spec.bounds[2] >> spec.bounds[3] >> count) || count < 1 || count > 10000)
        throw std::runtime_error("Expected grid dimensions, bounds and sample count.");
    std::vector<Sample> samples(count);
    for (auto& sample : samples)
        if (!(input >> sample[0] >> sample[1] >> sample[2]))
            throw std::runtime_error("Invalid terrain sample.");
    writeDEM(out, spec, samples);
}
} // namespace terrain
