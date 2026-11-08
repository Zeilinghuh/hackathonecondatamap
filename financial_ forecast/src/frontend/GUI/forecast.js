// Forecast controls + weather overlay for the UK economic-terrain map.
//
// Drop in src/frontend/GUI/ and load with:  <script type="module" src="forecast.js"></script>
// Put  <div id="forecast-mount"></div>  in the side panel where the buttons should appear.
//
// The map shell can optionally expose  window.ForecastHost = {
//     container: HTMLElement,                 // element the map is drawn in
//     project(lon, lat) -> {x, y} | null,     // CSS px relative to container
//     areaPosition(code) -> {x, y} | null,    // optional: per-authority anchor (mist/rain)
// }
// Without a host the panel, slider, thermometer and the 'forecast:frame' event still work.

const WEATHER = [
  { id: "mist", label: "Mist", variable: "deaths", note: "business deaths" },
  { id: "wind", label: "Wind", variable: "fdi", note: "foreign investment" },
  { id: "rain", label: "Rain", variable: "weeklypay", note: "avg weekly pay" },
  { id: "thermo", label: "Thermometer", variable: "rate", note: "interest-rate signal" },
];
const LAYOUT2 = [
  { id: "income", label: "Household income", variable: "income" },
  { id: "density", label: "Density", variable: "density" },
  { id: "vegetation", label: "Vegetation", variable: "employment", note: "employment rate" },
];
const SHOCK_VARS = [
  ["income", "Income"], ["weeklypay", "Weekly pay"], ["fdi", "FDI"],
  ["deaths", "Business deaths"], ["density", "Density"], ["employment", "Employment"],
];

const state = { data: null, yi: 0, playing: false, active: new Set(), shocks: {}, rateBias: 0, timer: null, fetchTimer: null };
const els = {};
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ------------------------------------------------------------------ data
async function load() {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state.shocks)) if (v) q.set(`shock_${k}`, v);
  if (state.rateBias) q.set("rate_bias", state.rateBias);
  const res = await fetch(`/api/forecast${q.size ? `?${q}` : ""}`);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const keepYear = state.data ? state.data.years[state.yi] : null;
  state.data = await res.json();
  const i = keepYear == null ? -1 : state.data.years.indexOf(keepYear);
  state.yi = i >= 0 ? i : state.data.years.indexOf(state.data.projected_from - 1);
  els.slider.max = state.data.years.length - 1;
  syncUI();
}

const D = () => state.data;
const year = () => D().years[state.yi];
const isProjected = () => year() >= D().projected_from;

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

// ------------------------------------------------------------------ UI
function css() {
  const s = document.createElement("style");
  s.textContent = `
  #forecast-panel{font:inherit;color:inherit;margin-top:14px}
  #forecast-panel h4{margin:14px 0 6px;font-size:.85em;letter-spacing:.04em}
  #forecast-panel .fc-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  #forecast-panel button{font:inherit;color:inherit;background:transparent;border:1px solid rgba(120,160,200,.35);padding:8px 6px;cursor:pointer}
  #forecast-panel button[aria-pressed=true]{background:rgba(0,220,190,.18);border-color:#2fe0c0;color:#2fe0c0}
  #forecast-panel .fc-time{display:flex;gap:8px;align-items:center}
  #forecast-panel .fc-time input{flex:1}
  #forecast-panel .fc-tag{font-size:.75em;padding:2px 6px;border:1px solid currentColor}
  #forecast-panel .fc-tag.proj{color:#ff8a5c}#forecast-panel .fc-tag.real{color:#7fd0ff}
  #forecast-panel details{margin-top:10px}
  #forecast-panel label{display:flex;justify-content:space-between;gap:8px;font-size:.8em;margin:4px 0}
  #forecast-panel label input{flex:1}
  #fc-thermo{display:none;margin-top:10px;gap:12px;align-items:flex-end}
  #fc-thermo.on{display:flex}
  #fc-thermo .tube{position:relative;width:18px;height:110px;border:2px solid #cfe8ff;border-radius:10px 10px 0 0;overflow:hidden}
  #fc-thermo .fill{position:absolute;bottom:0;left:0;right:0;background:#ff3b5c;transition:height .4s}
  #fc-thermo .bulb{width:30px;height:30px;border-radius:50%;background:#ff3b5c;margin:0 0 -4px -6px;border:2px solid #cfe8ff}
  #fc-thermo .read{font-size:.85em;line-height:1.5}
  #fc-canvas{position:absolute;inset:0;pointer-events:none;z-index:5}`;
  document.head.appendChild(s);
}

