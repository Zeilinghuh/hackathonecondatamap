// One simulation controller shares the app's timeline, surfaces and selection.
export const VARIABLES={income:'Income per head',density:'Population density',employment:'Employment rate',weeklypay:'Weekly pay',deaths:'Business failure',fdi:'Foreign investment'};
export const normaliseArea=name=>String(name).toLowerCase().replace(/[^a-z0-9]/g,'').replace(/lpa|cityof/g,'');
export function forecastSeries(data,features,ranges) {
  const rows=new Map(data.areas.map((a,i)=>[normaliseArea(a.name),i]));
  const years=data.years.filter(y=>y>=data.projected_from);
  return Object.fromEntries(['income','density','employment'].map(variable=>[variable,{
    range:ranges[variable],simulated:true,
    frames:years.map(year=>({year:String(year),simulated:true,observations:Object.fromEntries(features.flatMap(feature=>{
      const index=rows.get(normaliseArea(feature.properties.authority_name));
      const value=index===undefined?null:data.values[variable][index][data.years.indexOf(year)];
      return Number.isFinite(value)?[[feature.properties.authority_code,value]]:[];
    }))})),
  }]));
}

export class Forecast {
  constructor({mount,features,onChange,onSelect,onOverlayChange}) {
    Object.assign(this,{features,onChange,onSelect,onOverlayChange});
    this.enabled=false;this.inputs={shocks:{},area_shocks:{},rate_bias:0};this.overlays=new Set();this.sequence=0;
    this.names=new Map(features.map(f=>[normaliseArea(f.properties.authority_name),f.properties.authority_code]));
    mount.innerHTML=`<section class="simulation" aria-label="Economic simulation">
      <div class="simulation-heading"><h2>WHAT IF?</h2><button id="simulation-toggle" aria-pressed="false">Enable simulation</button></div>
      <p id="simulation-status" role="status">Explore possible futures, 2026–2035.</p>
      <div id="simulation-controls" hidden>
        <p class="simulation-warning">Exploratory model · England only · not a prediction</p>
        <label class="simulation-area">Edit <select id="simulation-scope"><option value="">All modelled areas</option></select></label>
        <div class="simulation-sliders">${Object.entries(VARIABLES).map(([v,label])=>`<label>${label}<output data-output="${v}">0</output><input aria-label="${label} growth shock" data-shock="${v}" type="range" min="-3" max="3" step="0.25" value="0"></label>`).join('')}</div>
        <label class="simulation-rate">Rate stance <output id="rate-output">0</output><input id="rate-bias" aria-label="Rate stance" type="range" min="-1" max="1" step="0.1" value="0"></label>
        <p class="simulation-help">Growth shocks use standard deviations (−3 to +3), fading each year. Foreign investment applies to the whole region; rate stance is national.</p>
        <button id="simulation-apply">Apply edits</button> <button id="simulation-reset">Reset all edits</button>
        <details><summary>Model and coverage</summary><p id="simulation-model"></p><p id="simulation-coverage"></p></details>
      </div>
      <div class="simulation-overlays" role="group" aria-label="Simulation overlays">
        <button data-forecast-overlay="weeklypay" aria-pressed="false">Weekly pay</button><button data-forecast-overlay="fdi" aria-pressed="false">Foreign investment</button><button data-forecast-overlay="rate" aria-pressed="false">Rate signal</button>
      </div>
    </section>`;
    this.mount=mount;this.toggle=mount.querySelector('#simulation-toggle');this.scope=mount.querySelector('#simulation-scope');
    this.status=mount.querySelector('#simulation-status');
    this.toggle.addEventListener('click',()=>this.setEnabled(!this.enabled).catch(()=>{}));
    this.scope.addEventListener('change',()=>{this.syncSliders();if(this.scope.value)this.onSelect(this.scope.value);});
    mount.addEventListener('input',event=>{
      const variable=event.target.dataset.shock;
      if(variable){const edits=this.scope.value?(this.inputs.area_shocks[this.scope.value]??={}):this.inputs.shocks;edits[variable]=Number(event.target.value);}
      else if(event.target.id==='rate-bias')this.inputs.rate_bias=Number(event.target.value);else return;
      this.syncSliders();this.schedule();
    });
    mount.querySelector('#simulation-reset').addEventListener('click',()=>this.reset().catch(()=>{}));
    mount.querySelector('#simulation-apply').addEventListener('click',()=>this.reload().catch(()=>{}));
    for(const button of mount.querySelectorAll('[data-forecast-overlay]'))button.addEventListener('click',()=>this.setOverlay(button.dataset.forecastOverlay,!this.overlays.has(button.dataset.forecastOverlay)).catch(()=>{}));
    this.canvas=document.createElement('canvas');this.canvas.className='forecast-weather';this.canvas.setAttribute('aria-hidden','true');document.querySelector('.map-panel').append(this.canvas);
    const key=document.createElement('div');key.id='forecast-key';key.className='map-key compact-key';key.hidden=true;document.querySelector('.legend-stack').append(key);this.key=key;
    this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  }

