// Download/cache history once; slider changes reuse local observations/grids.
export class Timeline {
  constructor(getSurface,onFrame,extraData={}) {
    this.getSurface=getSurface;this.onFrame=onFrame;this.positions={};
    this.slider=document.querySelector("#year-slider");this.play=document.querySelector("#year-play");
    this.data=extraData;this.loading=true;
    this.slider.addEventListener("input",()=>{this.pause();this.queue(Number(this.slider.value));});
    this.slider.addEventListener("wheel",event=>{event.preventDefault();this.pause();this.queue(Number(this.slider.value)+Math.sign(event.deltaY));},{passive:false});
    document.addEventListener("visibilitychange",()=>{if(document.hidden)this.pause();});
    this.play.addEventListener("click",()=>{if(this.timer){this.pause();return;}if(Number(this.slider.value)===Number(this.slider.max))this.show(0);this.run();});
    this.load();
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
  useSurface() {
    if(this.queued){cancelAnimationFrame(this.queued);this.queued=null;}
    this.pause();this.active=null;const name=this.getSurface(),series=this.data?.[name];
    this.slider.disabled=this.play.disabled=!series;
    if(!series?.frames.length){this.slider.disabled=this.play.disabled=true;document.querySelector("#year-note").textContent=this.loading?"Loading historical years…":"Choose GDP per capita, Density or Vegetation to explore years.";return;}
    this.slider.min=0;this.slider.max=series.frames.length-1;
    document.querySelector("#year-oldest").textContent=series.frames[0].year;
    document.querySelector("#year-newest").textContent=series.frames.at(-1).year;
    document.querySelector("#year-note").textContent=name==="income"?"Recorded income · not inflation-adjusted · fixed boundaries":name==="employment"?"ONS / NISRA · ages 16–64 · Northern Ireland available for 2023 only.":"Residents per km² · fixed boundaries";
    this.show(this.positions[name]??series.frames.length-1);
  }
  show(index) {
    const name=this.getSurface(),series=this.data?.[name];if(!series)return;
    index=Math.max(0,Math.min(series.frames.length-1,index));
    if(this.active===name+":"+index)return;
    this.active=name+":"+index;
    this.positions[name]=index;this.slider.value=index;
    const frame=series.frames[index];this.year=frame.year;
    document.querySelector("#year-label").textContent=frame.year;this.slider.setAttribute("aria-valuetext",frame.year);
    this.onFrame(name,frame,series);
  }
  queue(index) {this.pending=index;if(this.queued)return;this.queued=requestAnimationFrame(()=>{this.queued=null;this.show(this.pending);});}
  run() {
    this.play.textContent="Pause";this.play.setAttribute("aria-pressed","true");
    this.timer=setTimeout(()=>{if(Number(this.slider.value)>=Number(this.slider.max)){this.pause();return;}this.show(Number(this.slider.value)+1);this.run();},750);
  }
  pause() {clearTimeout(this.timer);this.timer=null;this.play.textContent="Play";this.play.setAttribute("aria-pressed","false");}
}
