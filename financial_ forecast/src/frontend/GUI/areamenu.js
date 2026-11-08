// Map actions stay local until the user asks Capri for an explanation.
export class AreaMenu {
  constructor({canvas,panel,capri,pick,select,getYear,pause}) {
    Object.assign(this,{canvas,panel,capri,pick,select,getYear,pause});
    panel.insertAdjacentHTML("beforeend",`<section class="area-menu" aria-label="Area actions" hidden><strong></strong><div role="menu"><button role="menuitem" data-action="ask">Ask Capri</button><button role="menuitem" data-action="explain">Explain this area</button><button role="menuitem" data-action="compare">Compare with another area</button><button role="menuitem" disabled>Spawn 100 clouds · Coming later</button></div></section>`);
    this.element=panel.querySelector(".area-menu");
    canvas.addEventListener("contextmenu",event=>{event.preventDefault();const r=canvas.getBoundingClientRect();this.open({x:event.clientX-r.left,y:event.clientY-r.top});});
    canvas.addEventListener("keydown",event=>{if(event.key==="ContextMenu" || (event.shiftKey && event.key==="F10")){event.preventDefault();this.open({x:canvas.clientWidth/2,y:canvas.clientHeight/2});}});
    document.addEventListener("pointerdown",event=>{if(!this.element.contains(event.target))this.close();});
    document.addEventListener("keydown",event=>{if(event.key==="Escape"){const visible=!this.element.hidden;this.reset();if(visible)canvas.focus({preventScroll:true});}});
    this.element.addEventListener("keydown",event=>{
      const buttons=[...this.element.querySelectorAll("button:not(:disabled)")];
      if(event.key==="ArrowDown" || event.key==="ArrowUp"){event.preventDefault();buttons[(buttons.indexOf(document.activeElement)+(event.key==="ArrowDown"?1:buttons.length-1))%buttons.length].focus();}
      if(event.key==="Tab")this.close();
    });
    this.element.addEventListener("click",event=>{
      const action=event.target.dataset.action;if(!action)return;
      const {area,point}=this.current,properties={...area.feature.properties},year=getYear();
      this.close();this.comparing=null;
      if(action==="compare") {
        this.comparing={properties,year};
        capri.speakAt(point,`Pick another area to compare with ${properties.authority_name}. Escape cancels.`);
      } else if(action==="explain")capri.explainArea(properties);
      else capri.speakAt(point,`${properties.authority_name}${year?" · "+year:""}. What would you like to explore?`,()=>capri.setOpen(true));
    });
    panel.addEventListener("wheel",()=>this.close(),{passive:true});
    new ResizeObserver(()=>this.close()).observe(panel);
  }
  open(point) {
    this.close();const hit=this.pick(point);if(!hit)return;
    this.pause();this.select(hit.area,hit.position);this.current={area:hit.area,point};
    this.element.querySelector("strong").textContent=hit.area.feature.properties.authority_name;
    this.element.hidden=false;
    this.element.style.left=Math.max(8,Math.min(point.x,this.panel.clientWidth-this.element.offsetWidth-8))+"px";
    this.element.style.top=Math.max(8,Math.min(point.y,this.panel.clientHeight-this.element.offsetHeight-8))+"px";
    this.element.querySelector("button").focus({preventScroll:true});
  }
  selected(area) {
    if(!this.comparing)return;
    const {properties:first,year}=this.comparing,second=area.feature.properties;
    if(first.authority_code===second.authority_code)return;
    this.comparing=null;
    const valid=first.income_per_head!=null && second.income_per_head!=null;
    const difference=valid?`${second.authority_name}'s income per head is £${Math.round(Math.abs(second.income_per_head-first.income_per_head)).toLocaleString("en-GB")} ${second.income_per_head>=first.income_per_head?"higher":"lower"} than ${first.authority_name}'s.`:"Income data is missing for one of these areas.";
    this.capri.speakAt(this.current.point,`${year?year+" · ":""}${difference}`);
  }
  close() { this.element.hidden=true; }
  reset() { this.close();this.comparing=null;this.capri.dismissBubble(); }
}
