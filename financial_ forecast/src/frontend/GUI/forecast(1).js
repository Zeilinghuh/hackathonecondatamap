// Forecast controls + weather overlay for the UK economic-terrain map.
//
// Drop in src/frontend/GUI/ and load with:  <script type="module" src="forecast.js"></script>
//
// Where things appear (all optional, first match wins):
//   <div id="forecast-main"></div>   the four weather buttons (Mist / Wind / Rain / Thermometer), as the
//                                    page's main buttons. Put it next to or above the map's own controls.
//   <div id="forecast-mount"></div>  everything else: timeline, "edit weather in an area", what-if, extra layers.
// If there is no #forecast-main the weather buttons sit at the top of the side panel (still the first, biggest
// buttons); if there is no panel at all they float across the top of the page.
//
// The map shell can optionally expose  window.ForecastHost = {
//     container: HTMLElement,                 // element the map is drawn in
//     project(lon, lat) -> {x, y} | null,     // CSS px relative to container
//     areaPosition(code) -> {x, y} | null,    // optional: per-authority anchor (mist/rain, selection ring)
// }
// Without a host the panel, slider, thermometer and the 'forecast:frame' event still work.
//
// To let a click on the map choose the area to edit, call  Forecast.selectArea(code)  from the map's click
// handler (or dispatch  document.dispatchEvent(new CustomEvent("forecast:select-area", {detail: {code}})) ).
//
// Events fired on document:
//   forecast:frame        every time the year/data changes     { year, projected, rate, active, getValue }
//   forecast:layer        a button is toggled                  { id, on, variable, group }
//   forecast:area         the edited area changes              { code, name, region }
//   forecast:edit         any weather edit changes             { areaShocks }

const WEATHER = [
  { id: "mist", label: "Mist", variable: "deaths", note: "business deaths", low: "clearer", high: "thicker" },
  { id: "wind", label: "Wind", variable: "fdi", note: "foreign investment", low: "calmer", high: "stronger", regional: true },
  { id: "rain", label: "Rain", variable: "weeklypay", note: "avg weekly pay", low: "drier", high: "heavier" },
  { id: "thermo", label: "Thermometer", variable: "rate", note: "interest-rate signal", national: true },
];
const OTHER_LAYERS = [
  { id: "income", label: "Household income", variable: "income" },
  { id: "density", label: "Density", variable: "density" },
  { id: "vegetation", label: "Vegetation", variable: "employment", note: "employment rate" },
];
const AREA_EDITS = WEATHER.filter((w) => !w.national);          // the thermometer (interest rate) is national
const SHOCK_VARS = [
  ["income", "Income"], ["weeklypay", "Weekly pay"], ["fdi", "FDI"],
  ["deaths", "Business deaths"], ["density", "Density"], ["employment", "Employment"],
];
const ANIMATED = ["mist", "rain", "wind"];

const state = {
  data: null, yi: 0, playing: false, active: new Set(),
  shocks: {},          // whole-UK what-if:      { variable: z }
  areaShocks: {},      // per-authority edits:   { code: { variable: z } }
  selected: null,      // authority currently being edited
  rateBias: 0, timer: null, fetchTimer: null, seq: 0, ctrl: null,
};
const els = { vals: {} };
const labelToCode = new Map();
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const weatherFor = (variable) => WEATHER.find((w) => w.variable === variable);

// ------------------------------------------------------------------ data
async function load() {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state.shocks)) if (v) q.set(`shock_${k}`, v);
  if (state.rateBias) q.set("rate_bias", state.rateBias);
  if (Object.keys(state.areaShocks).length) q.set("area_shocks", JSON.stringify(state.areaShocks));

  const mine = ++state.seq;                                   // only the newest request is allowed to land
  if (state.ctrl) state.ctrl.abort();
  state.ctrl = new AbortController();
  setStatus("updating…");

  let res;
  try {
    res = await fetch(`/api/forecast${q.toString() ? `?${q}` : ""}`, { signal: state.ctrl.signal });
  } catch (e) {
    if (e.name === "AbortError") return;
    throw e;
  }
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const data = await res.json();
  if (mine !== state.seq) return;

  const keepYear = state.data ? state.data.years[state.yi] : null;
  state.data = data;
  const i = keepYear == null ? -1 : data.years.indexOf(keepYear);
  state.yi = i >= 0 ? i : startIndex(data);
  els.slider.max = data.years.length - 1;
  setStatus("");
  fillAreaList();
  syncAreaEditor();
  renderEdits();
  syncUI();
  requestDraw();
}