function toggleBtn(def, group) {
  const b = document.createElement("button");
  b.textContent = def.label;
  b.title = def.note || "";
  b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", () => {
    const on = !state.active.has(def.id);
    on ? state.active.add(def.id) : state.active.delete(def.id);
    b.setAttribute("aria-pressed", String(on));
    document.dispatchEvent(new CustomEvent("forecast:layer", { detail: { id: def.id, on, variable: def.variable, group } }));
    syncUI();
    ensureLoop();
  });
  return b;
}

function section(title, defs, group) {
  const wrap = document.createElement("div");
  const h = document.createElement("h4");
  h.textContent = title;
  const grid = document.createElement("div");
  grid.className = "fc-grid";
  defs.forEach((d) => grid.appendChild(toggleBtn(d, group)));
  wrap.append(h, grid);
  return wrap;
}

function buildPanel() {
  css();
  const panel = document.createElement("div");
  panel.id = "forecast-panel";
  panel.appendChild(section("Forecast weather", WEATHER, "weather"));
  panel.appendChild(section("Map layout 2", LAYOUT2, "layout2"));

  const time = document.createElement("div");
  time.innerHTML = `<h4>Timeline</h4><div class="fc-time">
    <button id="fc-play" aria-pressed="false" style="width:44px">Play</button>
    <input id="fc-slider" type="range" min="0" max="0" value="0">
    <span id="fc-year"></span><span id="fc-tag" class="fc-tag"></span></div>`;
  panel.appendChild(time);

  const what = document.createElement("details");
  what.innerHTML = `<summary>What if? (pushes the linked matrix)</summary>
    ${SHOCK_VARS.map(([k, n]) => `<label>${n} growth<input type="range" data-shock="${k}" min="-2" max="2" step="0.25" value="0"><output>0</output></label>`).join("")}
    <label>Rate stance<input type="range" data-rate min="-1" max="1" step="0.1" value="0"><output>0</output></label>
    <button id="fc-reset" style="margin-top:6px">Reset</button>`;
  panel.appendChild(what);

  const thermo = document.createElement("div");
  thermo.id = "fc-thermo";
  thermo.innerHTML = `<div><div class="tube"><div class="fill"></div></div><div class="bulb"></div></div><div class="read"></div>`;
  panel.appendChild(thermo);

  (document.getElementById("forecast-mount") || document.querySelector("aside, .panel, #panel") || document.body).appendChild(panel);
  Object.assign(els, {
    panel, slider: panel.querySelector("#fc-slider"), year: panel.querySelector("#fc-year"), tag: panel.querySelector("#fc-tag"),
    play: panel.querySelector("#fc-play"), thermo, fill: thermo.querySelector(".fill"), read: thermo.querySelector(".read"),
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
  what.addEventListener("input", (e) => {
    const t = e.target;
    t.nextElementSibling.textContent = t.value;
    if (t.dataset.shock) state.shocks[t.dataset.shock] = Number(t.value);
    if ("rate" in t.dataset) state.rateBias = Number(t.value);
    clearTimeout(state.fetchTimer);
    state.fetchTimer = setTimeout(() => load().catch(console.error), 250);
  });
  panel.querySelector("#fc-reset").addEventListener("click", () => {
    what.querySelectorAll("input").forEach((i) => { i.value = 0; i.nextElementSibling.textContent = "0"; });
    state.shocks = {}; state.rateBias = 0;
    load().catch(console.error);
  });
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

function frame(t) {
  raf = 0;
  if (!D() || !ensureCanvas()) return;
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (state.active.has("mist")) drawMist(t);
  if (state.active.has("rain")) drawRain();
  if (state.active.has("wind")) drawWind(t);
  if (["mist", "rain", "wind"].some((k) => state.active.has(k))) raf = requestAnimationFrame(frame);
}

function ensureLoop() {
  if (!raf && ["mist", "rain", "wind"].some((k) => state.active.has(k))) raf = requestAnimationFrame(frame);
  if (canvas && !["mist", "rain", "wind"].some((k) => state.active.has(k))) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ------------------------------------------------------------------ boot
window.Forecast = { state, getValue, norm, reload: () => load() };
buildPanel();
load().catch((e) => { console.error(e); els.tag.textContent = "forecast offline"; });
