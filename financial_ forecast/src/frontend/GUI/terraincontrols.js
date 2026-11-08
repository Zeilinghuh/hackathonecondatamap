import { CONTOUR_COLOURS, PEAK_COLOURS, DENSITY_BREAKS, DENSITY_COLOURS, NO_DATA_COLOUR } from "../map/render/terraintexture.js?v=density-blue-pink-3";

const NOTES = {
  terrain: "Household disposable income per head (£). Higher income creates taller shapes; colours run from blue to dark red.",
  density: "Population density is residents per km². Heights use a logarithmic scale: blue represents lower density and pink higher density. White contours show equal display heights.",
  borders: "Local planning authority boundaries. Hover to highlight an area, then click to view its recorded values.",
  vegetation: "Employment rate is the percentage of people aged 16–64 in work. Higher rates create taller green shapes. Trees mark 85% or above; select an area for its rate and annual change.",
  mist: "Business failure shows recorded business closures as a percentage of active businesses in 2024 (ONS business deaths). A denser overlay means a higher closure rate.",
};
export const formatDensity = value => Math.round(value).toLocaleString() + " / km²";

// Shared, cached audio stays with the existing GUI controls; no extra runtime.
export const sfx = new class {
  constructor() {
    this.enabled=true;this.buffers={};this.last={};
    try{this.enabled=localStorage.getItem("terrain.soundMuted")!=="true";}catch{}
  }
  bind() {
    if(this.bound)return;
    this.bound=true;this.toggle=document.querySelector("#sound-toggle");this.render();
    this.toggle?.addEventListener("click",()=>{
      this.enabled=!this.enabled;this.render();this.unlock();this.volume();
      try{localStorage.setItem("terrain.soundMuted",String(!this.enabled));}catch{}
      if(this.enabled)this.play("toggle");
    });
    for(const type of ["pointerdown","keydown"])document.addEventListener(type,event=>{if(event.isTrusted)this.unlock();},{capture:true});
    document.addEventListener("click",event=>{
      if(!event.isTrusted)return;
      const target=event.target.closest("button,a[href],input[type=checkbox],summary,[role=button]");
      if(!target || target.disabled || target===this.toggle)return;
      this.play(target.matches("[aria-pressed],input[type=checkbox]")?"toggle":"click");
    },true);
    document.addEventListener("input",event=>{if(event.isTrusted && event.target.matches("input[type=range]"))this.play("tick",{gain:.2});});
    document.addEventListener("visibilitychange",()=>this.volume());
  }
  render() {
    if(!this.toggle)return;
    this.toggle.textContent=this.enabled?"SFX ON":"SFX OFF";
    this.toggle.setAttribute("aria-pressed",String(this.enabled));
    this.toggle.setAttribute("aria-label",this.enabled?"Mute sound effects":"Enable sound effects");
  }
  unlock() {
    if(!this.enabled)return;
    try {
      if(!this.context) {
        const Audio=window.AudioContext || window.webkitAudioContext;if(!Audio)return;
        this.context=new Audio({latencyHint:"interactive"});this.output=this.context.createGain();this.output.connect(this.context.destination);this.volume();
        for(const name of ["click","toggle","confirm","bounce","tick"])
          fetch(`/GUI/assets/sfx/${name}.wav`).then(response=>{if(!response.ok)throw new Error("Audio unavailable");return response.arrayBuffer();})
            .then(data=>this.context.decodeAudioData(data)).then(buffer=>{this.buffers[name]=buffer;}).catch(()=>{});
      }
      if(this.context.state==="suspended")this.context.resume().catch(()=>{});
    }catch{}
  }
  volume() {if(this.output)this.output.gain.value=(this.enabled && !this.recording && !document.hidden) ? .45 : 0;}
  setRecording(recording) {this.recording=recording;this.volume();}
  allowed() {return this.enabled && !this.recording && !document.hidden && this.context?.state==="running";}
  play(name,{gain=.4,rate=1}={}) {
    if(!this.allowed())return;
    const now=this.context.currentTime;
    if(now-(this.last[name]??-1)<(name==="bounce" ? .12 : .055))return;
    this.last[name]=now;
    if(!this.buffers[name]){this.tone(name==="bounce"?180:name==="confirm"?780:520,.035,.06);return;}
    const source=this.context.createBufferSource(),level=this.context.createGain();
    source.buffer=this.buffers[name];source.playbackRate.value=rate;level.gain.value=gain;
    source.connect(level);level.connect(this.output);source.onended=()=>{source.disconnect();level.disconnect();};source.start();
  }
  tone(frequency,duration,gain) {
    const now=this.context.currentTime,osc=this.context.createOscillator(),level=this.context.createGain();
    osc.type="triangle";osc.frequency.setValueAtTime(frequency,now);osc.frequency.exponentialRampToValueAtTime(frequency*.7,now+duration);
    level.gain.setValueAtTime(.0001,now);level.gain.exponentialRampToValueAtTime(gain,now+.004);level.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.connect(level);level.connect(this.output);osc.onended=()=>{osc.disconnect();level.disconnect();};osc.start();osc.stop(now+duration+.01);
  }
  bounce(speed) {if(speed>70)this.play("bounce",{gain:Math.min(.6,.15+speed/2500),rate:.8+Math.min(speed,1500)/2500});}
  babble(character) {
    if(!this.allowed() || !/[a-z0-9]/i.test(character))return;
    const now=this.context.currentTime;if(now-(this.last.voice??-1)<.085)return;this.last.voice=now;
    const code=character.toLowerCase().charCodeAt(0),pitch=290+(code%9)*34;
    const osc=this.context.createOscillator(),level=this.context.createGain(),vowel=this.context.createBiquadFilter(),resonance=this.context.createBiquadFilter();
    osc.type="sawtooth";osc.frequency.setValueAtTime(pitch,now);osc.frequency.exponentialRampToValueAtTime(pitch*.82,now+.065);
    vowel.type=resonance.type="bandpass";vowel.frequency.value=400+(code%5)*110;vowel.Q.value=4;resonance.frequency.value=1400+(code%4)*240;resonance.Q.value=3;
    level.gain.setValueAtTime(.0001,now);level.gain.exponentialRampToValueAtTime(.11,now+.008);level.gain.exponentialRampToValueAtTime(.0001,now+.065);
    osc.connect(vowel);osc.connect(resonance);vowel.connect(level);resonance.connect(level);level.connect(this.output);
    osc.onended=()=>{osc.disconnect();vowel.disconnect();resonance.disconnect();level.disconnect();};osc.start();osc.stop(now+.075);
  }
};