// open on the latest recorded year in which mist, wind and rain all have data (the series end in different years)
function startIndex(data) {
  const last = data.years.indexOf(data.projected_from) - 1;
  for (let i = last; i >= 0; i--) {
    if (["deaths", "weeklypay", "fdi"].every((v) => data.national[v] && data.national[v][i] != null)) return i;
  }
  return Math.max(last, 0);
}

const D = () => state.data;
const year = () => D().years[state.yi];
const isProjected = () => year() >= D().projected_from;
const areaOf = (code) => (D() ? D().areas.find((a) => a.code === code) : null);
const areaName = (code) => (areaOf(code) || {}).name || code;

function norm(variable, v) {
  if (v == null) return 0;
  const [lo, hi] = D().variables[variable].range;
  if (variable === "fdi") return clamp01((Math.log(Math.max(v, 1)) - Math.log(Math.max(lo, 1))) / (Math.log(hi) - Math.log(Math.max(lo, 1))));
  return clamp01((v - lo) / (hi - lo));
}

// value for one authority (or region code for fdi) in the displayed year
function getValue(variable, code) {
  if (!D()) return null;
  if (variable === "fdi") {
    const r = D().regions.find((x) => x.code === code || x.code === (D().areas.find((a) => a.code === code) || {}).region);
    return r ? r.fdi[state.yi] : null;
  }
  const i = D().areas.findIndex((a) => a.code === code);
  return i < 0 ? null : D().values[variable][i][state.yi];
}

function scheduleLoad() {
  clearTimeout(state.fetchTimer);
  state.fetchTimer = setTimeout(() => load().catch(onLoadError), 250);
}
function onLoadError(e) {
  console.error(e);
  setStatus("");
  els.tag.textContent = "forecast offline";
}
function setStatus(text) { if (els.status) els.status.textContent = text; }

// ------------------------------------------------------------------ area edits
function setAreaShock(code, variable, value) {
  const cur = { ...(state.areaShocks[code] || {}) };
  if (value) cur[variable] = value; else delete cur[variable];
  if (Object.keys(cur).length) state.areaShocks[code] = cur; else delete state.areaShocks[code];
  renderEdits();
  requestDraw();
  scheduleLoad();
  document.dispatchEvent(new CustomEvent("forecast:edit", { detail: { areaShocks: state.areaShocks } }));
}

function clearArea(code) {
  delete state.areaShocks[code];
  if (state.selected === code) syncAreaEditor();
  renderEdits();
  requestDraw();
  scheduleLoad();
  document.dispatchEvent(new CustomEvent("forecast:edit", { detail: { areaShocks: state.areaShocks } }));
}

function clearAllAreas() {
  state.areaShocks = {};
  syncAreaEditor();
  renderEdits();
  requestDraw();
  scheduleLoad();
  document.dispatchEvent(new CustomEvent("forecast:edit", { detail: { areaShocks: state.areaShocks } }));
}

function selectArea(code) {
  const a = areaOf(code);
  if (!a) return false;
  state.selected = code;
  els.area.open = true;
  syncAreaEditor();
  requestDraw();
  document.dispatchEvent(new CustomEvent("forecast:area", { detail: { code, name: areaName(code), region: a.region } }));
  return true;
}

function describe(variable, v) {
  const w = weatherFor(variable);
  if (!v) return "normal";
  return `${v > 0 ? w.high : w.low} ${v > 0 ? "+" : ""}${v}`;
}

function fillAreaList() {
  if (labelToCode.size || !D()) return;
  const frag = document.createDocumentFragment();
  [...D().areas].sort((a, b) => a.name.localeCompare(b.name)).forEach((a) => {
    const label = a.name && a.name !== a.code ? `${a.name} (${a.code})` : a.code;
    labelToCode.set(label, a.code);
    const o = document.createElement("option");
    o.value = label;
    frag.appendChild(o);
  });
  els.datalist.appendChild(frag);
}

