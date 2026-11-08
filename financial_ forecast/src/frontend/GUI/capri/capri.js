// The companion is a local animated UI. Only submitting chat calls the AI.
import {VoiceInput} from "./voice.js";
import {sfx} from "../terraincontrols.js";
const FRAMES={orb:[0,1,2,3],idle:[0,0,0,3],talking:[1,2,1,0]};
export class CapriCompanion {
  constructor(mapPanel) {
    this.mapPanel = mapPanel;
    this.open = false;
    this.busy = false;
    this.history = [];
    this.selectedAuthority = null;
    this.x = 0;
    this.y = 0;
    this.vx = this.vy = 0;
    this.lastTime = 0;
    this.hovered = false;
    this.dragging = false;
    this.dragged = false;
    this.talking = false;
    this.roamAt = performance.now() + 6000;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    mapPanel.insertAdjacentHTML("beforeend", `
      <div id="capri-widget" class="capri-widget">
        <button id="capri-companion" class="capri-button" aria-label="Talk to Capri" aria-controls="capri-chat" aria-expanded="false" title="Click to chat · Drag to move">
          <span class="capri-sprite" aria-hidden="true"></span><span class="capri-name">CAPRI</span>
        </button>
      </div>
      <section id="capri-chat" class="capri-chat" aria-label="Chat with Capri" hidden>
        <header class="capri-header"><div><strong>CAPRI // Support</strong><span id="capri-status" class="capri-status" role="status">Checking link…</span></div><button class="capri-close" aria-label="Close Capri chat">×</button></header>
        <div id="capri-messages" class="capri-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
        <p id="capri-context" class="capri-context">Context: UK household income</p>
        <form class="capri-form"><textarea id="capri-input" class="capri-input" aria-label="Message Capri" placeholder="Hey Capri…" rows="2" maxlength="2000" required></textarea><button class="capri-send" type="submit">SEND</button></form>
      </section>`);
    this.widget = mapPanel.querySelector("#capri-widget");
    this.button = mapPanel.querySelector("#capri-companion");
    this.sprite = this.button.querySelector(".capri-sprite");
    this.chat = mapPanel.querySelector("#capri-chat");
    this.messages = mapPanel.querySelector("#capri-messages");
    this.input = mapPanel.querySelector("#capri-input");
    this.sendButton = this.chat.querySelector(".capri-send");
    this.status = this.chat.querySelector("#capri-status");
    this.chatDrag=new ChatDrag(this.chat,mapPanel,()=>this.place());
    this.voice=new VoiceInput(mapPanel,{
      isBusy:()=>this.busy,
      onQuestion:question=>{this.setOpen(true,false);this.send(question);},
    });
    this.play=new OrbPlay(this);
    mapPanel.insertAdjacentHTML("beforeend",`<section class="capri-bubble" aria-label="Capri says" hidden><p role="status"></p><div><button class="bubble-talk">Talk to Capri</button><button class="bubble-close" aria-label="Dismiss Capri message">×</button></div></section>`);
    this.speech=mapPanel.querySelector(".capri-bubble");
    this.speech.querySelector(".bubble-close").addEventListener("click",()=>this.dismissBubble());
    this.speech.querySelector(".bubble-talk").addEventListener("click",()=>{const action=this.speechAction;this.dismissBubble();if(action)action();else this.setOpen(true);});
    this.appendMessage("assistant", "Hey, I'm Capri. Try ‘find Barnet in 2019’, ‘show employment in 3D’ or ask me to edit a simulation. Hold Speak to Capri to talk.");
    this.button.addEventListener("click", () => {
      if (this.dragged) { this.dragged = false; return; }
      this.setOpen(!this.open);
    });
    this.chat.querySelector(".capri-close").addEventListener("click", () => this.setOpen(false));
    this.chat.querySelector("form").addEventListener("submit", event => { event.preventDefault(); this.send(); });
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.send(); }
    });
    this.button.addEventListener("pointerenter", () => { this.hovered = true; });
    this.button.addEventListener("pointerleave", () => { this.hovered = false; });
    this.button.addEventListener("focus", () => { this.focused = this.button.matches(":focus-visible"); });
    this.button.addEventListener("blur", () => { this.focused = false; });
    this.button.addEventListener("pointerdown", event => {
      if (event.button !== 0 || this.open) return;
      this.dismissBubble();
      this.play.endIdle();this.flying=false;
      this.dragged = false;
      this.dragging = true;
      this.vx = this.vy = 0;
      this.dragStart = { x:event.clientX, y:event.clientY, baseX:this.x, baseY:this.y };
      this.dragSample={x:event.clientX,y:event.clientY,time:performance.now()};
      this.button.setPointerCapture(event.pointerId);
    });
    this.button.addEventListener("pointermove", event => {
      if (!this.dragging) return;
      const dx = event.clientX - this.dragStart.x, dy = event.clientY - this.dragStart.y;
      if (Math.hypot(dx, dy) > 5) this.dragged = true;
      this.x = this.dragStart.baseX + dx;
      this.y = this.dragStart.baseY + dy;
      const now=performance.now(),sample=this.dragSample,dt=Math.max(8,now-sample.time)/1000;
      this.vx=Math.max(-1800,Math.min(1800,.35*this.vx+.65*(event.clientX-sample.x)/dt));
      this.vy=Math.max(-1800,Math.min(1800,.35*this.vy+.65*(event.clientY-sample.y)/dt));
      this.dragSample={x:event.clientX,y:event.clientY,time:now};
      this.clampPosition();
    });
    const release = event => {
      if(!this.dragging)return;
      this.dragging = false;
      if(event.type!=="pointerup" || performance.now()-this.dragSample.time>120 || this.reducedMotion.matches)this.vx=this.vy=0;
      this.flying=this.dragged && Math.hypot(this.vx,this.vy)>80;
      if(this.flying) {
        const now=performance.now();this.play.react(this.lastFling && now-this.lastFling<8000?"angry":"dizzy");this.lastFling=now;
        this.button.blur();
      }
      if (this.dragged) { this.roamTarget = null; this.roamAt = performance.now() + 15000; }
    };
    this.button.addEventListener("pointerup", release);
    this.button.addEventListener("pointercancel", release);
    this.button.addEventListener("lostpointercapture", release);
    this.button.addEventListener("keydown", event => {
      const shift = {ArrowLeft:[-15,0],ArrowRight:[15,0],ArrowUp:[0,-15],ArrowDown:[0,15]}[event.key];
      if (shift && !this.open) {
        event.preventDefault(); event.stopPropagation();
        this.x += shift[0]; this.y += shift[1]; this.clampPosition();
      }
    });
    mapPanel.addEventListener("pointermove", event => this.nudge(event));
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.open) { event.stopPropagation(); this.setOpen(false); }
    });
    document.addEventListener("terrain:selection", event => {
      this.selectedAuthority = event.detail.authorityCode;
      this.selectedYear = event.detail.year;
      this.chat.querySelector("#capri-context").textContent = `Context: ${event.detail.authorityName}`;
    });
    new ResizeObserver(() => {this.chatDrag.resize();this.place();}).observe(mapPanel);
    this.place(true);
    this.checkLink();
    this.tick=time=>this.animate(time);
    document.addEventListener("visibilitychange",()=>{
      cancelAnimationFrame(this.animationFrame);this.lastTime=0;
      if(!document.hidden)this.animationFrame=requestAnimationFrame(this.tick);
    });
    this.animationFrame=requestAnimationFrame(this.tick);
  }

  clampPosition() {
    const width = this.open ? (this.compact?72:180) : 76, height = this.open ? (this.compact?86:216) : 84;
    if(this.flying && !this.dragging) {
      const hit=this.x<12 || this.x>this.mapPanel.clientWidth-width-12 || this.y<95 || this.y>this.mapPanel.clientHeight-height-12;
      if(hit)sfx.bounce(Math.hypot(this.vx,this.vy));
      if(this.x<12 || this.x>this.mapPanel.clientWidth-width-12)this.vx*=-.8;
      if(this.y<95 || this.y>this.mapPanel.clientHeight-height-12)this.vy*=-.8;
    }
    this.x = Math.max(12, Math.min(this.mapPanel.clientWidth - width - 12, this.x));
    this.y = Math.max(this.open?8:95, Math.min(this.mapPanel.clientHeight - height - 12, this.y));
  }

  place(initial = false) {
    this.roamTarget = null;
    this.roamAt = performance.now() + 6000;
    if (this.open) {
      const rect=this.chat.getBoundingClientRect(),parent=this.mapPanel.getBoundingClientRect();
      const left=rect.left-parent.left,right=rect.right-parent.left,top=rect.top-parent.top,bottom=rect.bottom-parent.top;
      this.compact=false;this.x=right-180;
      if(top>=232)this.y=top-224;
      else if(bottom+236<=parent.height)this.y=bottom+8;
      else if(left>=200){this.x=left-188;this.y=top;}
      else if(right+200<=parent.width){this.x=right+8;this.y=top;}
      else {this.compact=true;this.x=right-72;this.y=top>=102?top-94:bottom+8;}
      this.widget.classList.toggle("is-compact",this.compact);
    } else if (initial) {
      this.x = this.mapPanel.clientWidth - 115;
      this.y = this.mapPanel.clientHeight - 120;
    }
    this.clampPosition();
  }

  setOpen(open,focus=true) {
    if(!open)this.voice.cancel();
    this.play.endIdle();this.flying=false;
    this.dismissBubble();
    this.open = open;
    this.chat.hidden = !open;
    this.widget.classList.toggle("is-open", open);
    this.widget.classList.toggle("is-arriving", open);
    this.button.setAttribute("aria-expanded", String(open));
    this.button.setAttribute("aria-label", open ? "Close Capri chat" : "Talk to Capri");
    this.vx = this.vy = 0;
    if(open)this.chatDrag.resize();
    this.place(!open);
    if (open) {
      // A mobile drawer should not obscure the conversation.
      if (matchMedia("(max-width:760px)").matches && document.querySelector("#sidebar-toggle").getAttribute("aria-expanded") === "true") document.querySelector("#sidebar-toggle").click();
      if(focus)requestAnimationFrame(() => this.input.focus({preventScroll:true}));
    } else this.button.focus({preventScroll:true});
  }

  nudge(event) {
    const current = { x:event.clientX, y:event.clientY, time:performance.now() };
    const previous = this.lastPointer;
    this.lastPointer = current;
    if (!previous || this.open || this.approach || !this.speech.hidden || this.dragging || this.hovered || this.focused || this.reducedMotion.matches || event.buttons) return;
    const speed = Math.hypot(current.x-previous.x,current.y-previous.y) / Math.max(1,current.time-previous.time);
    const rect = this.widget.getBoundingClientRect();
    const dx = rect.x + rect.width/2 - current.x, dy = rect.y + rect.height/2 - current.y;
    const distance = Math.hypot(dx,dy);
    // A fast cursor sweep nudges her aside; slow approaches remain clickable.
    if (speed > .65 && distance > 42 && distance < 125) {
      this.roamTarget = null;
      this.roamAt = current.time + 8000;
      this.vx = Math.max(-160,Math.min(160,this.vx+dx/distance*45));
      this.vy = Math.max(-160,Math.min(160,this.vy+dy/distance*45));
    }
  }

  animate(time) {
    this.animationFrame=requestAnimationFrame(this.tick);
    if(this.lastPaint && time-this.lastPaint<32)return;
    this.lastPaint=time;
    const dt = Math.min(.04, (time - (this.lastTime || time)) / 1000);
    this.lastTime = time;
    if (!document.hidden) {
      this.play.update(time);
      if(this.approach) {
        const a=this.approach,t=Math.min(1,(time-a.start)/650),ease=1-(1-t)**3;
        this.x=a.x+(a.targetX-a.x)*ease;this.y=a.y+(a.targetY-a.y)*ease;
        if(t===1){this.approach=null;this.speech.hidden=false;}
      }
      const still = this.open || this.approach || !this.speech.hidden || this.dragging || (!this.flying && (this.hovered || this.focused)) || this.reducedMotion.matches;
      if (!still) {
        if (time > this.roamAt) {
          if (!this.roamTarget) {
            this.roamTarget = {
              x:24 + Math.random() * Math.max(0,this.mapPanel.clientWidth-140),
              y:120 + Math.random() * Math.max(0,this.mapPanel.clientHeight-240),
            };
          }
          const dx = this.roamTarget.x-this.x, dy = this.roamTarget.y-this.y;
          const distance = Math.hypot(dx,dy), step = Math.min(distance,dt*(this.play.mischief && this.play.peekUntil?130:9));
          if (distance > 1) { this.x += dx/distance*step; this.y += dy/distance*step; }
          else { this.roamTarget = null; this.roamAt = time+7000; }
        }
        this.x += this.vx * dt; this.y += this.vy * dt;
        const damping=this.flying ? .55 : 4;
        this.vx *= Math.exp(-damping * dt); this.vy *= Math.exp(-damping * dt);
        if(this.flying && Math.hypot(this.vx,this.vy)<20){this.flying=false;this.vx=this.vy=0;}
      }
      this.clampPosition();
      if(!this.speech.hidden) {
        const left=this.x+86+250>this.mapPanel.clientWidth?this.x-250:this.x+86;
        this.speech.style.left=Math.max(12,Math.min(this.mapPanel.clientWidth-262,left))+"px";
        this.speech.style.top=Math.max(95,Math.min(this.mapPanel.clientHeight-this.speech.offsetHeight-12,this.y-18))+"px";
      }
      const driftX = still ? 0 : Math.sin(time / 1800) * 5;
      const driftY = still ? 0 : Math.sin(time / 1400) * 7;
      const transform = `translate3d(${(this.x+driftX).toFixed(2)}px,${(this.y+driftY).toFixed(2)}px,0)`;
      if (transform !== this.lastTransform) {
        this.widget.style.transform = transform;
        this.lastTransform = transform;
      }
      const frames = this.open?FRAMES[this.talking?"talking":"idle"]:FRAMES.orb;
      const frame = this.reducedMotion.matches ? frames[0] : frames[Math.floor(time / (this.talking?150:this.open?950:210)) % frames.length];
      if (frame !== this.lastFrame) {
        this.sprite.style.backgroundPositionX = `${frame * 100/3}%`;
        this.lastFrame = frame;
      }
      const state = this.open ? (this.talking ? "talking" : this.busy ? "thinking" : "idle") : this.widget.classList.contains("is-peeking")?"peeking":this.play.until?this.play.mood:"orb";
      if (state !== this.lastState) { this.widget.dataset.state = state; this.lastState = state; }
    }
  }

  async checkLink() {
    try {
      const result = await fetch("/api/capri/status").then(response => response.json());
      this.status.textContent = result.configured ? "Link ready · Ask me anything" : "Link offline · Server key needed";
    } catch { this.status.textContent = "Link offline · Try a message to reconnect"; }
  }

  dismissBubble() {
    this.approach=null;
    if(this.speech)this.speech.hidden=true;
    this.widget?.classList.remove("is-speaking-orb");
    this.roamAt=performance.now()+6000;
  }

  speakAt(point,text,action) {
    if(this.open)this.setOpen(false);
    this.dismissBubble();this.roamTarget=null;this.vx=this.vy=0;
    this.speech.querySelector("p").textContent=text;this.speechAction=action;
    this.widget.classList.add("is-speaking-orb");
    const targetX=Math.max(12,Math.min(this.mapPanel.clientWidth-100,point.x+24));
    const targetY=Math.max(95,Math.min(this.mapPanel.clientHeight-100,point.y+24));
    if(this.reducedMotion.matches){this.x=targetX;this.y=targetY;this.speech.hidden=false;}
    else this.approach={x:this.x,y:this.y,targetX,targetY,start:performance.now()};
  }

  appendMessage(role, text, extra = "") {
    const message = document.createElement("div");
    message.className = `chat-message ${role} ${extra}`;
    const speaker = document.createElement("span");
    speaker.className = "speaker";
    speaker.textContent = role === "user" ? "YOU" : "CAPRI";
    const content = document.createElement("span");
    content.className = "message-text";
    content.textContent = text;
    message.append(speaker, content);
    this.messages.append(message);
    this.messages.scrollTop = this.messages.scrollHeight;
    return {element:message, content};
  }

  async typeReply(text, content) {
    this.talking = true;
    sfx.play("confirm",{gain:.25});
    const duration = this.reducedMotion.matches ? 0 : Math.min(6500,Math.max(1100,text.length * 15));
    await new Promise(resolve => {
      const start = performance.now();
      const tick = now => {
        const progress = duration ? Math.min(1,(now-start)/duration) : 1;
        content.textContent = text.slice(0,Math.ceil(text.length*progress));
        if(this.open)sfx.babble(content.textContent.slice(-1));
        this.messages.scrollTop = this.messages.scrollHeight;
        if (progress < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    this.talking = false;
  }

  async send(spoken=null) {
    const message = (spoken??this.input.value).trim();
    if (!message || this.busy) return;
    this.busy = true;
    this.voice.setBusy(true);
    this.sendButton.disabled = true;
    this.chat.setAttribute("aria-busy","true");
    this.status.textContent = "Linking…";
    this.appendMessage("user", message);
    if(spoken===null)this.input.value = "";
    const pending = this.appendMessage("assistant", "One sec…", "pending");
    try {
      const plan=this.actions?.plan(message);
      let reply;
      if(plan)reply=await this.actions.execute(plan);
      else {
      const response = await fetch("/api/capri/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message, history:this.history.slice(-8), selected_authority:this.selectedAuthority, selected_year:this.selectedYear, app_state:this.actions?.state(),scenario:this.actions?.forecast.enabled?this.actions.forecast.appliedInputs:null}),
        signal:AbortSignal.timeout(70000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The link dropped. Please try again.");
      reply=result.actions?.length?await this.actions.execute(result.actions):result.reply;
      }
      if (typeof reply !== "string" || !reply.trim()) throw new Error("Empty reply. Please try again.");
      pending.element.classList.remove("pending");
      pending.content.textContent = "";
      await this.typeReply(reply, pending.content);
      this.history.push({role:"user",content:message},{role:"assistant",content:reply});
      this.history = this.history.slice(-8);
      this.status.textContent = "Link ready · Just us and the map";
    } catch (error) {
      pending.element.classList.remove("pending");
      pending.element.classList.add("error");
      pending.content.textContent = error.name === "TimeoutError" ? "The link timed out. Try again?" : error.message;
      this.status.textContent = "Link interrupted · You can retry";
    } finally {
      this.busy = false;
      this.talking = false;
      this.sendButton.disabled = false;
      this.voice.setBusy(false);
      this.chat.setAttribute("aria-busy","false");
      if (this.open) this.input.focus({preventScroll:true});
    }
  }

  explainArea(properties) {
    this.setOpen(true);
    if(this.busy)return;
    this.selectedAuthority=properties.authority_code;
    this.chat.querySelector("#capri-context").textContent="Context: "+properties.authority_name;
    this.input.value="Explain "+properties.authority_name+"'s income per head and population density, and what they mean on this map. Mention any missing data or limits.";
    this.send();
  }
}

class ChatDrag {
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

// Idle play and reactions stay local; neither invokes chat nor redraws the map.
class OrbPlay {
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
