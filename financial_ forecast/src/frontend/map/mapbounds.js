import { mercator } from "./terrainmath.js";

// Keep the map's projected geographic rectangle within the viewport. When an
// axis fits entirely on screen, centre and lock that axis. Otherwise pan only
// between its two edges, with a small fixed margin around the map.
export function constrainView(view, bounds, padding = 28) {
  const [west, south, east, north] = bounds;
  const extentWidth = (east - west) * view.scale;
  const extentHeight = (mercator(north) - mercator(south)) * view.scale;
  const clampAxis = (offset, extent, size) => extent <= size - padding * 2
    ? (size - extent) / 2
    : Math.max(size - padding - extent, Math.min(padding, offset));
  view.offsetX = clampAxis(view.offsetX, extentWidth, view.width);
  view.offsetY = clampAxis(view.offsetY, extentHeight, view.height);
}

// The orbit target can move inside the UK even when the full map fits. This
// permits real dragging in 3D without allowing an unbounded camera position.
export function constrain3DView(view, [west, south, east, north]) {
  const x = Math.max(west,Math.min(east,(view.width/2-view.offsetX)/view.scale+view.west));
  const y = Math.max(mercator(south),Math.min(mercator(north),view.north-(view.height/2-view.offsetY)/view.scale));
  view.offsetX = view.width/2-(x-view.west)*view.scale;
  view.offsetY = view.height/2-(view.north-y)*view.scale;
}