function syncAreaEditor() {
  const code = state.selected;
  const a = code && areaOf(code);
  els.fields.disabled = !a;
  if (!a) {
    els.title.textContent = "Pick an authority to edit its weather.";
    els.areaSliders.forEach((s) => { s.value = 0; s.nextElementSibling.textContent = "normal"; });
    return;
  }
  const region = D().regions.find((r) => r.code === a.region);
  els.title.innerHTML = `<b>${a.name}</b>${region ? ` · ${region.name}` : ""}`;
  els.windNote.textContent = `Wind is regional: it applies to all of ${region ? region.name : "its region"}.`;
  const cur = state.areaShocks[code] || {};
  els.areaSliders.forEach((s) => {
    const v = cur[s.dataset.var] || 0;
    s.value = v;
    s.nextElementSibling.textContent = describe(s.dataset.var, v);
  });
  els.input.value = a.name && a.name !== a.code ? `${a.name} (${a.code})` : a.code;
}

function renderEdits() {
  const codes = Object.keys(state.areaShocks);
  els.edits.innerHTML = codes.length
    ? codes.map((c) => {
        const parts = Object.entries(state.areaShocks[c]).map(([v, x]) => `${weatherFor(v).label.toLowerCase()} ${x > 0 ? "+" : ""}${x}`).join(", ");
        return `<span class="fc-chip"><button data-pick="${c}" title="Edit this area">${areaName(c)}: ${parts}</button><button data-clear="${c}" title="Remove" aria-label="Remove edits for ${areaName(c)}">×</button></span>`;
      }).join("")
    : `<span class="fc-muted">No area edits yet.</span>`;
  els.clearAll.style.display = codes.length ? "" : "none";
}

// ------------------------------------------------------------------ UI
function css() {
  const s = document.createElement("style");
  s.textContent = `
  #forecast-panel{font:inherit;color:inherit;margin-top:14px}
  #forecast-panel h4{margin:14px 0 6px;font-size:.85em;letter-spacing:.04em}
  #forecast-panel .fc-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
  #forecast-panel button,.fc-main button{font:inherit;color:inherit;background:transparent;border:1px solid rgba(120,160,200,.35);padding:8px 6px;cursor:pointer}
  #forecast-panel button[aria-pressed=true]{background:rgba(0,220,190,.18);border-color:#2fe0c0;color:#2fe0c0}

  /* primary weather buttons */
  .fc-main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;font:inherit;color:inherit}
  .fc-main.float{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:30;width:min(720px,calc(100vw - 24px));
    padding:8px;background:rgba(8,14,24,.88);border:1px solid rgba(120,160,200,.35);backdrop-filter:blur(6px)}
  #forecast-panel>.fc-main{margin-bottom:6px}
  .fc-main button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-height:64px;padding:10px 12px;text-align:left;
    border:1.5px solid rgba(120,200,255,.55);background:rgba(20,40,60,.55)}
  .fc-main button:hover{background:rgba(40,80,110,.65)}
  .fc-main .fc-b-label{font-size:1.1em;font-weight:700;letter-spacing:.02em}
  .fc-main .fc-b-sub{font-size:.72em;opacity:.7}
  .fc-main .fc-b-val{font-size:.85em;color:#7fd0ff;margin-top:auto}
  .fc-main button[aria-pressed=true]{background:rgba(0,220,190,.22);border-color:#2fe0c0;color:#2fe0c0;box-shadow:0 0 0 1px #2fe0c0 inset}
  .fc-main button[aria-pressed=true] .fc-b-val{color:#2fe0c0}
  @media (max-width:560px){.fc-main{grid-template-columns:1fr 1fr}}

  /* secondary layer buttons: smaller on purpose */
  #forecast-panel .fc-small button{padding:5px 4px;font-size:.8em;opacity:.85}
  #forecast-panel .fc-time{display:flex;gap:8px;align-items:center}
  #forecast-panel .fc-time input{flex:1}
  #forecast-panel .fc-tag{font-size:.75em;padding:2px 6px;border:1px solid currentColor}
  #forecast-panel .fc-tag.proj{color:#ff8a5c}#forecast-panel .fc-tag.real{color:#7fd0ff}
  #forecast-panel details{margin-top:10px}
  #forecast-panel summary{cursor:pointer;font-size:.85em;letter-spacing:.04em}
  #forecast-panel label{display:flex;justify-content:space-between;gap:8px;font-size:.8em;margin:4px 0;align-items:center}
  #forecast-panel label input{flex:1}
  #forecast-panel label output{min-width:84px;text-align:right}
  #forecast-panel fieldset{border:0;padding:0;margin:6px 0 0}
  #forecast-panel fieldset:disabled{opacity:.45}
  #forecast-panel .fc-pick input{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:rgba(10,20,35,.6);border:1px solid rgba(120,160,200,.35);padding:7px 8px}
  #forecast-panel .fc-area-title{margin:8px 0 2px;font-size:.9em}
  #forecast-panel .fc-muted{font-size:.75em;opacity:.65}
  #forecast-panel .fc-edits{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
  #forecast-panel .fc-chip{display:inline-flex;border:1px solid rgba(47,224,192,.5)}
  #forecast-panel .fc-chip button{border:0;padding:3px 7px;font-size:.75em}
  #forecast-panel .fc-status{font-size:.75em;opacity:.7;margin-left:6px}
  #fc-thermo{display:none;margin-top:10px;gap:12px;align-items:flex-end}
  #fc-thermo.on{display:flex}
  #fc-thermo .tube{position:relative;width:18px;height:110px;border:2px solid #cfe8ff;border-radius:10px 10px 0 0;overflow:hidden}
  #fc-thermo .fill{position:absolute;bottom:0;left:0;right:0;background:#ff3b5c;transition:height .4s}
  #fc-thermo .bulb{width:30px;height:30px;border-radius:50%;background:#ff3b5c;margin:0 0 -4px -6px;border:2px solid #cfe8ff}
  #fc-thermo .read{font-size:.85em;line-height:1.5}
  #fc-canvas{position:absolute;inset:0;pointer-events:none;z-index:5}`;
  document.head.appendChild(s);
}

