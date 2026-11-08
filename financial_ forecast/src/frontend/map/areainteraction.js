// Picking and a small highlight state; frames only run while a glow is active.
export class AreaInteraction {
  // getSurface(): "income" | "density" | null. Raised surfaces disable hover, like the terrain.
  constructor({canvas,index,renderer,getView,getMode,getSurface,isDragging,onChange,onSelect,describe=properties=>properties.authority_name}) {
    Object.assign(this,{canvas,index,renderer,getView,getMode,getSurface,isDragging,onChange,onSelect,describe});
    this.reducedMotion=matchMedia("(prefers-reduced-motion: reduce)");
    this.fading=[];
    this.label=document.querySelector("#hover-label");
    canvas.addEventListener("pointermove",event=>{
      const rect=canvas.getBoundingClientRect();
      this.point={x:event.clientX-rect.left,y:event.clientY-rect.top}; this.invalidate();
    });
    canvas.addEventListener("pointerleave",()=>{this.point=null;this.invalidate();});
    canvas.addEventListener("pointerdown",()=>this.invalidate());
    canvas.addEventListener("pointerup",()=>this.invalidate());
    canvas.addEventListener("pointercancel",()=>{this.point=null;this.invalidate();});
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)this.onChange();});
  }

  invalidate() { this.dirty=true; this.onChange(); }

  position(point,surface) {
    return this.renderer.pick(point,this.getView(),surface,p=>this.index.find(p),this.getMode());
  }

  refresh(now) {
    if(!this.dirty)return;
    this.dirty=false;
    if(this.getSurface() || this.isDragging()) {
      this.hover=null; this.fading=[]; this.updateLabel(); return;
    }
    const position=this.point && this.position(this.point,null);
    const area=position && this.index.find(position);
    // Same area: the layer may have changed, so keep the label text current.
    if(area?.index===this.hover?.area.index || (!area&&!this.hover)){this.updateLabel();return;}
    if(this.hover && !this.reducedMotion.matches) {
      this.fading.push({area:this.hover.area,opacity:this.opacity(now),leftAt:now});
      if(this.fading.length>4)this.fading.shift();
    }
    this.hover=area?{area,entered:now}:null;
    this.updateLabel();
  }

  updateLabel() {
    const area=this.hover?.area;
    this.canvas.classList.toggle("is-over-area",!!area);
    this.canvas.dataset.hoveredArea=area?.feature.properties.authority_code || "";
    this.label.hidden=!area;
    const text=area?this.describe(area.feature.properties)+" · Click to select":"";
    if(this.label.textContent!==text)this.label.textContent=text;
  }

  opacity(now) {
    if(this.reducedMotion.matches)return 1;
    return Math.min(1,(now-this.hover.entered)/160)*(.77+.23*Math.sin((now-this.hover.entered)/300));
  }

  highlights(now) {
    this.refresh(now);
    const active=new Map();
    const add=(area,opacity)=>{
      if(opacity>(active.get(area.index)?.opacity || 0))active.set(area.index,{area,opacity});
    };
    if(this.selected)add(this.selected,.55);
    this.fading=this.fading.filter(item=>now-item.leftAt<220);
    for(const item of this.fading)add(item.area,item.opacity*(1-(now-item.leftAt)/220));
    if(this.hover)add(this.hover.area,this.opacity(now));
    return [...active.values()];
  }

  get animating() { return !this.getSurface() && ((this.hover&&!this.reducedMotion.matches)||this.fading.length>0); }

  select(point) {
    const position=this.position(point,this.getSurface());
    const area=position && this.index.find(position);
    if(!area)return;
    this.selected=area; this.onSelect(area,position); this.onChange();
  }
}
