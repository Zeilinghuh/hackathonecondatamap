import { CONTOUR_COLOURS, PEAK_COLOURS, DENSITY_BREAKS, DENSITY_COLOURS, NO_DATA_COLOUR } from "../map/render/terraintexture.js?v=density-blue-pink-3";

const NOTES = {
  terrain: "Blue lows → cyan → green → yellow → red → dark crimson peaks.",
  density: "Population density terrain: height follows log₁₀ residents per km². Electric blue is sparse, hot pink is crowded; contours are white.",
  borders: "Authority borders only. Hover an area, then click to select it.",
  vegetation: "Darker green shows higher employment. Small trees mark only 85%+ areas. Move the year slider, then select an area for its rate and annual change.",
  mist: "Business-death mist: denser wisps indicate a higher share of active businesses that ceased trading in 2024.",
};
export const formatDensity = value => Math.round(value).toLocaleString() + " / km²";

// DOM controls live in GUI; the map and terrain renderer remain reusable.
export class TerrainControls {
  constructor({ onChange, onOverlayChange = onChange, onZoom, onReset, onMode }) {
    this.layer = "terrain";
    this.mistEnabled = false;
    this.layerButtons = [...document.querySelectorAll(".layer-switch button")];
    this.mistToggle = document.querySelector("#mist-toggle");
    const colours = [...CONTOUR_COLOURS, ...PEAK_COLOURS];
    document.querySelector(".gradient").style.background = `linear-gradient(90deg, ${colours.map((colour, index) => `${colour} ${index / colours.length * 100}% ${(index + 1) / colours.length * 100}%`).join(", ")})`;
    this.buildDensityLegend();
    for (const button of this.layerButtons) button.addEventListener("click", () => {
      if (button.dataset.layer === this.layer) return;
      this.setLayer(button.dataset.layer);
      onChange();
    });
    this.mistToggle.addEventListener("click", () => {
      this.mistEnabled = !this.mistEnabled;
      this.mistToggle.setAttribute("aria-pressed", String(this.mistEnabled));
      document.querySelector("#mist-key").hidden = !this.mistEnabled;
      onOverlayChange();
    });
    document.querySelector("#zoom-in").addEventListener("click", () => onZoom(1.4));
    document.querySelector("#zoom-out").addEventListener("click", () => onZoom(1 / 1.4));
    document.querySelector("#reset-view").addEventListener("click", onReset);
    document.querySelector("#view-2d").addEventListener("click", () => onMode("2d"));
    document.querySelector("#view-3d").addEventListener("click", () => onMode("3d"));
    const sidebar = document.querySelector("#sidebar");
    const sidebarToggle = document.querySelector("#sidebar-toggle");
    const shell = document.querySelector(".app-shell");
    const setSidebar = collapsed => {
      // Keep the panel mounted so CSS can animate it; inert removes closed
      // controls from keyboard focus immediately, including during the slide.
      if (collapsed && sidebar.contains(document.activeElement)) sidebarToggle.focus({preventScroll:true});
      sidebar.inert = collapsed;
      sidebar.setAttribute("aria-hidden", String(collapsed));
      shell.classList.toggle("sidebar-collapsed", collapsed);
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      sidebarToggle.textContent = collapsed ? "◂ Show panel" : "Hide panel ▸";
      try { localStorage.setItem("terrain.sidebarCollapsed", String(collapsed)); } catch {}
    };
    sidebarToggle.addEventListener("click", () => setSidebar(sidebarToggle.getAttribute("aria-expanded") === "true"));
    try {
      const saved = localStorage.getItem("terrain.sidebarCollapsed");
      setSidebar(saved === null ? matchMedia("(max-width:760px)").matches : saved === "true");
    } catch { setSidebar(matchMedia("(max-width:760px)").matches); }
    // Restore saved layout without an entrance animation on page load.
    requestAnimationFrame(() => requestAnimationFrame(() => shell.classList.add("sidebar-ready")));
  }

  // Raised, contoured base surface: "income", "density" or null (flat borders + hover).
  get surface() { return {terrain: "income", density: "density"}[this.layer] ?? null; }
  get visible() { return this.surface !== null; }
  get density() { return this.layer === "density"; }
  get vegetation() { return this.layer === "vegetation"; }
  get timelineSurface() { return this.vegetation ? "employment" : this.surface; }

  setLayer(layer) {
    this.layer = layer;
    for (const button of this.layerButtons) button.setAttribute("aria-pressed", String(button.dataset.layer === layer));
    document.querySelector("#control-note").textContent = NOTES[layer];
    document.querySelector("#terrain-key").hidden = layer !== "terrain";
    document.querySelector("#density-key").hidden = layer !== "density";
    document.querySelector("#vegetation-key").hidden = layer !== "vegetation";
    document.querySelector("#mist-key").hidden = layer !== "mist";
  }

  // Older cached map scripts still call this hook; keep dates out of the key text.
  setEmploymentSource(year) {
    document.querySelector("#vegetation-key").dataset.sourceYear = String(year);
  }

  buildDensityLegend() {
    const labels = DENSITY_COLOURS.map((_, index) => {
      const low = DENSITY_BREAKS[index - 1], high = DENSITY_BREAKS[index];
      if (low === undefined) return `Under ${high.toLocaleString()}`;
      if (high === undefined) return `${low.toLocaleString()}+`;
      return `${low.toLocaleString()}–${high.toLocaleString()}`;
    });
    const list = document.querySelector("#density-classes");
    list.replaceChildren(...labels.map((label, index) => {
      const item = document.createElement("li"), swatch = document.createElement("span"), text = document.createElement("span");
      swatch.className = "swatch"; swatch.style.background = DENSITY_COLOURS[index];
      swatch.setAttribute("aria-hidden", "true");
      text.className = "visually-hidden"; text.textContent = label;
      item.append(swatch, text);
      return item;
    }));
    document.querySelector("#density-low").textContent = labels[0] + " / km²";
    document.querySelector("#density-high").textContent = labels[labels.length - 1] + " / km²";
    document.querySelector("#density-missing").style.background = NO_DATA_COLOUR;
  }

  // meta: metadata.population_density (source_year, log10_range).
  setDensitySource(meta) {
    if (!meta) return;
    const [low, high] = meta.log10_range ?? [];
    if (Number.isFinite(low) && Number.isFinite(high)) {
      // Heights are 0–1000; major contours every 25 units multiply density by this factor.
      const factor = 10 ** ((high - low) * 25 / 1000);
      NOTES.density = `Population density terrain: height follows log₁₀ residents per km², so each bold contour ≈ ×${factor.toFixed(2)} people. Electric blue is sparse, hot pink is crowded; contours are white.`;
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
      ? "3D economic landscape. Drag or use arrow keys to pan. Shift-drag or Shift-arrow rotates. Scroll or press plus and minus to zoom. Zero resets the UK view."
      : "UK income, population density and employment vegetation map. Drag or use arrow keys to pan, plus and minus to zoom, and zero to reset.");
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