function toggleBtn(def, group, primary) {
  const b = document.createElement("button");
  b.setAttribute("aria-pressed", "false");
  b.title = def.note || "";
  if (primary) {
    b.innerHTML = `<span class="fc-b-label">${def.label}</span><span class="fc-b-sub">${def.note || ""}</span><span class="fc-b-val">–</span>`;
    els.vals[def.id] = b.querySelector(".fc-b-val");
  } else {
    b.textContent = def.label;
  }
  b.addEventListener("click", () => {
    const on = !state.active.has(def.id);
    on ? state.active.add(def.id) : state.active.delete(def.id);
    b.setAttribute("aria-pressed", String(on));
    document.dispatchEvent(new CustomEvent("forecast:layer", { detail: { id: def.id, on, variable: def.variable, group } }));
    syncUI();
    requestDraw();
  });
  return b;
}

function buildPanel() {
  css();

  // 1. the weather buttons: the page's main buttons
  const bar = document.createElement("div");
  bar.className = "fc-main";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Weather layers");
  WEATHER.forEach((d) => bar.appendChild(toggleBtn(d, "weather", true)));

  // 2. everything else, in a side panel
  const panel = document.createElement("div");
  panel.id = "forecast-panel";

  const time = document.createElement("div");
  time.innerHTML = `<h4>Timeline <span id="fc-status" class="fc-status"></span></h4><div class="fc-time">
    <button id="fc-play" aria-pressed="false" style="width:44px">Play</button>
    <input id="fc-slider" type="range" min="0" max="0" value="0">
    <span id="fc-year"></span><span id="fc-tag" class="fc-tag"></span></div>`;
  panel.appendChild(time);

  const area = document.createElement("details");
  area.id = "fc-area";
  area.open = true;
  area.innerHTML = `<summary>Edit weather in an area</summary>
    <div class="fc-pick"><input id="fc-area-input" list="fc-area-list" placeholder="Search for an authority…" autocomplete="off" aria-label="Authority to edit"><datalist id="fc-area-list"></datalist></div>
    <div class="fc-area-title" id="fc-area-title"></div>
    <fieldset id="fc-area-fields" disabled>
      ${AREA_EDITS.map((w) => `<label>${w.label} <span class="fc-muted">${w.note}</span>
        <input type="range" data-var="${w.variable}" min="-2" max="2" step="0.25" value="0" aria-label="${w.label} in selected area"><output>normal</output></label>`).join("")}
      <div class="fc-muted" id="fc-wind-note"></div>
      <div class="fc-muted">Interest rate is set nationally: use “Rate stance” under What if.</div>
    </fieldset>
    <div class="fc-edits" id="fc-edits"></div>
    <button id="fc-clear-all" style="display:none">Clear all area edits</button>`;
  panel.appendChild(area);

  const small = document.createElement("div");
  small.className = "fc-small";
  const smallH = document.createElement("h4");
  smallH.textContent = "Other layers";
  const grid = document.createElement("div");
  grid.className = "fc-grid";
  OTHER_LAYERS.forEach((d) => grid.appendChild(toggleBtn(d, "layout2", false)));
  small.append(smallH, grid);
  panel.appendChild(small);

  const what = document.createElement("details");
  what.innerHTML = `<summary>What if? (whole UK)</summary>
    ${SHOCK_VARS.map(([k, n]) => `<label>${n} growth<input type="range" data-shock="${k}" min="-2" max="2" step="0.25" value="0"><output>0</output></label>`).join("")}
    <label>Rate stance<input type="range" data-rate min="-1" max="1" step="0.1" value="0"><output>0</output></label>
    <button id="fc-reset" style="margin-top:6px">Reset</button>`;
  panel.appendChild(what);

  const thermo = document.createElement("div");
  thermo.id = "fc-thermo";
  thermo.innerHTML = `<div><div class="tube"><div class="fill"></div></div><div class="bulb"></div></div><div class="read"></div>`;
  panel.appendChild(thermo);

  // placement
  const mainMount = document.getElementById("forecast-main");
  const sideMount = document.getElementById("forecast-mount") || document.querySelector("aside, .panel, #panel");
  if (mainMount) {
    mainMount.appendChild(bar);
    (sideMount || document.body).appendChild(panel);
  } else if (sideMount) {
    panel.prepend(bar);
    sideMount.appendChild(panel);
  } else {
    bar.classList.add("float");
    document.body.append(bar, panel);
  }

  Object.assign(els, {
    bar, panel, slider: panel.querySelector("#fc-slider"), year: panel.querySelector("#fc-year"), tag: panel.querySelector("#fc-tag"),
    status: panel.querySelector("#fc-status"), play: panel.querySelector("#fc-play"), thermo, fill: thermo.querySelector(".fill"),
    read: thermo.querySelector(".read"), area, input: area.querySelector("#fc-area-input"), datalist: area.querySelector("#fc-area-list"),
    title: area.querySelector("#fc-area-title"), fields: area.querySelector("#fc-area-fields"), windNote: area.querySelector("#fc-wind-note"),
    areaSliders: [...area.querySelectorAll("input[data-var]")], edits: area.querySelector("#fc-edits"), clearAll: area.querySelector("#fc-clear-all"),
  });

  els.slider.addEventListener("input", () => { state.yi = Number(els.slider.value); syncUI(); });
  els.play.addEventListener("click", () => {
    state.playing = !state.playing;
    els.play.setAttribute("aria-pressed", String(state.playing));
    clearInterval(state.timer);
    if (state.playing) state.timer = setInterval(() => {
      state.yi = state.yi >= D().years.length - 1 ? 0 : state.yi + 1;
      syncUI();
    }, 700);
  });

  // per-area weather sliders
  els.areaSliders.forEach((s) => s.addEventListener("input", () => {
    if (!state.selected) return;
    const v = Number(s.value);
    s.nextElementSibling.textContent = describe(s.dataset.var, v);
    setAreaShock(state.selected, s.dataset.var, v);
  }));
  els.input.addEventListener("input", () => {
    const code = labelToCode.get(els.input.value);
    if (code) selectArea(code);
  });
  els.edits.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.clear) clearArea(t.dataset.clear);
    if (t.dataset.pick) selectArea(t.dataset.pick);
  });
  els.clearAll.addEventListener("click", clearAllAreas);

  // whole-UK what-if
  what.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.matches("input")) return;
    t.nextElementSibling.textContent = t.value;
    if (t.dataset.shock) state.shocks[t.dataset.shock] = Number(t.value);
    if ("rate" in t.dataset) state.rateBias = Number(t.value);
    scheduleLoad();
  });
  panel.querySelector("#fc-reset").addEventListener("click", () => {
    what.querySelectorAll("input").forEach((i) => { i.value = 0; i.nextElementSibling.textContent = "0"; });
    state.shocks = {}; state.rateBias = 0;
    load().catch(onLoadError);
  });

  document.addEventListener("forecast:select-area", (e) => e.detail && selectArea(e.detail.code));
}

