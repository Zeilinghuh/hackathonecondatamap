// Download/cache history once; slider changes reuse local observations/grids.
export class Timeline {
  constructor(getSurface,onFrame,extraData={},onPause=()=>{}) {
    this.onPause=onPause;
    this.getSurface=getSurface;this.onFrame=onFrame;this.positions={};
    this.slider=document.querySelector("#year-slider");this.play=document.querySelector("#year-play");
    this.data=extraData;this.loading=true;
    this.slider.addEventListener("input",()=>{this.pause(false);this.queue(Number(this.slider.value));});
    this.slider.addEventListener("wheel",event=>{event.preventDefault();this.pause(false);this.queue(Number(this.slider.value)+Math.sign(event.deltaY));},{passive:false});
    document.addEventListener("visibilitychange",()=>{if(document.hidden)this.pause();});
    this.play.addEventListener("click",()=>{if(this.timer){this.pause();return;}if(Number(this.slider.value)===Number(this.slider.max))this.show(0);this.run();});
    this.ready=this.load();
  }
  async load() {
    try {
      const response=await fetch("/api/history");if(!response.ok)throw new Error("Could not load historical data");
      this.data={...this.data,...await response.json()};this.loading=false;
      // Employment is supplied with the initial terrain response; finishing a
      // separate terrain-history download must not interrupt its playback.
      if(this.getSurface()!=="employment")this.useSurface();
    }catch(error){this.loading=false;if(this.getSurface()!=="employment"){this.useSurface();document.querySelector("#year-note").textContent=error.message;}}
  }
  useSurface(animate=false) {
    if(this.queued){clearTimeout(this.queued);this.queued=null;}
    this.pause(!animate);this.active=null;const name=this.getSurface(),series=this.series(name);
    this.slider.disabled=this.play.disabled=!series;
    if(!series?.frames.length){this.slider.disabled=this.play.disabled=true;document.querySelector("#year-note").textContent=this.loading?"Loading historical years…":"Choose Income per head, Population density or Employment rate to explore years.";return;}
    this.slider.min=0;this.slider.max=series.frames.length-1;
    document.querySelector("#year-oldest").textContent=series.frames[0].year;
    document.querySelector("#year-newest").textContent=series.frames.at(-1).year;
    document.querySelector("#year-note").textContent=this.simulation?"SIMULATED · 2026–2035 · latest available inputs · UK model estimates":name==="income"?"Recorded income · not inflation-adjusted · fixed boundaries":name==="employment"?"ONS / NISRA · ages 16–64 · Northern Ireland available for 2023 only.":"Residents per km² · fixed boundaries";
    this.show(this.positions[this.key(name)]??(this.simulation?0:series.frames.length-1),animate);
  }
  series(name=this.getSurface()){return (this.simulation||this.data)?.[name];}
  key(name){return (this.simulation?'simulation:':'recorded:')+name;}
  setSimulation(data){const animate=!!this.active;this.simulation=data;this.useSurface(animate);}
  async setYear(year){await this.ready;const series=this.series(),index=series?.frames.findIndex(f=>Number(f.year)===Number(year));if(index===undefined||index<0)throw new Error('No '+(this.simulation?'simulated':'recorded')+' '+this.getSurface()+' data for '+year+'.');this.pause(false);clearTimeout(this.queued);this.queued=null;this.show(index,true);}
  show(index,animate=false) {
    const name=this.getSurface(),series=this.series(name);if(!series)return;
    index=Math.max(0,Math.min(series.frames.length-1,index));
    if(this.active===name+":"+index)return;
    this.active=name+":"+index;
    this.positions[this.key(name)]=index;this.slider.value=index;
    const frame=series.frames[index];this.year=frame.year;
    document.querySelector("#year-label").textContent=frame.year+(this.simulation?' · SIM':'');this.slider.setAttribute("aria-valuetext",frame.year+(this.simulation?' simulated':''));
    this.onFrame(name,frame,series,animate && !matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  queue(index) {this.pending=index;if(this.queued)return;this.queued=setTimeout(()=>{this.queued=null;this.show(this.pending,true);},80);}
  run() {
    this.play.textContent="Pause";this.play.setAttribute("aria-pressed","true");
    this.timer=setTimeout(()=>{if(Number(this.slider.value)>=Number(this.slider.max)){this.pause();return;}this.show(Number(this.slider.value)+1,true);this.run();},650);
  }
  pause(settle=true) {clearTimeout(this.timer);this.timer=null;if(settle)this.onPause();this.play.textContent="Play";this.play.setAttribute("aria-pressed","false");}
}
