// Hold to capture; release flushes the final words and sends exactly one message.
import {sfx} from "../terraincontrols.js";
export class VoiceInput {
  constructor(panel,{onQuestion,isBusy}) {
    Object.assign(this,{onQuestion,isBusy});
    panel.insertAdjacentHTML("beforeend",`<section class="capri-voice" aria-label="Capri voice"><button type="button" class="capri-mic" aria-pressed="false" aria-describedby="voice-status">Hold to speak to Capri</button><span id="voice-status" class="voice-status" role="status">Hold, speak, then release to send.</span></section>`);
    this.button=panel.querySelector(".capri-mic");this.status=panel.querySelector("#voice-status");
    panel.querySelector(".map-hud")?.append(this.button.closest(".capri-voice"));
    this.supported=window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && !!window.AudioWorkletNode;
    this.button.disabled=!this.supported;
    if(!this.supported)this.status.textContent="Voice requires a supported browser on localhost or HTTPS.";
    this.button.addEventListener("pointerdown",event=>{if(event.button===0){event.preventDefault();this.button.setPointerCapture(event.pointerId);this.start();}});
    this.button.addEventListener("pointerup",()=>this.finish());
    this.button.addEventListener("pointercancel",()=>this.cancel());
    this.button.addEventListener("lostpointercapture",()=>{if(this.held)this.cancel();});
    this.button.addEventListener("keydown",event=>{if([" ","Enter"].includes(event.key)){event.preventDefault();if(!event.repeat)this.start();}});
    this.button.addEventListener("keyup",event=>{if([" ","Enter"].includes(event.key)){event.preventDefault();this.finish();}});
    window.addEventListener("blur",()=>this.cancel());window.addEventListener("pagehide",()=>this.cancel());
    document.addEventListener("visibilitychange",()=>{if(document.hidden)this.cancel();});
  }
  async start() {
    if(this.active || this.isBusy() || !this.supported)return;
    this.active=this.held=true;this.ready=false;this.parts=[];this.queue=[];
    sfx.setRecording(true);
    const id=this.id=crypto.randomUUID().replaceAll("-","");
    this.controller=new AbortController();
    this.button.setAttribute("aria-pressed","true");this.button.textContent="Release to send";
    this.status.textContent="Preparing microphone… Allow access if prompted.";
    try {
      await this.request(new ArrayBuffer(0));
      if(this.id!==id || !this.held)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(this.id!==id || !this.held){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;this.context=new AudioContext({sampleRate:16000});
      await this.context.audioWorklet.addModule("/GUI/capri/voiceprocessor.js");
      if(this.id!==id || !this.held)return;
      this.node=new AudioWorkletNode(this.context,"capri-voice");
      this.node.port.onmessage=event=>{
        if(this.id!==id)return;
        if(event.data==="flushed"){this.flushed?.();return;}
        if(this.queue.length>=6){this.fail("Voice couldn't keep up. Please try again.");return;}
        this.queue.push(event.data);this.pump().catch(error=>{if(this.id===id)this.fail(error.message);});
      };
      this.source=this.context.createMediaStreamSource(stream);this.source.connect(this.node);this.node.connect(this.context.destination);
      await this.context.resume();
      if(this.id!==id || !this.held)return;
      this.ready=true;this.button.classList.add("is-listening");this.status.textContent="Listening… Release to send.";
      this.limit=setTimeout(()=>this.fail("Recording limit reached. Hold to speak again."),60000);
    }catch(error){if(this.id===id)this.fail(error.name==="NotAllowedError"?"Microphone blocked. Allow access and try again.":error.message);}
  }
  async request(audio,final=false) {
    const response=await fetch("/api/capri/speech",{method:"POST",headers:{"Content-Type":"application/octet-stream","X-Speech-Session":this.id,"X-Speech-Final":String(final)},body:audio,signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(20000)])});
    if(!response.ok)throw new Error("Local voice is unavailable. Check the server's voice setup.");
    return response.json();
  }
  pump() {
    if(this.pending)return this.pending;
    const id=this.id;
    this.pending=(async()=>{
      while(this.id===id && this.active && this.queue.length) {
        const result=await this.request(this.queue.shift());
        if(this.id!==id)return;
        if(result.final && result.text)this.parts.push(result.text);
        if(this.held && result.text)this.status.textContent=result.text;
      }
    })().finally(()=>{if(this.id===id)this.pending=null;});
    return this.pending;
  }
  async finish() {
    if(!this.held)return;
    this.held=false;
    if(!this.ready){this.cancel();return;}
    const id=this.id;
    clearTimeout(this.limit);this.button.disabled=true;this.button.setAttribute("aria-pressed","false");this.button.classList.remove("is-listening");
    this.status.textContent="Converting speech…";this.stream.getTracks().forEach(track=>track.stop());this.source.disconnect();sfx.setRecording(false);
    try {
      await new Promise(resolve=>{this.flushed=resolve;this.node.port.postMessage("flush");this.flushTimer=setTimeout(resolve,1000);});
      clearTimeout(this.flushTimer);this.flushed=null;
      await this.pump();
      if(this.id!==id)return;
      const result=await this.request(new ArrayBuffer(0),true);
      if(this.id!==id)return;
      if(result.text)this.parts.push(result.text);
      const question=this.parts.join(" ").trim().slice(0,2000);
      this.cancel();
      if(question){this.status.textContent="Message sent.";this.onQuestion(question);}
      else this.status.textContent="No speech captured. Hold to try again.";
    }catch(error){if(this.id===id)this.fail(error.message);}
  }
  cancel() {
    if(!this.active)return;
    const id=this.id;this.id=null;this.active=this.held=false;this.pending=null;
    clearTimeout(this.limit);clearTimeout(this.flushTimer);this.flushed?.();this.flushed=null;
    this.controller.abort();this.queue=[];
    this.stream?.getTracks().forEach(track=>track.stop());this.node?.disconnect();this.context?.close().catch(()=>{});
    sfx.setRecording(false);
    fetch("/api/capri/speech",{method:"DELETE",headers:{"X-Speech-Session":id},keepalive:true}).catch(()=>{});
    this.button.setAttribute("aria-pressed","false");this.button.classList.remove("is-listening");this.button.textContent="Hold to speak to Capri";
    this.button.disabled=this.isBusy() || !this.supported;this.status.textContent="Hold, speak, then release to send.";
  }
  fail(message) {this.cancel();this.status.textContent=message;}
  setBusy(busy) {if(busy)this.cancel();this.button.disabled=busy || !this.supported;}
}
