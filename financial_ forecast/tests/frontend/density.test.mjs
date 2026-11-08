import test from "node:test";
import assert from "node:assert/strict";
import {densityClass, densityFromHeight, DENSITY_BREAKS, DENSITY_COLOURS} from "../../src/frontend/map/render/terraintexture.js";

test("density classes cover every break with one colour per class", () => {
  assert.equal(DENSITY_COLOURS.length, DENSITY_BREAKS.length + 1);
  assert.deepEqual(DENSITY_BREAKS, [...DENSITY_BREAKS].sort((a, b) => a - b));
});

test("density values fall into half-open classes and missing data has none", () => {
  assert.equal(densityClass(8), 0);
  assert.equal(densityClass(49.9), 0);
  assert.equal(densityClass(50), 1);
  assert.equal(densityClass(1063), 5);
  assert.equal(densityClass(9999), 7);
  assert.equal(densityClass(16906), 8);
  for (const missing of [null, undefined, NaN]) assert.equal(densityClass(missing), -1);
});

test("log density heights map back to residents per km²", () => {
  const range = [Math.log10(8), Math.log10(16906)];
  assert.ok(Math.abs(densityFromHeight(0, range) - 8) < 1e-9);
  assert.ok(Math.abs(densityFromHeight(1000, range) - 16906) < 1e-6);
  const middle = densityFromHeight(500, range);
  assert.ok(Math.abs(middle - Math.sqrt(8 * 16906)) < 1e-6);
});