  setStatus(text){this.status.textContent=text;}
  syncSliders() {
    const edits=this.scope.value?this.inputs.area_shocks[this.scope.value]||{}:this.inputs.shocks;
    for(const slider of this.mount.querySelectorAll('[data-shock]')){const value=edits[slider.dataset.shock]||0;slider.value=value;this.mount.querySelector(`[data-output="${slider.dataset.shock}"]`).textContent=(value>0?'+':'')+value;}
    this.mount.querySelector('#rate-bias').value=this.inputs.rate_bias;this.mount.querySelector('#rate-output').textContent=this.inputs.rate_bias;
  }
  schedule(){clearTimeout(this.timer);this.setStatus('Edits pending…');this.timer=setTimeout(()=>this.reload().catch(()=>{}),250);}
  async load(inputs) {
    const q=new URLSearchParams();
    for(const [v,x] of Object.entries(inputs.shocks))if(x)q.set('shock_'+v,x);
    if(inputs.rate_bias)q.set('rate_bias',inputs.rate_bias);
    if(Object.keys(inputs.area_shocks).length)q.set('area_shocks',JSON.stringify(inputs.area_shocks));
    const response=await fetch('/api/forecast?'+q,{signal:this.abort.signal});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Simulation unavailable');return data;
  }
  async reload() {
    clearTimeout(this.timer);const sequence=++this.sequence;this.abort?.abort();this.abort=new AbortController();
    this.setStatus('Fitting and updating simulation…');this.mount.setAttribute('aria-busy','true');
    const inputs=structuredClone(this.inputs);
    try {
      const data=await this.load(inputs);if(sequence!==this.sequence)return;
      this.data=data;this.appliedInputs=structuredClone(data.inputs);this.index=new Map(data.areas.map((a,i)=>[normaliseArea(a.name),i]));
      this.byCode=new Map(data.areas.map((a,i)=>[this.names.get(normaliseArea(a.name)),i]).filter(([code])=>code));
      const selected=this.scope.value;
      this.scope.replaceChildren(new Option('All modelled areas',''),...data.areas.filter(a=>this.names.has(normaliseArea(a.name))).map(a=>new Option(a.name,a.code)).sort((a,b)=>a.text.localeCompare(b.text)));this.scope.value=selected;
      this.mount.querySelector('#simulation-model').textContent=data.model_note;
      this.mount.querySelector('#simulation-coverage').textContent=data.coverage;
      if(this.enabled)await this.onChange(data);
      this.setStatus('Simulation ready · '+data.areas.length+' authorities');
    } catch(error){if(error.name!=='AbortError'){this.setStatus(error.message);throw error;}}
    finally{if(sequence===this.sequence)this.mount.setAttribute('aria-busy','false');}
  }
  async setEnabled(enabled) {
    this.enabled=enabled;this.toggle.textContent=enabled?'Return to recorded data':'Enable simulation';this.toggle.setAttribute('aria-pressed',String(enabled));
    this.mount.querySelector('#simulation-controls').hidden=!enabled;
    if(!enabled){++this.sequence;this.abort?.abort();clearTimeout(this.timer);this.mount.setAttribute('aria-busy','false');this.overlays.clear();this.syncOverlays();await this.onChange(null);this.setStatus('Recorded data · simulation off');return;}
    try{if(!this.data||JSON.stringify(this.inputs)!==JSON.stringify(this.appliedInputs))await this.reload();else await this.onChange(this.data);}
    catch(error){if(this.enabled)await this.setEnabled(false);this.setStatus(error.message);throw error;}
  }
  async edit(variable,value,localCode=null) {
    if(!(variable in VARIABLES) || !Number.isFinite(value) || Math.abs(value)>3)throw new Error('Use a growth shock between −3 and +3.');
    if(!this.data)await this.reload();
    if(localCode){const index=this.byCode.get(localCode);if(index===undefined)throw new Error('This area has insufficient simulation data.');const code=this.data.areas[index].code;(this.inputs.area_shocks[code]??={})[variable]=value;this.scope.value=code;}
    else this.inputs.shocks[variable]=value;
    if(!this.enabled)await this.setEnabled(true);this.syncSliders();await this.reload();
  }
  async reset(){this.inputs={shocks:{},area_shocks:{},rate_bias:0};this.syncSliders();if(this.enabled)await this.reload();}
  select(localCode){const index=this.byCode?.get(localCode);this.scope.value=index===undefined?'':this.data.areas[index].code;this.syncSliders();}
  value(variable,localCode,year=this.year) {
    if(!this.enabled || !this.data)return null;
    const i=this.byCode.get(localCode),yi=this.data.years.indexOf(Number(year));if(i===undefined || yi<0)return null;
    if(variable==='fdi')return this.data.regions.find(r=>r.code===this.data.areas[i].region)?.fdi[yi]??null;
    return this.data.values[variable]?.[i]?.[yi]??null;
  }
  async setOverlay(variable,enabled) {
    if(!['weeklypay','fdi','rate'].includes(variable))throw new Error('Unknown simulation overlay.');
    if(enabled&&!this.enabled)await this.setEnabled(true);
    enabled?this.overlays.add(variable):this.overlays.delete(variable);this.syncOverlays();this.onOverlayChange();
  }
  syncOverlays(){for(const b of this.mount.querySelectorAll('[data-forecast-overlay]'))b.setAttribute('aria-pressed',String(this.overlays.has(b.dataset.forecastOverlay)));this.updateKey();}
  updateKey(){
    const parts=[];if(this.overlays.has('weeklypay'))parts.push('Weekly pay · blue rain · heavier = higher £/week');if(this.overlays.has('fdi'))parts.push('Foreign investment · regional arrows · longer = higher £m');
    if(this.overlays.has('rate')){const rate=this.data?.rate[this.data.years.indexOf(Number(this.year))];parts.push('Rate signal · '+(Number.isFinite(rate)?rate.toFixed(2):'unavailable')+' · model units');}
    this.key.hidden=!parts.length;this.key.replaceChildren(...parts.map(text=>{const p=document.createElement('span');p.textContent=text;return p;}));
  }
  frame(year){this.year=year;this.updateKey();this.redraw();}
  redraw(){if(!this.raf)this.raf=requestAnimationFrame(time=>{this.raf=null;this.draw(time);});}
  draw(time) {
    const {canvas}=this,view=this.getView?.();if(!view)return;
    const ratio=Math.min(2,devicePixelRatio||1);if(canvas.width!==Math.round(view.width*ratio))canvas.width=Math.round(view.width*ratio);if(canvas.height!==Math.round(view.height*ratio))canvas.height=Math.round(view.height*ratio);
    const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,view.width,view.height);
    if(!this.enabled || document.hidden)return;
    const phase=this.reducedMotion.matches?0:time/800;
    const norm=(v,value)=>{const [lo,hi]=this.data.variables[v].range;return Math.max(0,Math.min(1,(value-lo)/(hi-lo)));};
    if(this.overlays.has('weeklypay')) {
      ctx.strokeStyle='rgba(115,191,255,.65)';ctx.lineWidth=1;ctx.beginPath();
      for(const [code] of this.byCode){const value=this.value('weeklypay',code),p=this.areaPosition?.(code);if(!p||!Number.isFinite(value))continue;const n=norm('weeklypay',value);
        for(let j=0;j<2+Math.floor(n*5);j++){const x=p.x+((j*17)%37)-18,y=p.y+((j*13+phase*22)%44)-22;ctx.moveTo(x,y);ctx.lineTo(x+2,y+4+n*6);}}
      ctx.stroke();
    }
    if(this.overlays.has('fdi'))for(const region of this.data.regions){const value=region.fdi[this.data.years.indexOf(Number(this.year))],p=this.project?.(region.lon,region.lat);if(!p||!Number.isFinite(value))continue;const len=15+norm('fdi',value)*50;ctx.strokeStyle='#65e4da';ctx.lineWidth=2;ctx.setLineDash([7,4]);ctx.lineDashOffset=-phase*8;ctx.beginPath();ctx.moveTo(p.x-len/2,p.y+len/4);ctx.lineTo(p.x+len/2,p.y-len/4);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(p.x+len/2-9,p.y-len/4);ctx.lineTo(p.x+len/2,p.y-len/4);ctx.lineTo(p.x+len/2-4,p.y-len/4+8);ctx.stroke();}
    if(!this.reducedMotion.matches&&(this.overlays.has('weeklypay')||this.overlays.has('fdi')))this.redraw();
  }
}
