import test from "node:test";
import assert from "node:assert/strict";
import { AreaIndex } from "../../src/frontend/map/areas.js";
import { vegetationState, vegetationSites, projectVegetation, vegetationBand,
  vegetationColourTable, highVegetationSites, MAX_VEGETATION_TREES } from "../../src/frontend/map/vegetation.js";
import { TerrainRenderer } from "../../src/frontend/map/render/terrainrenderer.js";
import { mercator } from "../../src/frontend/map/terrainmath.js";

test("higher employment consistently grows fuller vegetation on a fixed scale", () => {
  const states = [0, 50, 60, 70, 80, 90, 100].map(rate => vegetationState(rate, rate));
  for (let i = 1; i < states.length; i++) {
    assert.ok(states[i].coverage >= states[i - 1].coverage);
    assert.ok(states[i].growth >= states[i - 1].growth);
  }
  assert.equal(states[0].coverage, 0);
  assert.equal(states.at(-1).coverage, 1);
  assert.equal(vegetationState(70, 70).band, "meadow");
  assert.equal(vegetationState(88, 88).band, "forest");
});

test("changes are percentage points and unavailable observations stay missing", () => {
  const falling = vegetationState(67.9, 68.2);
  assert.equal(falling.change, -.3);
  assert.equal(falling.trend, "declining");
  assert.equal(vegetationState(75, 72).trend, "growing");
  assert.equal(vegetationState(75, 75).trend, "stable");
  assert.equal(vegetationState(78.5, undefined).change, null);
  assert.equal(vegetationState(0, 1).available, true);
  for (const value of [null, undefined, NaN, Infinity, -1, 101, "75"]) {
    assert.equal(vegetationState(value, 75).available, false);
    assert.equal(vegetationState(75, value).change, null);
  }
});

const ring = points => new Float64Array(points.flat());
test("CSS plant anchors are deterministic, bounded and respect holes and islands", () => {
  const index = Object.create(AreaIndex.prototype);
  index.areas = [{
    feature: { properties: { authority_code: "test-area" } },
    polygons: [
      [ring([[0,0],[4,0],[4,4],[0,4],[0,0]]), ring([[1,1],[1,3],[3,3],[3,1],[1,1]])],
      [ring([[10,0],[11,0],[11,1],[10,1],[10,0]])],
    ],
  }];
  const sites = vegetationSites(index);
  assert.deepEqual(vegetationSites(index), sites);
  assert.equal(sites.length, 2);
  for (const { x, z } of sites) {
    const outer = x >= 0 && x <= 4 && z >= 0 && z <= 4;
    const island = x >= 10 && x <= 11 && z >= 0 && z <= 1;
    assert.ok(outer || island);
    assert.equal(x > 1 && x < 3 && z > 1 && z < 3, false);
  }
});

test("CSS anchors project onto the exact GPU sea plane in both views and after camera moves", () => {
  const renderer = Object.create(TerrainRenderer.prototype);
  renderer.yaw = -.16; renderer.tilt = .85;
  const view = { width:1200, height:800, scale:35, offsetX:300, offsetY:20, west:-8.75, north:mercator(60.95) };
  for (const mode of ["2d", "3d"]) for (const offsetX of [300, -200]) {
    const moved = { ...view, offsetX }, lon = -1.2, lat = 53.5;
    const { matrix } = renderer.camera(moved, mode);
    const point = projectVegetation(lon, mercator(lat), matrix, moved.width, moved.height);
    const picked = renderer.pick(point, moved, null, () => true, mode);
    assert.ok(Math.abs(picked[0] - lon) < .00001);
    assert.ok(Math.abs(picked[1] - lat) < .00001);
  }
});

test("trees appear only at 85% or higher, disappear for missing years and have a hard cap", () => {
  const sites = Array.from({ length:100 }, (_,i) => ({ code:"area-" + i, order:0 }));
  const observations = Object.fromEntries(sites.map((site,i) => [site.code, 84 + i / 10]));
  const selected = highVegetationSites(sites, observations);
  assert.equal(selected.length, MAX_VEGETATION_TREES);
  assert.ok(selected.every(site => observations[site.code] >= 85));
  assert.equal(observations[selected[0].code], Math.max(...Object.values(observations)));
  assert.deepEqual(highVegetationSites(sites, {}), []);
  assert.deepEqual(highVegetationSites(sites, { "area-0":84.9, "area-1":null }), []);
  assert.equal(highVegetationSites(sites, { "area-0":85 }).length, 1);
});

test("green area colours keep a fixed scale, distinguish missing data and update independently", () => {
  const index = { areas:["a","b","c","d","e","missing","zero"].map(code => ({ feature:{ properties:{ authority_code:code } } })) };
  const palette = [[237,246,221,255],[198,228,171,255],[145,202,128,255],[83,166,97,255],[36,115,73,255]];
  const missing = [220,228,232,255];
  const data = { a:64, b:65, c:75, d:80, e:85, missing:null, zero:0 };
  const table = vegetationColourTable(index,data,palette,missing);
  assert.equal(table.width,8);
  for(let i=0;i<5;i++)assert.deepEqual([...table.colours.slice(i*4,i*4+4)],palette[i]);
  assert.deepEqual([...table.colours.slice(20,24)],missing);
  assert.deepEqual([...table.colours.slice(24,28)],palette[0]);
  const next = vegetationColourTable(index,{...data,a:90},palette,missing);
  assert.deepEqual([...next.colours.slice(0,4)],palette[4]);
  assert.deepEqual(next.colours.slice(4),table.colours.slice(4));
  for(const value of [undefined,null,NaN,Infinity,-1,101])assert.equal(vegetationBand(value),-1);
});
