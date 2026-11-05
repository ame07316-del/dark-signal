export class SoundEngine {
  context:AudioContext|null=null;
  private effects:GainNode|null=null;
  private ambience:AudioBufferSourceNode|null=null;
  private volume=.35;
  private eventIds=new Set<number>();
  async unlock(){
    if(!this.context||this.context.state==='closed'){
      this.context=new AudioContext();this.effects=this.context.createGain();this.effects.gain.value=this.volume;this.effects.connect(this.context.destination);
    }
    await this.context.resume();return this.context;
  }
  level(value:number){this.volume=Math.max(0,Math.min(1,value));if(this.effects&&this.context)this.effects.gain.setTargetAtTime(this.volume,this.context.currentTime,.03);}
  tone(kind:'door'|'step'|'flash',gain=1,pan=0){
    const c=this.context;if(!c||c.state!=='running'||!this.effects)return;
    const oscillator=c.createOscillator(),envelope=c.createGain(),panner=c.createStereoPanner();
    const t=c.currentTime,duration=kind==='door'?.28:kind==='step'?.09:.05;
    oscillator.type=kind==='door'?'triangle':'sine';oscillator.frequency.setValueAtTime(kind==='door'?120:kind==='step'?75:700,t);
    oscillator.frequency.exponentialRampToValueAtTime(kind==='door'?38:kind==='step'?35:250,t+duration);
    envelope.gain.setValueAtTime(Math.min(.2,gain*.13),t);envelope.gain.exponentialRampToValueAtTime(.0001,t+duration);
    panner.pan.value=Math.max(-1,Math.min(1,pan));oscillator.connect(envelope).connect(panner).connect(this.effects);
    oscillator.start(t);oscillator.stop(t+duration);oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();panner.disconnect();};
  }
  atmosphere(on:boolean){
    if(!on){this.ambience?.stop();this.ambience?.disconnect();this.ambience=null;return;}
    const c=this.context;if(!c||this.ambience||!this.effects)return;
    const buffer=c.createBuffer(1,c.sampleRate*3,c.sampleRate),data=buffer.getChannelData(0);
    for(let n=0;n<data.length;n++)data[n]=(Math.random()*2-1)*.025;
    const source=c.createBufferSource(),filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=180;
    source.buffer=buffer;source.loop=true;source.connect(filter).connect(this.effects);source.start();this.ambience=source;
    source.onended=()=>filter.disconnect();
  }
  event(event:{id:number;kind:'door'|'step';x:number;z:number;strength:number},listener:{x:number;z:number},yaw:number,wallGain:number){
    if(this.eventIds.has(event.id))return;this.eventIds.add(event.id);if(this.eventIds.size>256)this.eventIds.delete(this.eventIds.values().next().value!);
    const dx=event.x-listener.x,dz=event.z-listener.z,d=Math.hypot(dx,dz);
    this.tone(event.kind,Math.max(0,1-d/12)*event.strength*wallGain,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/8);
  }
  async dispose(){this.atmosphere(false);this.eventIds.clear();const context=this.context;this.context=null;this.effects=null;if(context&&context.state!=='closed')await context.close();}
}
