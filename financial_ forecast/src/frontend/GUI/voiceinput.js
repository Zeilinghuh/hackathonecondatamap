// Wake-word recognition is opt-in and runs only while this page is visible.
import {LocalRecognition} from "./localrecognition.js";
const WAKE=/\b(?:hey|hay)[\s,.!?:;-]*(?:capri|capree|capry|coppery|cap[\s-]+(?:ree|ri)|ka[\s-]*pri)\b[\s,.!?:;-]*/i;
export function wakeQuestion(text) {
  const match=WAKE.exec(text);
  return match?text.slice(match.index+match[0].length).trim():null;
}
const within=(promise,ms)=>{
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Speech setup timed out")),ms);})]).finally(()=>clearTimeout(timer));
};
export class VoiceInput {
  constructor(panel,{onWake,onQuestion,isBusy}) {
    Object.assign(this,{onWake,onQuestion,isBusy});
    this.enabled=false;this.armed=false;this.question="";this.prefix="";this.carry="";this.language="en-GB";this.local=false;this.generation=0;
    this.Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
    this.BrowserRecognition=this.Recognition;
    panel.insertAdjacentHTML("beforeend",`<section class="capri-voice" aria-label="Capri voice controls"><button type="button" class="capri-mic" aria-pressed="false" aria-label="Enable Hey Capri listening" aria-describedby="voice-status">MIC OFF</button><span id="voice-status" class="voice-status" role="status"></span><small class="voice-heard" hidden></small></section>`);
    this.button=panel.querySelector(".capri-mic");this.status=panel.querySelector(".voice-status");
    this.heard=panel.querySelector(".voice-heard");
    this.button.disabled=!window.isSecureContext || (!this.Recognition && !navigator.mediaDevices?.getUserMedia);
    this.status.textContent=this.button.disabled?"Voice unavailable here. Use a supported browser on localhost or HTTPS.":'Enable to say “Hey Capri”. Local voice is preferred when installed.';
    this.button.addEventListener("click",()=>this.toggle());
    document.addEventListener("visibilitychange",()=>{
      this.stop();this.clearQuestion();
      if(this.enabled && !document.hidden && !this.preparing)this.start();
      else if(this.enabled)this.status.textContent="Listening paused while this tab is hidden.";
    });
    window.addEventListener("pagehide",()=>{this.enabled=false;this.stop();});
  }
  toggle() {
    this.enabled=!this.enabled;
    this.renderButton();
    if(this.enabled){this.languageFallback=false;this.prepare();}
    else {this.generation++;this.preparing=false;this.stop();this.clearQuestion();this.heard.hidden=true;this.status.textContent="Microphone muted.";}
  }
  renderButton() {
    this.button.textContent=this.enabled?"MUTE MIC":"MIC OFF";
    this.button.setAttribute("aria-pressed",String(this.enabled));
    this.button.setAttribute("aria-label",this.enabled?"Mute Capri's microphone":"Enable Hey Capri listening");
  }
  async prepare() {
    const generation=++this.generation;this.preparing=true;
    this.status.textContent="Starting voice… Allow microphone access if prompted.";
    try {
      const response=await fetch("/api/capri/speech/status",{signal:AbortSignal.timeout(3000)});
      if(generation!==this.generation)return;
      const ready=response.ok && (await response.json()).ready;
      if(generation!==this.generation)return;
      if(ready && navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode) {
        this.Recognition=LocalRecognition;this.local=true;this.language="en-US";
      } else {this.Recognition=this.BrowserRecognition;this.local=false;}
    }catch{this.Recognition=this.BrowserRecognition;this.local=false;}
    if(generation!==this.generation)return;
    if(!this.Recognition){this.preparing=false;this.fail("Local voice isn't installed and browser speech isn't supported. You can still type.");return;}
    // Prefer on-device recognition when the browser exposes a usable local model.
    if(this.Recognition.available) {
      try {
        const languages=["en-GB","en-US"];
        const states=await within(Promise.all(languages.map(lang=>this.Recognition.available({langs:[lang],processLocally:true}).catch(()=>"unavailable"))),8000);
        if(generation!==this.generation)return;
        let index=states.indexOf("available");
        if(index<0 && this.Recognition.install) {
          index=states.findIndex(state=>state==="downloadable" || state==="downloading");
          if(index>=0) {
            this.status.textContent="Preparing the browser's local speech model…";
            if(!await within(this.Recognition.install({langs:[languages[index]],processLocally:true}),90000))index=-1;
          }
        }
        if(index>=0){this.local=true;this.language=languages[index];}
      }catch{this.local=false;}
    }
    if(generation!==this.generation)return;
    this.preparing=false;
    if(this.isBusy())this.status.textContent="Capri is replying. Listening resumes shortly…";
    else this.start();
  }
  fail(message) {
    this.enabled=false;this.renderButton();this.clearQuestion();this.stop();this.status.textContent=message;
  }
  clearQuestion() {
    clearTimeout(this.silence);clearTimeout(this.wakeTimeout);
    this.armed=false;this.question="";this.prefix="";this.carry="";this.wakeSession=null;
  }
  start() {
    clearTimeout(this.restart);
    if(!this.enabled || this.preparing || this.session || this.isBusy() || document.hidden)return;
    let session;
    try{session=new this.Recognition();}catch{this.fail("Voice isn't available in this browser. You can still type.");return;}
    this.session=session;
    session.lang=this.language;session.processLocally=this.local;session.continuous=true;session.interimResults=true;
    this.prefix=this.question;
    this.status.textContent="Starting microphone…";
    this.startTimeout=setTimeout(()=>{if(this.session===session)this.fail("The speech service didn't start. Check microphone permission or try Chrome.");},this.Recognition===LocalRecognition?20000:10000);
    session.onstart=()=>{
      if(this.session!==session)return;
      clearTimeout(this.startTimeout);
      this.button.classList.add("is-listening");
      this.status.textContent=this.armed?"Go on. Listening for your question…":`Listening${this.Recognition===LocalRecognition?" via local voice":this.local?" on this device":""} — say “Hey Capri”…`;
    };
    session.onsoundstart=()=>{if(this.session===session && !this.armed)this.status.textContent='Sound detected — say “Hey Capri”…';};
    let sessionText="";
    session.onresult=event=>{
      if(this.session!==session)return;
      let final="",interim="";
      for(const result of Array.from(event.results)) {
        if(result.isFinal)final+=result[0].transcript+" ";else interim+=result[0].transcript+" ";
      }
      sessionText=final+interim;
      this.heard.textContent="Heard: "+sessionText.trim().slice(-160);this.heard.hidden=!sessionText.trim();
      if(!this.armed && wakeQuestion(this.carry+sessionText)!==null) {
        this.armed=true;this.wakeSession=session;this.prefix="";this.onWake();
      }
      if(!this.armed)return;
      clearTimeout(this.wakeTimeout);
      const spoken=this.wakeSession===session?(wakeQuestion(this.carry+final)??""):final;
      this.question=[this.prefix,spoken.trim()].filter(Boolean).join(" ").slice(0,2000);
      this.status.textContent=this.question?this.question:"I'm here. What's the question?";
      if(!this.question)this.wakeTimeout=setTimeout(()=>{this.clearQuestion();this.stop();this.start();},15000);
      clearTimeout(this.silence);
      // Only finalized words are sent after a short pause.
      if(this.question && !interim.trim())this.silence=setTimeout(()=>this.submit(),1200);
    };
    session.onerror=event=>{
      if(this.session!==session || event.error==="aborted" || event.error==="no-speech")return;
      if(event.error==="language-not-supported" && !this.languageFallback) {
        this.languageFallback=true;this.language="en-US";this.local=false;this.stop();this.clearQuestion();this.start();return;
      }
      const messages={"not-allowed":"Microphone blocked. Allow access, then enable MIC again.","service-not-allowed":"This browser's speech service is unavailable. Try Chrome or enable its local speech model.","language-not-supported":"English speech recognition isn't available here. Try Chrome or enable a local English speech model.","audio-capture":"No microphone found. Check your microphone.",network:"Voice couldn't connect. Enable MIC to retry."};
      this.fail(this.Recognition===LocalRecognition && event.message?event.message:messages[event.error] || "Voice stopped. Enable MIC to retry.");
    };
    session.onend=()=>{
      if(this.session!==session)return;
      clearTimeout(this.startTimeout);this.button.classList.remove("is-listening");
      this.session=null;
      if(this.armed && this.question)this.submit();
      else {if(!this.armed)this.carry=sessionText.trim().split(/\s+/).slice(-3).join(" ")+" ";this.restart=setTimeout(()=>this.start(),400);}
    };
    try{session.start();}catch{this.fail("Couldn't start listening. Enable MIC to retry.");}
  }
  submit() {
    const question=this.question.trim();
    if(!this.enabled || !this.armed || !question || this.isBusy())return;
    this.stop();this.clearQuestion();this.onQuestion(question);
  }
  stop() {
    clearTimeout(this.restart);clearTimeout(this.silence);clearTimeout(this.startTimeout);this.button.classList.remove("is-listening");
    const session=this.session;this.session=null;session?.abort();
  }
  setBusy(busy) {
    if(busy){this.stop();this.clearQuestion();if(this.enabled)this.status.textContent="Capri is replying…";}
    else this.start();
  }
  cancelQuestion() { this.stop();this.clearQuestion();this.start(); }
}
