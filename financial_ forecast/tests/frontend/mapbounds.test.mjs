import test from "node:test";
import assert from "node:assert/strict";
import { constrainView, constrain3DView } from "../../src/frontend/map/mapbounds.js";

const bounds = [0, 0, 10, 10];
const mercator = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;

test("fit view stays centred even after extreme pan requests", () => {
  const view = {width:800, height:600, scale:10, offsetX:1e12, offsetY:-1e12};
  constrainView(view, bounds);
  assert.equal(view.offsetX, 350);
  assert.ok(Math.abs(view.offsetY - (600 - mercator(10) * 10) / 2) < 1e-10);
});

test("zoomed view stops at every geographic edge", () => {
  const view = {width:800, height:600, scale:100, offsetX:1e12, offsetY:1e12};
  constrainView(view, bounds);
  assert.equal(view.offsetX, 28);
  assert.equal(view.offsetY, 28);
  view.offsetX = view.offsetY = -1e12;
  constrainView(view, bounds);
  assert.equal(view.offsetX + 1000, 772);
  assert.ok(Math.abs(view.offsetY + mercator(10) * 100 - 572) < 1e-10);
});

test("repeated input cannot accumulate overscroll beyond an edge", () => {
  const view = {width:800, height:600, scale:100, offsetX:28, offsetY:28};
  for (let n = 0; n < 1000; n++) {
    view.offsetX += 70;
    view.offsetY += 70;
    constrainView(view, bounds);
  }
  assert.equal(view.offsetX, 28);
  assert.equal(view.offsetY, 28);
  view.offsetX -= 10;
  constrainView(view, bounds);
  assert.equal(view.offsetX, 18);
});

test("resizing re-centres an axis that now fits on screen", () => {
  const view = {width:1400, height:1600, scale:100, offsetX:-500, offsetY:-500};
  constrainView(view, bounds);
  assert.equal(view.offsetX, 200);
  assert.ok(Math.abs(view.offsetY - (1600 - mercator(10) * 100) / 2) < 1e-10);
});

test("3D can pan at fit zoom while its target remains inside the UK bounds", () => {
  const view = {width:800,height:600,west:0,north:mercator(10),scale:10,offsetX:350,offsetY:(600-mercator(10)*10)/2};
  view.offsetX += 20;
  constrain3DView(view,bounds);
  assert.equal(view.offsetX,370);
  for (const offset of [-1e12,1e12]) {
    view.offsetX = view.offsetY = offset;
    constrain3DView(view,bounds);
    const lon = (view.width/2-view.offsetX)/view.scale+view.west;
    const lat = view.north-(view.height/2-view.offsetY)/view.scale;
    assert.ok(lon>=0 && lon<=10);
    assert.ok(lat>=-1e-10 && lat<=mercator(10)+1e-10);
  }
});
