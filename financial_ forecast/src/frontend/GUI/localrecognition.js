// SpeechRecognition-shaped adapter: audio stays on the app server, never a speech cloud.
export class LocalRecognition {
  async start() {
    this.active=true;this.queue=[];this.results=[];this.session=crypto.randomUUID().replaceAll("-","");
    this.controller=new AbortController();
    try {
      // Load the shared model before starting capture, so cold startup cannot
      // overflow the bounded audio queue or drop the wake phrase.
      const ready=await fetch("/api/capri/speech",{
        method:"POST",headers:{"Content-Type":"application/octet-stream","X-Speech-Session":this.session},
        body:new ArrayBuffer(0),signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)]),
      });
      if(!ready.ok)throw new Error("Local voice initialization failed.");
      if(!this.active)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(!this.active){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;
      this.context=new AudioContext({sampleRate:16000});
      await this.context.audioWorklet.addModule("/GUI/voiceprocessor.js");
      if(!this.active)return;
      const source=this.context.createMediaStreamSource(stream);
      this.node=new AudioWorkletNode(this.context,"capri-voice");
      this.node.port.onmessage=event=>{
        if(!this.active)return;
        if(this.queue.length>=4){this.error("network","Local voice couldn't keep up. Enable MIC to retry.");return;}
        this.queue.push(event.data);this.drain();
      };
      source.connect(this.node);this.node.connect(this.context.destination);
      await this.context.resume();
      if(this.active)this.onstart?.();
    }catch(error){
      if(this.active)this.error(error.name==="NotAllowedError"?"not-allowed":["NotFoundError","NotReadableError"].includes(error.name)?"audio-capture":"network",error.message.startsWith("Local voice")?error.message:undefined);
    }
  }
  async drain() {
    if(this.sending)return;
    this.sending=true;
    try {
      while(this.active && this.queue.length) {
        const response=await fetch("/api/capri/speech",{
          method:"POST",headers:{"Content-Type":"application/octet-stream","X-Speech-Session":this.session},
          body:this.queue.shift(),signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(10000)]),
        });
        if(!response.ok)throw new Error("Local voice returned HTTP "+response.status+". Enable MIC to retry.");
        const {text,final}=await response.json();
        if(!this.active)break;
        if(final && text)this.results.push(Object.assign([{transcript:text}],{isFinal:true}));
        if(this.results.length>16)this.results.shift();
        const results=[...this.results];
        if(!final && text)results.push(Object.assign([{transcript:text}],{isFinal:false}));
        if(text)this.onresult?.({results});
      }
    }catch(error){if(this.active)this.error("network",error.message);}
    finally{this.sending=false;}
  }
  error(error,message) {this.onerror?.({error,message});this.abort();}
  abort() {
    if(!this.active)return;
    this.active=false;this.queue=[];this.controller.abort();
    this.stream?.getTracks().forEach(track=>track.stop());this.node?.disconnect();
    this.context?.close().catch(()=>{});
    fetch("/api/capri/speech",{method:"DELETE",headers:{"X-Speech-Session":this.session},keepalive:true}).catch(()=>{});
    this.onend?.();
  }
}
