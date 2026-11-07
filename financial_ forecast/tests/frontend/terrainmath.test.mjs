import test from "node:test";
import assert from "node:assert/strict";
import {mercator, latitudeAt, cameraBasis, terrainMesh, pickTerrain, HEIGHT_SCALE} from "../../src/frontend/map/terrainmath.js";

test("projection round-trips UK latitudes", () => {
  for (const lat of [49.75, 51.5074, 55, 60.95]) assert.ok(Math.abs(latitudeAt(mercator(lat)) - lat) < 1e-10);
});

test("orbit camera remains orthonormal at its rotation limits", () => {
  for (const yaw of [-12, 0, .7, 20]) for (const tilt of [.18, .85, 1.2]) {
    const {right, up, depth} = cameraBasis(yaw, tilt);
    for (const axis of [right, up, depth]) assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-12);
    for (const [a,b] of [[right,up],[right,depth],[up,depth]]) assert.ok(Math.abs(a.reduce((n,v,i) => n+v*b[i],0)) < 1e-12);
  }
});

const dem = {width:3, height:3, bounds:[-2,50,2,55], values:[10,20,30,40,300,60,70,80,90]};
test("3D vertices retain every native height and geographic grid node", () => {
  const {vertices, indices} = terrainMesh(dem);
  dem.values.forEach((value,i) => assert.ok(Math.abs(vertices[i*8+1]/HEIGHT_SCALE - value) < .0001));
  assert.equal(vertices[0], -2);
  assert.equal(vertices[16], 2);
  assert.ok(Math.abs(vertices[2] - mercator(55)) < .00001);
  assert.ok(Math.abs(vertices[8*6+2] - mercator(50)) < .00001);
  assert.equal(indices.length, 24);
  assert.ok([...indices].every(i => i < 9));
});

test("3D picking finds visible peaks and ignores masked sea triangles", () => {
  const mesh = terrainMesh(dem), z = mesh.vertices[4*8+2];
  const ray = {origin:[0,20,z], direction:[0,-1,0]};
  const hit = pickTerrain(mesh, ray);
  assert.ok(Math.abs(hit[1]/HEIGHT_SCALE - 300) < .0001);
  assert.equal(pickTerrain(mesh, {...ray, accept:() => false}), null);
  assert.equal(pickTerrain(mesh, {origin:[20,20,z], direction:[0,-1,0]}), null);
});
