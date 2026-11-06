import { OBJECTIVES } from '../src/objectives.js';
import { type DoorStates } from '../src/map.js';
import * as THREE from 'three';
import { ARENA, type Motion } from '../src/movement.js';
export function createView(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x101619);
  renderer.domElement.id = 'view3d'; renderer.domElement.setAttribute('aria-label', 'ساحة اختبار ثلاثية الأبعاد بمنظور أول');
  renderer.domElement.tabIndex = 0; host.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x101619, 10, 38);
  const camera = new THREE.PerspectiveCamera(75, 1, .05, 45); camera.rotation.order = 'YXZ'; scene.add(camera);
  let renderWidth = 0, renderHeight = 0;
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height || (width === renderWidth && height === renderHeight)) return;
    renderWidth = width; renderHeight = height;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  // Avoid forcing layout during every animation frame when the viewport is unchanged.
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(host);
  scene.add(new THREE.HemisphereLight(0x9cb1bd, 0x28231b, .75));
  const mat = new THREE.MeshStandardMaterial({ color: 0x565c56, roughness: 1 });
  function box(x: number, y: number, z: number, w: number, h: number, d: number, material = mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x,y,z); scene.add(mesh); return mesh;
  }
  const width = ARENA.maxX-ARENA.minX, depth = ARENA.maxZ-ARENA.minZ;
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x343a36, roughness: 1 });
  const courtMat = new THREE.MeshStandardMaterial({ color: 0x424b3a, roughness: 1 });
  box(width/2,-.15,depth/2,width,.3,depth,floorMat);
  // All solid geometry is generated from the shared collision source.
  for (const w of ARENA.walls) box((w.minX+w.maxX)/2,1.5,(w.minZ+w.maxZ)/2,w.maxX-w.minX,3,w.maxZ-w.minZ);
  box(-.15,1.5,depth/2,.3,3,depth); box(width+.15,1.5,depth/2,.3,3,depth);
  box(width/2,1.5,-.15,width,3,.3); box(width/2,1.5,depth+.15,width,3,.3);
  const court = ARENA.zones.find(z => z.kind === 'courtyard')!;
  box(court.x,.005,court.z,court.maxX-court.minX,.01,court.maxZ-court.minZ,courtMat);
  // Thin ceilings outside the courtyard leave the central sky opening visible.
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x262b29, roughness: 1 });
  box(width/2,3.15,court.minZ/2,width,.3,court.minZ,ceilingMat);
  box(width/2,3.15,(court.maxZ+depth)/2,width,.3,depth-court.maxZ,ceilingMat);
  box(court.minX/2,3.15,court.z,court.minX,.3,court.maxZ-court.minZ,ceilingMat);
  box((court.maxX+width)/2,3.15,court.z,width-court.maxX,.3,court.maxZ-court.minZ,ceilingMat);
  const flashlight = new THREE.SpotLight(0xffe0ad, 28, 18, Math.PI / 7, .55, 1.4);
  flashlight.position.set(.12,-.12,-.1); flashlight.target.position.set(0,0,-10);
  camera.add(flashlight,flashlight.target);
  const doorMat = new THREE.MeshStandardMaterial({color:0x765432,roughness:1});
  const doorMeshes = new Map(ARENA.doors.map(d => [d.id,box((d.minX+d.maxX)/2,1.4,(d.minZ+d.maxZ)/2,d.maxX-d.minX,2.8,d.maxZ-d.minZ,doorMat)]));
  const hunterMeshes = new Map<string,THREE.Mesh>();
  const hunterMaterials=[new THREE.MeshStandardMaterial({color:0xa7523b,roughness:1}),new THREE.MeshStandardMaterial({color:0x795093,roughness:1})];
  const itemMat=new THREE.MeshStandardMaterial({color:0xd4bc70,emissive:0x30220a});
  const itemMeshes=new Map([...OBJECTIVES.clues,...OBJECTIVES.ammo].map(o=>[o.id,box(o.x,.65,o.z,.35,.35,.35,itemMat)]));
  const friendMat=new THREE.MeshStandardMaterial({color:0xc0b6a0});
  const friendMesh=box(OBJECTIVES.friend.x,.8,OBJECTIVES.friend.z,.4,1.6,.4,friendMat);
  box(OBJECTIVES.gate.x,1,OBJECTIVES.gate.z,.4,.5,.15,itemMat);
  const others = new Map<string, THREE.Mesh>();
  const geometry = new THREE.CapsuleGeometry(.25,1.1,3,6);
  const normal = new THREE.MeshStandardMaterial({ color: 0x8daebb, roughness: .9 });
  const frozen = new THREE.MeshStandardMaterial({ color: 0x9a845c, roughness: .9 });
  let disposed = false;
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); host.dataset.lost = 'true'; });
  function draw(local: Pick<Motion, 'x' | 'z'>, pitch: number, yaw: number, players: {id:string; x:number; z:number; frozen:boolean}[], doors: DoorStates, hunters: {id:string;x:number;z:number;yaw:number}[], round:any, id?: string, crouch = false) {
    if (disposed) return;
    if (!resizeObserver || !renderWidth) resize();
    camera.position.set(local.x,crouch ? 1.1 : 1.65,local.z); camera.rotation.set(pitch,yaw,0,'YXZ');
    const present = new Set(players.filter(p => p.id !== id).map(p => p.id));
    for (const [key, mesh] of others) if (!present.has(key)) { scene.remove(mesh); others.delete(key); }
    for (const p of players) {
      if (p.id === id) continue;
      let mesh = others.get(p.id);
      if (!mesh) { mesh = new THREE.Mesh(geometry,normal); mesh.position.set(p.x,.85,p.z); others.set(p.id,mesh); scene.add(mesh); }
      mesh.position.x += (p.x-mesh.position.x)*.22; mesh.position.z += (p.z-mesh.position.z)*.22;
      mesh.material = p.frozen ? frozen : normal;
    }
    for (const [id,mesh] of doorMeshes) mesh.visible = doors[id] === false;
    for(const [id,mesh] of hunterMeshes) if(!hunters.some(h=>h.id===id)){scene.remove(mesh);hunterMeshes.delete(id);}
    for(const h of hunters) {
      let mesh=hunterMeshes.get(h.id);
      if(!mesh){mesh=new THREE.Mesh(geometry,hunterMaterials[h.id==='hamza'?0:1]);mesh.position.set(h.x,.85,h.z);hunterMeshes.set(h.id,mesh);scene.add(mesh);}
      mesh.position.x+=(h.x-mesh.position.x)*.22;mesh.position.z+=(h.z-mesh.position.z)*.22;mesh.rotation.y=h.yaw;
    }
    for(const[id,mesh]of itemMeshes)mesh.visible=id.startsWith('clue')?!round?.clues.find((c:any)=>c.id===id)?.collected:!round?.pickups.includes(id);
    if(round?.friend){friendMesh.visible=['trapped','following'].includes(round.friend.state);friendMesh.position.set(round.friend.x,.8,round.friend.z);}
    renderer.render(scene,camera);
  }
  return { canvas: renderer.domElement, draw, light(on: boolean) { flashlight.visible = on; }, dispose() {
    disposed = true; resizeObserver?.disconnect(); scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    mat.dispose();itemMat.dispose();friendMat.dispose(); for(const m of hunterMaterials)m.dispose(); doorMat.dispose(); floorMat.dispose(); courtMat.dispose(); ceilingMat.dispose(); normal.dispose(); frozen.dispose(); renderer.dispose(); renderer.domElement.remove();
  } };
}
