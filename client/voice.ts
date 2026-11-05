interface Signal { kind:'offer'|'answer'|'ice';sdp?:string;candidate?:string;sdpMid?:string|null;sdpMLineIndex?:number|null }
interface Peer {pc:RTCPeerConnection;sender:RTCRtpSender;gain:GainNode;analyser:AnalyserNode;source?:MediaStreamAudioSourceNode;pending:RTCIceCandidateInit[];serial:Promise<void>;timer:ReturnType<typeof setTimeout>;outgoing:boolean}
export class VoiceMesh {
  private peers=new Map<string,Peer>();private stream:MediaStream|null=null;private id='';private context:AudioContext|null=null;
  private generation=0;
  constructor(private send:(to:string,data:Signal)=>void,private status:(s:string)=>void,private failed:()=>void){}
  start(id:string,stream:MediaStream,context:AudioContext){this.clear();this.id=id;this.stream=stream;this.context=context;}
  sync(players:{id:string;connected:boolean;mic:boolean;voiceAvailable?:boolean}[]){
    if(!this.stream||!this.context)return;
    const wanted=players.filter(p=>p.id!==this.id&&p.connected&&(p.voiceAvailable??p.mic)).map(p=>p.id);
    for(const id of this.peers.keys())if(!wanted.includes(id))this.remove(id);
    for(const id of wanted)if(!this.peers.has(id)){
      const peer=this.create(id);
      // Stable lexical offerer avoids glare; exactly one audio transceiver per pair.
      if(this.id<id)this.enqueue(id,peer,async()=>{
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        this.send(id,{kind:'offer',sdp:peer.pc.localDescription!.sdp});
      });
    }
  }
  private enqueue(id:string,p:Peer,work:()=>Promise<void>){
    const generation=this.generation;
    p.serial=p.serial.then(async()=>{if(generation!==this.generation||!this.peers.has(id))return;await work();}).catch(()=>this.status('تعذر تفاوض الصوت. استخدم إعادة الاتصال الصوتي.'));
  }
  private create(id:string):Peer {
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}],iceCandidatePoolSize:0});
    const track=this.stream!.getAudioTracks()[0];const sender=pc.addTrack(track,this.stream!);
    const gain=this.context!.createGain(),analyser=this.context!.createAnalyser();analyser.fftSize=512;
    gain.gain.value=0;gain.connect(analyser).connect(this.context!.destination);
    const p:Peer={pc,sender,gain,analyser,pending:[],serial:Promise.resolve(),timer:setTimeout(()=>{if(this.peers.get(id)===p&&pc.connectionState!=='connected')this.fail();},18_000),outgoing:true};
    this.peers.set(id,p);
    pc.onicecandidate=e=>{if(e.candidate)this.send(id,{kind:'ice',candidate:e.candidate.candidate,sdpMid:e.candidate.sdpMid,sdpMLineIndex:e.candidate.sdpMLineIndex});};
    pc.ontrack=e=>{
      p.source?.disconnect();p.source=this.context!.createMediaStreamSource(new MediaStream([e.track]));p.source.connect(gain);
      this.status('الصوت متصل؛ مدى المحادثة أثناء اللعب ٨ أمتار.');
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==='connected'){clearTimeout(p.timer);this.status('اتصال صوتي مباشر نشط.');}
      if(pc.connectionState==='failed')this.fail();
      if(pc.connectionState==='disconnected'){clearTimeout(p.timer);p.timer=setTimeout(()=>{if(pc.connectionState==='disconnected')this.fail();},8000);}
    };
    return p;
  }
  receive(from:string,data:Signal){
    if(!this.stream||!this.context||from===this.id)return;
    const p=this.peers.get(from)||this.create(from);
    this.enqueue(from,p,async()=>{
      if(data.kind==='ice'){
        const candidate={candidate:data.candidate,sdpMid:data.sdpMid,sdpMLineIndex:data.sdpMLineIndex};
        if(p.pc.remoteDescription)await p.pc.addIceCandidate(candidate);else if(p.pending.length<128)p.pending.push(candidate);return;
      }
      if(data.kind==='offer'&&this.id<from)return; // only the stable offerer can offer
      await p.pc.setRemoteDescription({type:data.kind,sdp:data.sdp});
      for(const c of p.pending.splice(0))await p.pc.addIceCandidate(c);
      if(data.kind==='offer'){
        await p.pc.setLocalDescription(await p.pc.createAnswer());this.send(from,{kind:'answer',sdp:p.pc.localDescription!.sdp});
      }
    });
  }
  policy(weights:Record<string,number>){
    for(const [id,p]of this.peers){
      const weight=Math.max(0,Math.min(1,weights[id]||0));p.gain.gain.setTargetAtTime(weight,this.context!.currentTime,.08);
    }
  }
  outgoing(weights:Record<string,number>){
    for(const [id,p]of this.peers){const on=(weights[id]||0)>0;if(on!==p.outgoing){p.outgoing=on;void p.sender.replaceTrack(on?this.stream!.getAudioTracks()[0]:null).catch(()=>this.status('تعذر تحديث مدى الإرسال الصوتي.'));}}
  }
  energy(){let max=0;for(const p of this.peers.values()){const data=new Float32Array(p.analyser.fftSize);p.analyser.getFloatTimeDomainData(data);max=Math.max(max,Math.sqrt(data.reduce((a,x)=>a+x*x,0)/data.length));}return max;}
  private fail(){this.status('فشل الاتصال الصوتي المباشر. قد تمنع شبكتك STUN؛ جرّب شبكة منزلية أو أعد الاتصال. لا يوجد TURN.');this.failed();}
  private remove(id:string){const p=this.peers.get(id);if(!p)return;this.peers.delete(id);clearTimeout(p.timer);p.pc.onconnectionstatechange=null;p.pc.onicecandidate=null;p.pc.ontrack=null;p.pc.close();p.source?.disconnect();p.gain.disconnect();p.analyser.disconnect();}
  clear(){this.generation++;for(const id of this.peers.keys())this.remove(id);this.stream=null;this.context=null;}
}
