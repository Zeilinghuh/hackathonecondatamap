// Idle play and reactions stay local; neither invokes chat nor redraws the map.
export class OrbPlay {
  constructor(companion) {
    this.c=companion;this.next=performance.now()+12000;
  }
  endIdle() {this.peekUntil=0;this.mischief=false;this.c.widget.classList.remove("is-peeking");this.c.roamTarget=null;this.next=performance.now()+12000+Math.random()*10000;}
  react(mood) {
    this.endIdle();this.mood=mood;this.until=performance.now()+4200;
    this.c.widget.dataset.mood=mood;
    this.c.button.querySelector(".capri-name").textContent=mood==="angry"?"SERIOUSLY?":"DIZZY";
    this.c.button.title=mood==="angry"?"Excellent. I'm a pinball now.":"The map was already spinning. Thanks.";
  }
  update(time) {
    const c=this.c;
    if(this.until && time>this.until){this.until=0;delete c.widget.dataset.mood;c.button.querySelector(".capri-name").textContent="CAPRI";c.button.title="Click to chat · Drag and release to fling";}
    const occupied=c.open || c.busy || c.dragging || c.approach || !c.speech.hidden || c.flying || c.hovered || c.focused || document.activeElement?.matches("input,textarea");
    if(occupied || this.until || c.reducedMotion.matches) {
      if(this.peekUntil)this.endIdle();return;
    }
    if(this.peekUntil) {
      if(time>this.peekUntil){this.endIdle();c.roamAt=time+1000;return;}
      const pointer=c.lastPointer,rect=c.mapPanel.getBoundingClientRect();
      if(pointer)c.sprite.style.setProperty("--peek-look",Math.max(-5,Math.min(5,(pointer.x-rect.left-c.x-38)/60))+"px");
    } else if(time>this.next) {
      this.peekUntil=time+4200;c.widget.classList.add("is-peeking");
      if(Math.random()<.16 && c.lastPointer) {
        const r=c.mapPanel.getBoundingClientRect();
        c.roamTarget={x:Math.max(12,Math.min(r.width-100,c.lastPointer.x-r.left+8)),y:Math.max(110,Math.min(r.height-100,c.lastPointer.y-r.top+8))};
        c.roamAt=time;this.mischief=true;
      } else this.mischief=false;
    }
  }
}
