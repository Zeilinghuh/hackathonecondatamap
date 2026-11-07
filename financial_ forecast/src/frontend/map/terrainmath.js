// One Mercator coordinate system for contours, navigation, picking and 3D.
export const mercator = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 180 / Math.PI;
export const latitudeAt = y => (2 * Math.atan(Math.exp(y * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
export const HEIGHT_SCALE = .009; // Display exaggeration; DEM values stay unchanged.

export function cameraBasis(yaw, tilt) {
  const s = Math.sin(yaw), c = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
  return { right: [c, 0, s], up: [-s * ct, st, c * ct], depth: [s * st, ct, -c * st] };
}

export function terrainMesh(dem) {
  const {width, height, values, bounds: [west, south, east, north]} = dem;
  if (width * height > 65536) throw new Error("The 3D grid exceeds the 16-bit mesh limit.");
  const top = mercator(north), bottom = mercator(south);
  const dx = (east - west) / (width - 1), dz = (top - bottom) / (height - 1);
  // Position, normal and UV: immutable GPU data shared by every frame.
  const vertices = new Float32Array(width * height * 8);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col, offset = i * 8;
    const x0 = Math.max(0, col - 1), x1 = Math.min(width - 1, col + 1);
    const z0 = Math.max(0, row - 1), z1 = Math.min(height - 1, row + 1);
    const gx = HEIGHT_SCALE * (values[row * width + x1] - values[row * width + x0]) / ((x1 - x0) * dx);
    const gz = HEIGHT_SCALE * (values[z0 * width + col] - values[z1 * width + col]) / ((z1 - z0) * dz);
    const length = Math.hypot(gx, 1, gz);
    vertices.set([west + col * dx, values[i] * HEIGHT_SCALE, top - row * dz,
      -gx / length, 1 / length, -gz / length, col / (width - 1), row / (height - 1)], offset);
  }
  const indices = new Uint16Array((width - 1) * (height - 1) * 6);
  let offset = 0;
  for (let row = 0; row < height - 1; row++) for (let col = 0; col < width - 1; col++) {
    const a = row * width + col, b = a + 1, c = a + width, d = c + 1;
    indices.set([a, c, b, b, c, d], offset); offset += 6;
  }
  return {vertices, indices};
}

// Picking intersects the same triangles as the GPU, including peaks that hide
// lower terrain. This runs only on a click, never during navigation.
export function pickTerrain(mesh, ray) {
  const {vertices, indices} = mesh;
  const {origin: o, direction: d} = ray;
  let nearest = Infinity, hit = null;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 8, b = indices[i + 1] * 8, c = indices[i + 2] * 8;
    const e1 = [vertices[b] - vertices[a], vertices[b+1] - vertices[a+1], vertices[b+2] - vertices[a+2]];
    const e2 = [vertices[c] - vertices[a], vertices[c+1] - vertices[a+1], vertices[c+2] - vertices[a+2]];
    const p = [d[1]*e2[2]-d[2]*e2[1], d[2]*e2[0]-d[0]*e2[2], d[0]*e2[1]-d[1]*e2[0]];
    const det = e1[0]*p[0] + e1[1]*p[1] + e1[2]*p[2];
    if (Math.abs(det) < 1e-9) continue;
    const t = [o[0]-vertices[a], o[1]-vertices[a+1], o[2]-vertices[a+2]];
    const u = (t[0]*p[0]+t[1]*p[1]+t[2]*p[2])/det;
    if (u < 0 || u > 1) continue;
    const q = [t[1]*e1[2]-t[2]*e1[1], t[2]*e1[0]-t[0]*e1[2], t[0]*e1[1]-t[1]*e1[0]];
    const v = (d[0]*q[0]+d[1]*q[1]+d[2]*q[2])/det;
    if (v < 0 || u+v > 1) continue;
    const distance = (e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])/det;
    if (distance < 0 || distance >= nearest) continue;
    const point = o.map((value, j) => value + distance*d[j]);
    if (ray.accept && !ray.accept(point)) continue;
    nearest = distance; hit = point;
  }
  return hit;
}