const fmt = {
  deaths: (v) => `${v.toFixed(1)}%`,
  weeklypay: (v) => `£${Math.round(v)}`,
  fdi: (v) => `£${Math.round(v).toLocaleString()}m`,
};
const nat = (variable) => (D().national[variable] ? D().national[variable][state.yi] : null);

function updateReadouts() {
  const put = (id, variable) => {
    const v = nat(variable);
    els.vals[id].textContent = v == null ? "–" : fmt[variable](v);
  };
  put("mist", "deaths");
  put("rain", "weeklypay");
  put("wind", "fdi");
  const r = D().rate[state.yi];
  els.vals.thermo.textContent = r == null ? "–" : `${r > 0 ? "+" : ""}${r.toFixed(2)}`;
}

function syncUI() {
  if (!D()) return;
  els.slider.value = state.yi;
  els.year.textContent = year();
  els.tag.textContent = isProjected() ? "projected" : "recorded";
  els.tag.className = `fc-tag ${isProjected() ? "proj" : "real"}`;
  els.thermo.classList.toggle("on", state.active.has("thermo"));
  const r = D().rate[state.yi];
  const [lo, hi] = D().rate_limits;
  els.fill.style.height = `${r == null ? 8 : 8 + 92 * clamp01((r - lo) / (hi - lo))}%`;
  els.read.innerHTML = r == null
    ? `${year()}<br>no policy signal<br>(recorded year)`
    : `${year()}<br>rate signal <b>${r > 0 ? "+" : ""}${r.toFixed(2)}</b><br>${r > 0.05 ? "tightening" : r < -0.05 ? "easing" : "neutral"}`;
  updateReadouts();
  document.dispatchEvent(new CustomEvent("forecast:frame", {
    detail: { year: year(), projected: isProjected(), rate: r, active: [...state.active], getValue },
  }));
}

