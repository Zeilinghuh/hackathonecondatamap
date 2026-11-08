export class ChatDrag {
  constructor(chat,panel,onMove) {
    Object.assign(this,{chat,panel,onMove});
    const header=chat.querySelector(".capri-header");
    header.tabIndex=0;header.title="Drag to move · Arrow keys when focused";
    header.setAttribute("aria-label","Move Capri chat. Drag or use arrow keys.");
    header.addEventListener("pointerdown",event=>{
      if(event.button!==0 || event.target.closest("button"))return;
      const rect=chat.getBoundingClientRect(),parent=panel.getBoundingClientRect();
      this.drag={x:event.clientX,y:event.clientY,left:rect.left-parent.left,top:rect.top-parent.top};
      header.setPointerCapture(event.pointerId);event.preventDefault();
    });
    header.addEventListener("pointermove",event=>{if(this.drag)this.move(this.drag.left+event.clientX-this.drag.x,this.drag.top+event.clientY-this.drag.y);});
    const end=()=>{this.drag=null;};
    for(const type of ["pointerup","pointercancel","lostpointercapture"])header.addEventListener(type,end);
    header.addEventListener("keydown",event=>{
      if(event.target!==header)return;
      const d={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[event.key];
      if(d){event.preventDefault();event.stopPropagation();const r=chat.getBoundingClientRect(),p=panel.getBoundingClientRect();this.move(r.left-p.left+d[0],r.top-p.top+d[1]);}
    });
  }
  move(x,y) {
    this.position={x:Math.max(8,Math.min(this.panel.clientWidth-this.chat.offsetWidth-8,x)),y:Math.max(8,Math.min(this.panel.clientHeight-this.chat.offsetHeight-8,y))};
    Object.assign(this.chat.style,{left:this.position.x+"px",top:this.position.y+"px",right:"auto",bottom:"auto"});this.onMove();
  }
  resize() {if(this.position && !this.chat.hidden)this.move(this.position.x,this.position.y);}
}
