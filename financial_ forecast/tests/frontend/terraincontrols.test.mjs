import test from "node:test";
import assert from "node:assert/strict";
import { TerrainControls } from "../../src/frontend/GUI/terraincontrols.js";

test("cached map callers can update employment years without replacing key definitions", () => {
  const definition = "Darker = higher employment";
  const key = { dataset:{}, textContent:definition };
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector(selector) {
    assert.equal(selector, "#vegetation-key");
    return key;
  } };
  try {
    const controls = Object.create(TerrainControls.prototype);
    for (const year of [2023, 2022, 2023]) {
      controls.setEmploymentSource(year);
      assert.equal(key.dataset.sourceYear, String(year));
      assert.equal(key.textContent, definition);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