// DOM controls live in GUI; the map and terrain renderer remain reusable.
export class TerrainControls {
  constructor({ onChange, onOverlayChange = onChange, onZoom, onReset, onMode }) {
    sfx.bind();
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
      document.querySelector("#control-note").textContent = NOTES[this.layer]+(this.mistEnabled?" "+NOTES.mist:"");
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
  get surface() { return {terrain: "income", density: "density",vegetation:"employment"}[this.layer] ?? null; }
  get visible() { return this.surface !== null; }
  get density() { return this.layer === "density"; }
  get vegetation() { return this.layer === "vegetation"; }
  get timelineSurface() { return this.vegetation ? "employment" : this.surface; }

  setLayer(layer) {
    this.layer = layer;
    for (const button of this.layerButtons) button.setAttribute("aria-pressed", String(button.dataset.layer === layer));
    document.querySelector("#control-note").textContent = NOTES[layer]+(this.mistEnabled?" "+NOTES.mist:"");
    document.querySelector("#terrain-key").hidden = layer !== "terrain";
    document.querySelector("#density-key").hidden = layer !== "density";
    document.querySelector("#vegetation-key").hidden = layer !== "vegetation";
    document.querySelector("#mist-key").hidden = !this.mistEnabled;
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
      NOTES.density = `Population density is residents per km²: blue is lower and pink higher. Heights use a logarithmic scale; each bold white contour represents about ×${factor.toFixed(2)} in density.`;
      if (this.layer === "density") document.querySelector("#control-note").textContent = NOTES.density+(this.mistEnabled?" "+NOTES.mist:"");
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
      : "UK income, population density and employment rate map. Drag or use arrow keys to pan, plus and minus to zoom, and zero to reset.");
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
