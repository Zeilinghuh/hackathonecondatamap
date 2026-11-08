import { CONTOUR_COLOURS, PEAK_COLOURS, DENSITY_BREAKS, DENSITY_COLOURS, NO_DATA_COLOUR } from "../map/render/terraintexture.js";

const NOTES = {
  terrain: "Blue lows → cyan → green → yellow → red → dark crimson peaks.",
  density: "Population density terrain: height follows log₁₀ residents per km². Bright blue lows are sparse, black peaks are crowded; contours are white.",
  borders: "Authority borders only. Hover an area, then click to select it.",
};
export const formatDensity = value => Math.round(value).toLocaleString() + " / km²";

// DOM controls live in GUI; the map and terrain renderer remain reusable.
export class TerrainControls {
  constructor({ onChange, onZoom, onReset, onMode }) {
    this.layer = "terrain";
    this.layerButtons = [...document.querySelectorAll(".layer-switch button")];
    const colours = [...CONTOUR_COLOURS, ...PEAK_COLOURS];
    document.querySelector(".gradient").style.background = `linear-gradient(90deg, ${colours.map((colour, index) => `${colour} ${index / colours.length * 100}% ${(index + 1) / colours.length * 100}%`).join(", ")})`;
    this.buildDensityLegend();
    for (const button of this.layerButtons) button.addEventListener("click", () => {
      if (button.dataset.layer === this.layer) return;
      this.setLayer(button.dataset.layer);
      onChange();
    });
    document.querySelector("#zoom-in").addEventListener("click", () => onZoom(1.4));
    document.querySelector("#zoom-out").addEventListener("click", () => onZoom(1 / 1.4));
    document.querySelector("#reset-view").addEventListener("click", onReset);
    document.querySelector("#view-2d").addEventListener("click", () => onMode("2d"));
    document.querySelector("#view-3d").addEventListener("click", () => onMode("3d"));
    const sidebar = document.querySelector("#sidebar");
    const sidebarToggle = document.querySelector("#sidebar-toggle");
    const setSidebar = collapsed => {
      sidebar.hidden = collapsed;
      document.querySelector(".app-shell").classList.toggle("sidebar-collapsed", collapsed);
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      sidebarToggle.textContent = collapsed ? "◂ Show panel" : "Hide panel ▸";
      try { localStorage.setItem("terrain.sidebarCollapsed", String(collapsed)); } catch {}
    };
    sidebarToggle.addEventListener("click", () => setSidebar(!sidebar.hidden));
    try {
      const saved = localStorage.getItem("terrain.sidebarCollapsed");
      setSidebar(saved === null ? matchMedia("(max-width:760px)").matches : saved === "true");
    } catch {}
  }

  // Raised, contoured surface for the layer: "income", "density" or null (flat borders + hover).
  get surface() { return {terrain: "income", density: "density"}[this.layer] ?? null; }
  get visible() { return this.surface !== null; }
  get density() { return this.layer === "density"; }

  setLayer(layer) {
    this.layer = layer;
    for (const button of this.layerButtons) button.setAttribute("aria-pressed", String(button.dataset.layer === layer));
    document.querySelector("#control-note").textContent = NOTES[layer];
    document.querySelector("#terrain-key").hidden = layer !== "terrain";
    document.querySelector("#density-key").hidden = layer !== "density";
  }

  buildDensityLegend() {
    const labels = DENSITY_COLOURS.map((_, index) => {
      const low = DENSITY_BREAKS[index - 1], high = DENSITY_BREAKS[index];
      if (low === undefined) return `Under ${high.toLocaleString()}`;
      if (high === undefined) return `${low.toLocaleString()}+`;
      return `${low.toLocaleString()}–${high.toLocaleString()}`;
    });
    const rows = labels.map((label, index) => [DENSITY_COLOURS[index], label]).reverse();
    rows.push([NO_DATA_COLOUR, "No data"]);
    const list = document.querySelector("#density-classes");
    list.replaceChildren(...rows.map(([colour, label]) => {
      const item = document.createElement("li"), swatch = document.createElement("span");
      swatch.className = "swatch"; swatch.style.background = colour;
      item.append(swatch, label);
      return item;
    }));
  }

  // meta: metadata.population_density (source_year, log10_range).
  setDensitySource(meta) {
    if (!meta) return;
    document.querySelector("#density-title").textContent = `Residents per km² · mid-${meta.source_year}`;
    const [low, high] = meta.log10_range ?? [];
    if (Number.isFinite(low) && Number.isFinite(high)) {
      // Heights are 0–1000; major contours every 25 units multiply density by this factor.
      const factor = 10 ** ((high - low) * 25 / 1000);
      document.querySelector("#density-scale").textContent = `Log heights · each bold contour ≈ ×${factor.toFixed(2)}`;
      NOTES.density = `Population density terrain: height follows log₁₀ residents per km², so each bold contour ≈ ×${factor.toFixed(2)} people. Bright blue lows are sparse, black peaks are crowded; contours are white.`;
      if (this.layer === "density") document.querySelector("#control-note").textContent = NOTES.density;
    }
  }

  setReady() { document.querySelectorAll(".view-switch button").forEach(button => { button.disabled = false; }); }

  setMode(mode) {
    document.querySelector("#view-2d").setAttribute("aria-pressed", String(mode === "2d"));
    document.querySelector("#view-3d").setAttribute("aria-pressed", String(mode === "3d"));
    document.querySelector(".map-hint").textContent = mode === "3d"
      ? "Drag to move · Shift-drag to rotate · Scroll to zoom"
      : "Scroll to zoom · Drag to explore";
    document.querySelector("#map").setAttribute("aria-label",mode === "3d"
      ? "3D income terrain. Drag or use arrow keys to pan. Shift-drag or Shift-arrow rotates. Scroll or press plus and minus to zoom. Zero resets the UK view."
      : "UK income and population density map. Drag or use arrow keys to pan, plus and minus to zoom, and zero to reset.");
  }

  set3DAvailable(available, message = "") {
    document.querySelector("#view-3d").disabled = !available;
    const status = document.querySelector("#view-status");
    status.textContent = message;
    status.hidden = !message;
  }

  setZoom(zoom) {
    document.querySelector("#zoom-level").textContent = `${zoom.toFixed(1)}×`;
    document.querySelector("#zoom-in").disabled = zoom >= 12;
    document.querySelector("#zoom-out").disabled = zoom <= 1;
  }

  setLegend([low, high], peak = high) {
    document.querySelector("#legend-low").textContent = `Low · ${Math.round(low)} height units`;
    document.querySelector("#legend-high").textContent = `Red · ${Math.round(high)} → Dark red peak · ${Math.round(peak)}`;
  }
}
