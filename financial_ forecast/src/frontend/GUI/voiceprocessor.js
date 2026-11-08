// Silence at the output; only bounded 0.5-second PCM chunks leave the worklet.
class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {super();this.samples=new Int16Array(8000);this.count=0;this.phase=0;}
  process(inputs) {
    const channel=inputs[0]?.[0];
    if(channel)for(const sample of channel) {
      this.phase+=16000/sampleRate;
      if(this.phase<1)continue;
      this.phase-=1;
      this.samples[this.count++]=Math.max(-1,Math.min(1,sample))*32767;
      if(this.count===this.samples.length) {
        this.port.postMessage(this.samples.buffer,[this.samples.buffer]);
        this.samples=new Int16Array(8000);this.count=0;
      }
    }
    return true;
  }
}
registerProcessor("capri-voice",VoiceProcessor);
