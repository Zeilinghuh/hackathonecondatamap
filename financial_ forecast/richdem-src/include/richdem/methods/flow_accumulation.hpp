#pragma once

#include <richdem/flowmet/Fairfield1991.hpp>
#include <richdem/flowmet/Freeman1991.hpp>
#include <richdem/flowmet/Holmgren1994.hpp>
#include <richdem/flowmet/OCallaghan1984.hpp>
#include <richdem/flowmet/Orlandini2003.hpp>
#include <richdem/flowmet/Quinn1991.hpp>
#include <richdem/flowmet/Seibert2007.hpp>
#include <richdem/flowmet/Tarboton1997.hpp>
#include <richdem/methods/flow_accumulation_generic.hpp>

namespace richdem {

// clang-format off
template<class elev_t, class accum_t> void FA_Tarboton           (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_Tarboton                       (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_Dinfinity          (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_Dinfinity                      (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_Holmgren           (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum, double xparam) { Array3D<float> props(elevations); FM_Holmgren                       (elevations, props, xparam );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_Quinn              (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_Quinn                          (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_Freeman            (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum, double xparam) { Array3D<float> props(elevations); FM_Freeman                        (elevations, props, xparam );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_FairfieldLeymarieD8(const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_FairfieldLeymarie<Topology::D8>(elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_FairfieldLeymarieD4(const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_FairfieldLeymarie<Topology::D4>(elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_Rho8               (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_Rho8                           (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_Rho4               (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_Rho4                           (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_OCallaghanD8       (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_OCallaghan<Topology::D8>       (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_OCallaghanD4       (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_OCallaghan<Topology::D4>       (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_D8                 (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_D8                             (elevations, props         );  FlowAccumulation(props, accum); }
template<class elev_t, class accum_t> void FA_D4                 (const Array2D<elev_t> &elevations, Array2D<accum_t> &accum)                { Array3D<float> props(elevations); FM_D4                             (elevations, props         );  FlowAccumulation(props, accum); }
// clang-format on

/**
  @brief  Calculate flow accumulation from a D8 raster
  @author Richard Barnes (rijard.barnes@gmail.com)

  @param[in]     &d8_in       D8 matrix - each cell has a weight of 1

  @return        A matrix of flow accumulation
*/
template <class T>
Array2D<uint32_t> flow_accumulation_from_d8(const Array2D<T>& d8_in) {
  Timer overall;
  overall.start();

  RDLOG_ALG_NAME << "D8 Raster -> Flow Accumulation";

  auto accum = Array2D<uint32_t>::make_from_template(d8_in, 0);
  accum.setNoData(ACCUM_NO_DATA);

  // Create dependencies array
  RDLOG_PROGRESS << "Creating dependencies array..." << std::endl;
  Array2D<int8_t> deps(d8_in, 0);
  for (int y = 1; y < d8_in.height()-1; y++) {
    for (int x = 1; x < d8_in.width()-1; x++) {
      if (d8_in.isNoData(x, y)) {
        continue;
      }
      const auto n = d8_in(x, y);
      if (n == NO_FLOW) {
        continue;
      }
      const auto nx = x + d8x[n];
      const auto ny = y + d8y[n];
      if (!d8_in.inGrid(nx, ny)) {
        continue;
      }
      const auto ni = d8_in.xyToI(x, y) + d8_in.nshift(n);
      deps(ni)++;
    }
  }

  // Find sources
  std::queue<int32_t> q;
  for (int y = 1; y < d8_in.height()-1; y++) {
    for (int x = 1; x < d8_in.width()-1; x++) {
      if (deps(x,y) == 0 && !d8_in.isNoData(x,y)) {
        q.emplace(d8_in.xyToI(x,y));
      }
    }
  }

  RDLOG_DEBUG << "Source cells found = " << q.size();  // TODO: Switch log target

  RDLOG_PROGRESS << "Calculating flow accumulation...";
  ProgressBar progress;
  progress.start(d8_in.size());
  while (!q.empty()) {
    ++progress;

    const auto ci = q.front();
    q.pop();

    const auto [cx, cy] = d8_in.iToxy(ci);

    assert(!d8_in.isNoData(ci));

    const auto c_accum = ++accum(ci);  // Add my own accumulation to myself
    const auto n       = d8_in(ci);    // Direction of my neighbor
    if (n == NO_FLOW) {
      continue;
    }

    const auto ni       = ci + d8_in.nshift(n);  // Index of my neighbor
    const auto [nx, ny] = d8_in.iToxy(ni);       // x,y of neighbor

    // Make sure my neighbor is in the grid and is not no data
    if (!d8_in.inGrid(nx, ny) || d8_in.isEdgeCell(nx,ny) || d8_in.isNoData(ni)) {
      continue;
    }

    accum(ni) += c_accum;
    if (--deps(ni) == 0) {
      q.emplace(ni);
    }
    assert(deps(ni) >= 0);
  }
  progress.stop();

  for (auto i = d8_in.i0(); i < d8_in.size(); i++) {
    if (d8_in.isNoData(i)) {
      accum(i) = d8_in.noData();
    }
  }

  RDLOG_TIME_USE << "Wall-time = " << overall.stop() << " s";

  return accum;
}

}  // namespace richdem
