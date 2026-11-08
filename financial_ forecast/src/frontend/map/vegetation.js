// CSS defines the green palette and small tree markers. The existing GPU area
// geometry draws the shading; only the highest employment band gets DOM trees.
export const TREE_EMPLOYMENT_THRESHOLD = 85;
export const MAX_VEGETATION_TREES = 48;
export const VEGETATION_BREAKS = [65, 75, 80, TREE_EMPLOYMENT_THRESHOLD];

export function vegetationBand(rate) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return -1;
  const band = VEGETATION_BREAKS.findIndex(limit => rate < limit);
  return band < 0 ? VEGETATION_BREAKS.length : band;
}

// One RGBA texel per authority, updated only when the data year changes.
export function vegetationColourTable(index, observations, palette, missing) {
  const width = 2 ** Math.ceil(Math.log2(Math.max(1, index.areas.length)));
  const colours = new Uint8Array(width * 4);
  index.areas.forEach((area, i) => {
    const band = vegetationBand(observations[area.feature.properties.authority_code]);
    colours.set(band < 0 ? missing : palette[band], i * 4);
  });
  return { width, colours };
}

export function vegetationState(rate, previous) {
  const valid = value => Number.isFinite(value) && value >= 0 && value <= 100;
  if (!valid(rate)) return { available: false, coverage: 0, change: null, trend: "unavailable" };
  const coverage = Math.max(0, Math.min(1, (rate - 50) / 40));
  const change = valid(previous) ? Math.round((rate - previous) * 1e6) / 1e6 : null;
  return {
    available: true, coverage, change, growth: .35 + coverage * .85,
    band: rate < 65 ? "sparse" : rate < 75 ? "meadow" : rate < 85 ? "woodland" : "forest",
    trend: change === null ? "unavailable" : change > .05 ? "growing" : change < -.05 ? "declining" : "stable",
  };
}

function randomFor(code) {
  let seed = 2166136261;
  for (const character of code) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

// Reuse the same triangulated polygons as selection. Sampling respects holes
// and islands, and fixed seeds keep plants in place when the data year changes.
export function vegetationSites(index) {
  const vertices = index.fills(), sites = [];
  for (const area of index.areas) {
    const code = area.feature.properties.authority_code;
    const triangles = [];
    let total = 0;
    const start = area.fillStart * 2, end = start + area.fillCount * 2;
    for (let i = start; i < end; i += 6) {
      const [ax, az, bx, bz, cx, cz] = vertices.subarray(i, i + 6);
      const weight = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
      if (weight > 0) { total += weight; triangles.push({ offset: i, cumulative: total }); }
    }
    if (!total) continue;
    const random = randomFor(code);
    for (let j = 0; j < 2; j++) {
      const needle = random() * total;
      let low = 0, high = triangles.length - 1;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (triangles[middle].cumulative < needle) low = middle + 1;
        else high = middle;
      }
      const i = triangles[low].offset, root = Math.sqrt(random()), split = random();
      const a = 1 - root, b = root * (1 - split), c = root * split;
      sites.push({
        code, order: j, x: a * vertices[i] + b * vertices[i + 2] + c * vertices[i + 4],
        z: a * vertices[i + 1] + b * vertices[i + 3] + c * vertices[i + 5],
        variant: j % 3, size: .85 + random() * .3,
      });
    }
  }
  return sites;
}

export function highVegetationSites(sites, observations) {
  return sites.filter(site => vegetationBand(observations[site.code]) === VEGETATION_BREAKS.length)
    .sort((a, b) => a.order - b.order || observations[b.code] - observations[a.code] || a.code.localeCompare(b.code))
    .slice(0, MAX_VEGETATION_TREES);
}

export function projectVegetation(x, z, matrix, width, height, elevation=0) {
  const clipX = matrix[0] * x + matrix[4]*elevation + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5]*elevation + matrix[9] * z + matrix[13];
  const w = matrix[3] * x + matrix[7]*elevation + matrix[11] * z + matrix[15];
  return { x: (clipX / w + 1) * width / 2, y: (1 - clipY / w) * height / 2 };
}