// ------------------------------------------------------------------ weather overlay
const host = () => window.ForecastHost;
let canvas, ctx, raf = 0, drops = [];

function ensureCanvas() {
  const h = host();
  if (!h || !h.container) return false;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "fc-canvas";
    ctx = canvas.getContext("2d");
  }
  if (canvas.parentElement !== h.container) {
    if (getComputedStyle(h.container).position === "static") h.container.style.position = "relative";
    h.container.appendChild(canvas);
  }
  const dpr = window.devicePixelRatio || 1;
  const w = h.container.clientWidth, ht = h.container.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== ht * dpr) { canvas.width = w * dpr; canvas.height = ht * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

function anchors(variable, perArea) {
  const h = host(), out = [];
  if (perArea && h.areaPosition) {
    D().areas.forEach((a, i) => {
      const p = h.areaPosition(a.code);
      if (p) out.push({ x: p.x, y: p.y, n: norm(variable, D().values[variable][i][state.yi]), r: 38 });
    });
    if (out.length) return out;
  }
  for (const r of D().regions) {
    const p = h.project(r.lon, r.lat);
    if (!p) continue;
    const v = variable === "fdi" ? r.fdi[state.yi] : D().national[variable][state.yi];
    out.push({ x: p.x, y: p.y, n: norm(variable, v), r: 90, region: r });
  }
  return out;
}

function drawMist(t) {
  for (const a of anchors("deaths", true)) {
    if (a.n < 0.05) continue;
    const dx = Math.sin(t / 2600 + a.x) * 8, dy = Math.cos(t / 3100 + a.y) * 5;
    const g = ctx.createRadialGradient(a.x + dx, a.y + dy, 2, a.x + dx, a.y + dy, a.r);
    g.addColorStop(0, `rgba(205,195,225,${0.55 * a.n})`);
    g.addColorStop(1, "rgba(205,195,225,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(a.x + dx, a.y + dy, a.r, 0, 7); ctx.fill();
  }
}

function drawRain() {
  const pts = anchors("weeklypay", true).filter((a) => a.n > 0.05);
  if (!pts.length) return;
  const total = pts.reduce((s, a) => s + a.n, 0);
  const want = Math.min(1800, 300 + pts.length * 6);
  while (drops.length < want) drops.push({ a: null, dy: 0, ox: 0, oy: 0 });
  drops.length = want;
  ctx.strokeStyle = "rgba(120,190,255,.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const d of drops) {
    if (!d.a || d.dy > 46) {                                  // respawn at a weighted-random anchor
      let pick = Math.random() * total;
      d.a = pts.find((a) => (pick -= a.n) <= 0) || pts[0];
      d.ox = (Math.random() - 0.5) * d.a.r * 1.6; d.oy = (Math.random() - 0.5) * d.a.r; d.dy = Math.random() * 20;
    }
    d.dy += 2.2 + d.a.n * 2;
    const x = d.a.x + d.ox + d.dy * 0.25, y = d.a.y + d.oy + d.dy - 40;
    ctx.moveTo(x, y); ctx.lineTo(x + 2, y + 8);
  }
  ctx.stroke();
}

function drawWind(t) {
  const prev = Math.max(0, state.yi - 1);
  for (const a of anchors("fdi", false)) {
    const r = a.region, grew = r.fdi[state.yi] >= r.fdi[prev];
    const len = 22 + 70 * a.n, ang = -0.6;                    // prevailing south-westerly; length = FDI level
    const ux = Math.cos(ang), uy = Math.sin(ang);
    ctx.strokeStyle = ctx.fillStyle = grew ? "#5cf2a0" : "#ff6b6b";
    ctx.lineWidth = 2 + 3 * a.n;
    ctx.setLineDash([10, 6]); ctx.lineDashOffset = -(t / 40) % 16;
    ctx.beginPath(); ctx.moveTo(a.x - ux * len / 2, a.y - uy * len / 2); ctx.lineTo(a.x + ux * len / 2, a.y + uy * len / 2); ctx.stroke();
    ctx.setLineDash([]);
    const hx = a.x + ux * len / 2, hy = a.y + uy * len / 2, s = 7 + 6 * a.n;
    ctx.beginPath();
    ctx.moveTo(hx + ux * s, hy + uy * s);
    ctx.lineTo(hx - uy * s * 0.6, hy + ux * s * 0.6);
    ctx.lineTo(hx + uy * s * 0.6, hy - ux * s * 0.6);
    ctx.fill();
  }
}

// marks the authority being edited (pulsing ring) and every authority that has edits (dot)
function drawEdits(t) {
  const h = host();
  if (!h || !h.areaPosition) return;
  ctx.setLineDash([]);
  ctx.fillStyle = "#2fe0c0";
  for (const code of Object.keys(state.areaShocks)) {
    const p = h.areaPosition(code);
    if (p) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill(); }
  }
  const p = state.selected && h.areaPosition(state.selected);
  if (p) {
    ctx.strokeStyle = "#2fe0c0";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 14 + 3 * Math.sin(t / 220), 0, 7); ctx.stroke();
  }
}

const animating = () => ANIMATED.some((k) => state.active.has(k));

function frame(t) {
  raf = 0;
  if (!D() || !ensureCanvas()) return;
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (state.active.has("mist")) drawMist(t);
  if (state.active.has("rain")) drawRain();
  if (state.active.has("wind")) drawWind(t);
  drawEdits(t);
  if (animating() || state.selected) raf = requestAnimationFrame(frame);
}

function requestDraw() {
  if (!raf) raf = requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
window.Forecast = {
  state, getValue, norm, reload: () => load(),
  selectArea, setAreaShock, clearArea,
  clearAreaEdits: clearAllAreas,
};
buildPanel();
syncAreaEditor();                         // panel exists before any data has arrived
renderEdits();
load().catch(onLoadError);
