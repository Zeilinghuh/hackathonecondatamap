// The companion is a local animated UI. Only submitting chat calls the AI.
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
        <p id="capri-context" class="capri-context">Context: UK income terrain</p>
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
    this.appendMessage("assistant", "Hey, I'm Capri. Pick an area and ask me about the terrain - or just say hi~");
    this.button.addEventListener("click", () => {
      if (this.dragged) { this.dragged = false; return; }
      this.setOpen(!this.open);
    });
    this.chat.querySelector(".capri-close").addEventListener("click", () => this.setOpen(false));
    this.chat.querySelector("form").addEventListener("submit", event => { event.preventDefault(); this.send(); });
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.send(); }
    });
    this.button.addEventListener("pointerenter", () => { this.hovered = true; this.vx = this.vy = 0; });
    this.button.addEventListener("pointerleave", () => { this.hovered = false; });
    this.button.addEventListener("focus", () => { this.focused = true; this.vx = this.vy = 0; });
    this.button.addEventListener("blur", () => { this.focused = false; });
    this.button.addEventListener("pointerdown", event => {
      if (event.button !== 0 || this.open) return;
      this.dragged = false;
      this.dragging = true;
      this.vx = this.vy = 0;
      this.dragStart = { x:event.clientX, y:event.clientY, baseX:this.x, baseY:this.y };
      this.button.setPointerCapture(event.pointerId);
    });
    this.button.addEventListener("pointermove", event => {
      if (!this.dragging) return;
      const dx = event.clientX - this.dragStart.x, dy = event.clientY - this.dragStart.y;
      if (Math.hypot(dx, dy) > 5) this.dragged = true;
      this.x = this.dragStart.baseX + dx;
      this.y = this.dragStart.baseY + dy;
      this.clampPosition();
    });
    const release = () => {
      this.dragging = false;
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
    new ResizeObserver(() => this.place()).observe(mapPanel);
    this.place(true);
    this.checkLink();
    requestAnimationFrame(time => this.animate(time));
  }

  clampPosition() {
    const width = this.open ? 144 : 76, height = this.open ? 173 : 84;
    this.x = Math.max(12, Math.min(this.mapPanel.clientWidth - width - 12, this.x));
    this.y = Math.max(95, Math.min(this.mapPanel.clientHeight - height - 12, this.y));
  }

  place(initial = false) {
    this.roamTarget = null;
    this.roamAt = performance.now() + 6000;
    if (this.open) {
      this.x = this.mapPanel.clientWidth - 170;
      this.y = this.mapPanel.clientHeight - this.chat.offsetHeight - 173 - 8;
    } else if (initial) {
      this.x = this.mapPanel.clientWidth - 115;
      this.y = this.mapPanel.clientHeight - 120;
    }
    this.clampPosition();
  }

  setOpen(open) {
    this.open = open;
    this.chat.hidden = !open;
    this.widget.classList.toggle("is-open", open);
    this.widget.classList.toggle("is-arriving", open);
    this.button.setAttribute("aria-expanded", String(open));
    this.button.setAttribute("aria-label", open ? "Close Capri chat" : "Talk to Capri");
    this.vx = this.vy = 0;
    this.place(!open);
    if (open) {
      // A mobile drawer should not obscure the conversation.
      if (matchMedia("(max-width:760px)").matches && document.querySelector("#sidebar-toggle").getAttribute("aria-expanded") === "true") document.querySelector("#sidebar-toggle").click();
      requestAnimationFrame(() => this.input.focus({preventScroll:true}));
    } else this.button.focus({preventScroll:true});
  }

  nudge(event) {
    const current = { x:event.clientX, y:event.clientY, time:performance.now() };
    const previous = this.lastPointer;
    this.lastPointer = current;
    if (!previous || this.open || this.dragging || this.hovered || this.focused || this.reducedMotion.matches || event.buttons) return;
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
    const dt = Math.min(.04, (time - (this.lastTime || time)) / 1000);
    this.lastTime = time;
    if (!document.hidden) {
      const still = this.open || this.dragging || this.hovered || this.focused || this.reducedMotion.matches;
      if (!still) {
        if (time > this.roamAt) {
          if (!this.roamTarget) {
            this.roamTarget = {
              x:24 + Math.random() * Math.max(0,this.mapPanel.clientWidth-140),
              y:120 + Math.random() * Math.max(0,this.mapPanel.clientHeight-240),
            };
          }
          const dx = this.roamTarget.x-this.x, dy = this.roamTarget.y-this.y;
          const distance = Math.hypot(dx,dy), step = Math.min(distance,dt*9);
          if (distance > 1) { this.x += dx/distance*step; this.y += dy/distance*step; }
          else { this.roamTarget = null; this.roamAt = time+7000; }
        }
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.vx *= Math.exp(-4 * dt); this.vy *= Math.exp(-4 * dt);
      }
      this.clampPosition();
      const driftX = still ? 0 : Math.sin(time / 1800) * 5;
      const driftY = still ? 0 : Math.sin(time / 1400) * 7;
      const transform = `translate3d(${(this.x+driftX).toFixed(2)}px,${(this.y+driftY).toFixed(2)}px,0)`;
      if (transform !== this.lastTransform) {
        this.widget.style.transform = transform;
        this.lastTransform = transform;
      }
      const frames = this.open ? (this.talking ? [1,2,1,0] : [0,0,0,3]) : [0,1,2,3];
      const frame = this.reducedMotion.matches ? 0 : frames[Math.floor(time / (this.talking ? 150 : this.open ? 950 : 210)) % 4];
      if (frame !== this.lastFrame) {
        this.sprite.style.backgroundPositionX = `${frame * 100/3}%`;
        this.lastFrame = frame;
      }
      const state = this.open ? (this.talking ? "talking" : this.busy ? "thinking" : "idle") : "orb";
      if (state !== this.lastState) { this.widget.dataset.state = state; this.lastState = state; }
    }
    requestAnimationFrame(next => this.animate(next));
  }

  async checkLink() {
    try {
      const result = await fetch("/api/capri/status").then(response => response.json());
      this.status.textContent = result.configured ? "Link ready · Ask me anything" : "Link offline · Server key needed";
    } catch { this.status.textContent = "Link offline · Try a message to reconnect"; }
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
    const duration = this.reducedMotion.matches ? 0 : Math.min(6500,Math.max(1100,text.length * 15));
    await new Promise(resolve => {
      const start = performance.now();
      const tick = now => {
        const progress = duration ? Math.min(1,(now-start)/duration) : 1;
        content.textContent = text.slice(0,Math.ceil(text.length*progress));
        this.messages.scrollTop = this.messages.scrollHeight;
        if (progress < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    this.talking = false;
  }

  async send() {
    const message = this.input.value.trim();
    if (!message || this.busy) return;
    this.busy = true;
    document.dispatchEvent(new CustomEvent("capri:busy",{detail:true}));
    this.sendButton.disabled = true;
    this.chat.setAttribute("aria-busy","true");
    this.status.textContent = "Linking…";
    this.appendMessage("user", message);
    this.input.value = "";
    const pending = this.appendMessage("assistant", "One sec…", "pending");
    try {
      const response = await fetch("/api/capri/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message, history:this.history.slice(-8), selected_authority:this.selectedAuthority, selected_year:this.selectedYear}),
        signal:AbortSignal.timeout(35000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The link dropped. Please try again.");
      if (typeof result.reply !== "string" || !result.reply.trim()) throw new Error("Empty reply. Please try again.");
      pending.element.classList.remove("pending");
      pending.content.textContent = "";
      await this.typeReply(result.reply, pending.content);
      this.history.push({role:"user",content:message},{role:"assistant",content:result.reply});
      this.history = this.history.slice(-8);
      this.status.textContent = "Link ready · Just us and the map";
    } catch (error) {
      pending.element.classList.remove("pending");
      pending.element.classList.add("error");
      pending.content.textContent = error.name === "TimeoutError" ? "The link timed out. Try again?" : error.message;
      this.status.textContent = "Link interrupted · You can retry";
    } finally {
      this.busy = false;
      document.dispatchEvent(new CustomEvent("capri:busy",{detail:false}));
      this.talking = false;
      this.sendButton.disabled = false;
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