export class VegetationLayer {
  constructor(element, index) {
    this.element = element; this.sites = vegetationSites(index); this.states = new Map();
    this.nodes = []; this.activeSites = [];
    const css = getComputedStyle(element);
    const rgba = name => {
      const colour = css.getPropertyValue(name).trim();
      if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new Error("Invalid vegetation colour: " + name);
      return [...colour.slice(1).match(/../g).map(value => parseInt(value, 16)), 255];
    };
    this.palette = Array.from({ length:5 }, (_, i) => rgba("--vegetation-colour-" + i));
    this.missingColour = rgba("--vegetation-no-data");
    element.replaceChildren();
    element.dataset.plantSites = "0";
    element.dataset.treeThreshold = String(TREE_EMPLOYMENT_THRESHOLD);
  }

  setFrame(frame, previousFrame) {
    this.states.clear();
    const previous = previousFrame?.year === String(Number(frame.year) - 1) ? previousFrame.observations : {};
    let growing = 0, declining = 0;
    for (const [code, rate] of Object.entries(frame.observations)) {
      const state = vegetationState(rate, previous[code]);
      this.states.set(code, state);
      if (state.trend === "growing") growing++;
      if (state.trend === "declining") declining++;
    }
    this.activeSites = highVegetationSites(this.sites, frame.observations);
    while (this.nodes.length < this.activeSites.length) {
      const node = document.createElement("span"), crown = document.createElement("i");
      crown.className = "vegetation-crown"; node.append(crown);
      this.element.append(node); this.nodes.push(node);
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const site = this.activeSites[i], node = this.nodes[i];
      node.hidden = !site;
      if (!site) continue;
      const state = this.states.get(site.code);
      node.className = "vegetation-plant plant-variant-" + site.variant;
      node.dataset.authority = site.code; node.dataset.rate = frame.observations[site.code];
      node.dataset.band = "forest"; node.dataset.trend = state.trend;
      node.style.setProperty("--growth", ".9");
    }
    this.element.dataset.year = frame.year;
    this.element.dataset.plantSites = String(this.nodes.length);
    this.element.dataset.eligibleTrees = String(this.activeSites.length);
    document.querySelector("#vegetation-summary").textContent =
      Object.keys(frame.observations).length + " areas with data. " +
      (previousFrame ? growing + " rising / " + declining + " falling versus " + previousFrame.year + "." : "No previous-year comparison.");
    this.cameraKey = null;
  }

  draw(view, matrix, visible, heightAt=null,blend=1) {
    this.element.hidden = !visible;
    if (!visible) return;
    const key = [view.width, view.height, view.zoom, ...matrix, blend].join(",");
    if (key === this.cameraKey) return;
    this.cameraKey = key;
    this.element.style.opacity=String(.2+.8*blend);
    const size = Math.min(.85, .48 + Math.log2(Math.max(1, view.zoom)) * .08);
    const displayed = [], limit = view.width < 600 ? 16 : 28;
    for (let i = 0; i < this.activeSites.length; i++) {
      const site = this.activeSites[i], node = this.nodes[i];
      const point = projectVegetation(site.x, site.z, matrix, view.width, view.height,heightAt?.(site) ?? 0);
      const onScreen = point.x >= -24 && point.x <= view.width + 24 && point.y >= -8 && point.y <= view.height + 40;
      const clear = onScreen && displayed.length < limit &&
        displayed.every(other => Math.hypot(other.x - point.x, other.y - point.y) >= 28);
      node.style.visibility = clear ? "visible" : "hidden";
      if (!clear) continue;
      displayed.push(point);
      node.style.transform = "translate3d(" + (point.x - 12).toFixed(2) + "px," +
        (point.y - 32).toFixed(2) + "px,0) scale(" + (size * site.size).toFixed(3) + ")";
    }
    this.element.dataset.visiblePlants = String(displayed.length);
  }
}
