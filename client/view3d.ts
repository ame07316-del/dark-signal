import { OBJECTIVES } from '../src/objectives.js';
import { type DoorStates, type Wall } from '../src/map.js';
import * as THREE from 'three';
import { ARENA, type Motion } from '../src/movement.js';

// Visual-only blockout: collision and door state still come from the shared server map.
export function createView(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x101619);
  renderer.domElement.id = 'view3d'; renderer.domElement.setAttribute('aria-label', 'قصر ثلاثي الأبعاد بمنظور أول');
  renderer.domElement.tabIndex = 0; host.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x111a19, 9, 34);
  const camera = new THREE.PerspectiveCamera(75, 1, .05, 45); camera.rotation.order = 'YXZ'; scene.add(camera);
  let renderWidth = 0, renderHeight = 0;
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height || (width === renderWidth && height === renderHeight)) return;
    renderWidth = width; renderHeight = height;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(host);

  // Two small, locally hosted original textures; no external requests during play.
  const loader = new THREE.TextureLoader();
  let wallMat: THREE.MeshStandardMaterial, floorMat: THREE.MeshStandardMaterial;
  let courtMat: THREE.MeshStandardMaterial, doorMat: THREE.MeshStandardMaterial;
  const plaster = loader.load('/assets/aged-plaster.jpg', undefined, undefined, () => {
    for (const material of [wallMat, courtMat]) if (material) { material.map = null; material.needsUpdate = true; }
  });
  const wood = loader.load('/assets/aged-wood.jpg', undefined, undefined, () => {
    for (const material of [floorMat, doorMat]) if (material) { material.map = null; material.needsUpdate = true; }
  });
  for (const texture of [plaster, wood]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
  }
  scene.add(new THREE.HemisphereLight(0xa6b7bb, 0x29271e, .82));
  wallMat = new THREE.MeshStandardMaterial({ color: 0xaaa99a, map: plaster, roughness: 1 });
  floorMat = new THREE.MeshStandardMaterial({ color: 0xb4b1a0, map: wood, roughness: 1 });
  courtMat = new THREE.MeshStandardMaterial({ color: 0x77806d, map: plaster, roughness: 1 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x353b35, roughness: 1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x34342a, roughness: 1 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x4b483b, roughness: .9, metalness: .2 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xb18e5c });

  // Scale UVs to physical dimensions so long walls are not stretched into a single patch.
  function tiledBox(w: number, h: number, d: number, metresPerTile: number) {
    const geometry = new THREE.BoxGeometry(w, h, d), uv = geometry.getAttribute('uv');
    const dimensions = [[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
    for (let face = 0; face < 6; face++) for (let vertex = 0; vertex < 4; vertex++) {
      const i = face * 4 + vertex;
      uv.setXY(i, uv.getX(i) * dimensions[face][0] / metresPerTile, uv.getY(i) * dimensions[face][1] / metresPerTile);
    }
    return geometry;
  }
  function box(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, tile = 0) {
    const geometry = tile ? tiledBox(w, h, d, tile) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); scene.add(mesh); return mesh;
  }
  const width = ARENA.maxX-ARENA.minX, depth = ARENA.maxZ-ARENA.minZ;
  box(width/2,-.15,depth/2,width,.3,depth,floorMat,3.8);
  // Permanent solids follow exactly the same walls as the authoritative map.
  const boundary: Wall[] = [
    {minX:-.3,maxX:0,minZ:0,maxZ:depth}, {minX:width,maxX:width+.3,minZ:0,maxZ:depth},
    {minX:0,maxX:width,minZ:-.3,maxZ:0}, {minX:0,maxX:width,minZ:depth,maxZ:depth+.3},
  ];
  for (const wall of [...ARENA.walls, ...boundary]) {
    box((wall.minX+wall.maxX)/2,1.5,(wall.minZ+wall.maxZ)/2,wall.maxX-wall.minX,3,wall.maxZ-wall.minZ,wallMat,2.6);
  }
  const court = ARENA.zones.find(z => z.kind === 'courtyard')!;
  box(court.x,.005,court.z,court.maxX-court.minX,.01,court.maxZ-court.minZ,courtMat,2.4);
  box(width/2,3.15,court.minZ/2,width,.3,court.minZ,ceilingMat);
  box(width/2,3.15,(court.maxZ+depth)/2,width,.3,depth-court.maxZ,ceilingMat);
  box(court.minX/2,3.15,court.z,court.minX,.3,court.maxZ-court.minZ,ceilingMat);
  box((court.maxX+width)/2,3.15,court.z,width-court.maxX,.3,court.maxZ-court.minZ,ceilingMat);

  // Small architectural details sit on existing walls. Instancing keeps draw calls modest.
  const unitBox = new THREE.BoxGeometry(1,1,1), unitHead = new THREE.SphereGeometry(1,10,8);
  const dummy = new THREE.Object3D();
  function instances(material: THREE.Material, placements: {x:number;y:number;z:number;w:number;h:number;d:number}[]) {
    const mesh = new THREE.InstancedMesh(unitBox, material, placements.length);
    placements.forEach((p,i) => { dummy.position.set(p.x,p.y,p.z); dummy.scale.set(p.w,p.h,p.d); dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix); });
    mesh.instanceMatrix.needsUpdate = true; scene.add(mesh); return mesh;
  }
  const trim: {x:number;y:number;z:number;w:number;h:number;d:number}[] = [];
  for (const wall of [...ARENA.walls, ...boundary]) for (const y of [.13,2.88]) {
    trim.push({x:(wall.minX+wall.maxX)/2,y,z:(wall.minZ+wall.maxZ)/2,w:wall.maxX-wall.minX+.025,h:.16,d:wall.maxZ-wall.minZ+.025});
  }
  instances(trimMat, trim);
  const frames: typeof trim = [];
  for (const d of ARENA.doors) {
    const cx=(d.minX+d.maxX)/2, cz=(d.minZ+d.maxZ)/2, w=d.maxX-d.minX, depth=d.maxZ-d.minZ;
    if (w >= depth) {
      frames.push({x:d.minX,y:1.48,z:cz,w:.10,h:2.96,d:depth+.04},{x:d.maxX,y:1.48,z:cz,w:.10,h:2.96,d:depth+.04},{x:cx,y:2.94,z:cz,w,h:.12,d:depth+.04});
    } else {
      frames.push({x:cx,y:1.48,z:d.minZ,w:w+.04,h:2.96,d:.10},{x:cx,y:1.48,z:d.maxZ,w:w+.04,h:2.96,d:.10},{x:cx,y:2.94,z:cz,w:w+.04,h:.12,d:depth});
    }
  }
  instances(trimMat, frames);
  doorMat = new THREE.MeshStandardMaterial({color:0x8c7d65,map:wood,roughness:1});
  const doorMeshes = new Map(ARENA.doors.map(d => [d.id,box((d.minX+d.maxX)/2,1.4,(d.minZ+d.maxZ)/2,d.maxX-d.minX,2.8,d.maxZ-d.minZ,doorMat,2.8)]));

  // A barred entrance and a pair of weak lamps are visual dressing, not new obstacles.
  const bars: typeof trim = [];
  for (let i=0;i<9;i++) bars.push({x:14.6+i*.35,y:1.35,z:.04,w:.055,h:2.7,d:.08});
  bars.push({x:16,y:.15,z:.04,w:3,h:.08,d:.08},{x:16,y:2.65,z:.04,w:3,h:.08,d:.08});
  instances(metalMat,bars);
  for (const x of [7,24]) {
    box(x,2.45,.14,.18,.27,.15,metalMat); box(x,2.4,.25,.09,.13,.09,glowMat);
    const lamp = new THREE.PointLight(0xe4b87d, 4, 6, 2); lamp.position.set(x,2.35,.55); scene.add(lamp);
  }
  const flashlight = new THREE.SpotLight(0xffe0ad, 28, 18, Math.PI / 7, .55, 1.4);
  flashlight.position.set(.12,-.12,-.1); flashlight.target.position.set(0,0,-10);
  camera.add(flashlight,flashlight.target);

  const clueMat=new THREE.MeshStandardMaterial({color:0xc5b780,emissive:0x30220a,roughness:1});
  const ammoMat=new THREE.MeshStandardMaterial({color:0x667b74,emissive:0x10201c,roughness:1});
  const itemMeshes=new Map([
    ...OBJECTIVES.clues.map(o=>[o.id,box(o.x,.13,o.z,.38,.12,.28,clueMat)] as const),
    ...OBJECTIVES.ammo.map(o=>[o.id,box(o.x,.16,o.z,.34,.3,.23,ammoMat)] as const),
  ]);
  box(OBJECTIVES.gate.x,1,OBJECTIVES.gate.z,.32,.45,.13,clueMat);

  // Lightweight human-proportioned stand-ins with a simple gait; not final character art.
  const crewMat = new THREE.MeshStandardMaterial({color:0x697b76,roughness:1});
  const frozenMat = new THREE.MeshStandardMaterial({color:0x6f6a59,roughness:1});
  const hamzaMat = new THREE.MeshStandardMaterial({color:0x665042,roughness:1});
  const ranaMat = new THREE.MeshStandardMaterial({color:0x62515b,roughness:1});
  const friendMat = new THREE.MeshStandardMaterial({color:0x857c69,roughness:1});
  const skinMat = new THREE.MeshStandardMaterial({color:0xaaa194,roughness:1});
  const hairMat = new THREE.MeshStandardMaterial({color:0x272721,roughness:1});
  const materials = [wallMat,floorMat,courtMat,ceilingMat,trimMat,metalMat,glowMat,doorMat,clueMat,ammoMat,crewMat,frozenMat,hamzaMat,ranaMat,friendMat,skinMat,hairMat];
  type Figure = {root:THREE.Group; arms:THREE.Group[]; legs:THREE.Group[]; clothes:THREE.Mesh[]; phase:number; stride:number};
  function makeFigure(kind:'crew'|'hamza'|'rana'|'friend') {
    const root = new THREE.Group(), clothes: THREE.Mesh[] = [];
    const outfit = kind==='hamza'?hamzaMat:kind==='rana'?ranaMat:kind==='friend'?friendMat:crewMat;
    function part(parent:THREE.Object3D, geometry:THREE.BufferGeometry, material:THREE.Material, x:number,y:number,z:number,w:number,h:number,d:number, clothed=false) {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.scale.set(w,h,d); parent.add(mesh); if(clothed)clothes.push(mesh); return mesh;
    }
    part(root,unitBox,outfit,0,1.18,0,.48,.66,.25,true);
    part(root,unitHead,skinMat,0,1.72,0,.20,.23,.19);
    part(root,unitBox,hairMat,0,1.86,.02,.34,.11,.30);
    if(kind==='rana')part(root,unitBox,hairMat,0,1.61,.13,.34,.40,.12);
    const arms: THREE.Group[] = [], legs: THREE.Group[] = [];
    for(const side of [-1,1]) {
      const arm=new THREE.Group();arm.position.set(side*.32,1.46,0);root.add(arm);
      part(arm,unitBox,outfit,0,-.25,0,.15,.5,.17,true);part(arm,unitHead,skinMat,0,-.54,0,.075,.09,.075);arms.push(arm);
      const leg=new THREE.Group();leg.position.set(side*.13,.88,0);root.add(leg);
      part(leg,unitBox,outfit,0,-.40,0,.19,.78,.21,true);part(leg,unitBox,hairMat,0,-.80,-.04,.19,.11,.30);legs.push(leg);
    }
    if(kind==='hamza')root.scale.setScalar(.92); if(kind==='rana')root.scale.setScalar(.97);
    scene.add(root); return {root,arms,legs,clothes,phase:0,stride:0} satisfies Figure;
  }
  const others = new Map<string, Figure>(), hunterMeshes = new Map<string,Figure>();
  const friend = makeFigure('friend'); friend.root.visible = false;
  let lastTime = 0;
  function updateFigure(figure:Figure, x:number,z:number,yaw:number,dt:number, immediate=false) {
    if(immediate)figure.root.position.set(x,0,z);
    const dx=x-figure.root.position.x,dz=z-figure.root.position.z;
    figure.root.position.x+=dx*.22; figure.root.position.z+=dz*.22; figure.root.rotation.y=yaw;
    figure.stride += ((Math.hypot(dx,dz)>.018?1:0)-figure.stride)*Math.min(1,dt*9);
    figure.phase += dt*8;
    const swing=Math.sin(figure.phase)*.42*figure.stride;
    figure.legs[0].rotation.x=swing;figure.legs[1].rotation.x=-swing;
    figure.arms[0].rotation.x=-swing*.7;figure.arms[1].rotation.x=swing*.7;
  }
  let disposed = false;
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); host.dataset.lost = 'true'; });
  renderer.domElement.addEventListener('webglcontextrestored', () => { delete host.dataset.lost; });
  function draw(local: Pick<Motion, 'x' | 'z'>, pitch: number, yaw: number, players: {id:string; x:number; z:number; yaw?:number; frozen:boolean;life?:string}[], doors: DoorStates, hunters: {id:string;x:number;z:number;yaw:number}[], round:any, id?: string, crouch = false) {
    if (disposed) return;
    if (!resizeObserver || !renderWidth) resize();
    const now=performance.now(),dt=lastTime?Math.min(.05,(now-lastTime)/1000):0;lastTime=now;
    camera.position.set(local.x,crouch ? 1.1 : 1.65,local.z); camera.rotation.set(pitch,yaw,0,'YXZ');
    const present = new Set(players.filter(p => p.id !== id).map(p => p.id));
    for (const [key, figure] of others) if (!present.has(key)) { scene.remove(figure.root); others.delete(key); }
    for (const p of players) {
      if (p.id === id) continue;
      let figure = others.get(p.id);
      if (!figure) { figure = makeFigure('crew'); figure.root.position.set(p.x,0,p.z); others.set(p.id,figure); }
      updateFigure(figure,p.x,p.z,p.yaw||0,dt);
      for(const part of figure.clothes)part.material=p.frozen?frozenMat:crewMat;
      figure.root.rotation.z=['downed','last-chance','eliminated'].includes(p.life||'') ? 1.2 : 0;
    }
    for (const [doorId,mesh] of doorMeshes) mesh.visible = doors[doorId] === false;
    for(const [hunterId,figure] of hunterMeshes) if(!hunters.some(h=>h.id===hunterId)){scene.remove(figure.root);hunterMeshes.delete(hunterId);}
    for(const hunter of hunters) {
      let figure=hunterMeshes.get(hunter.id);
      if(!figure){figure=makeFigure(hunter.id==='hamza'?'hamza':'rana');figure.root.position.set(hunter.x,0,hunter.z);hunterMeshes.set(hunter.id,figure);}
      updateFigure(figure,hunter.x,hunter.z,hunter.yaw,dt);
    }
    for(const[itemId,mesh]of itemMeshes)mesh.visible=itemId.startsWith('clue')?!round?.clues.find((c:any)=>c.id===itemId)?.collected:!round?.pickups.includes(itemId);
    if(round?.friend){
      friend.root.visible=['trapped','following'].includes(round.friend.state);
      if(friend.root.visible){const dx=round.friend.x-friend.root.position.x,dz=round.friend.z-friend.root.position.z;const direction=Math.hypot(dx,dz)>.02?Math.atan2(-dx,-dz):friend.root.rotation.y;updateFigure(friend,round.friend.x,round.friend.z,direction,dt,friend.root.position.x===0&&friend.root.position.z===0);}
    } else friend.root.visible=false;
    renderer.render(scene,camera);
  }
  return { canvas: renderer.domElement, draw, light(on: boolean) { flashlight.visible = on; }, dispose() {
    disposed = true; resizeObserver?.disconnect();
    const geometries = new Set<THREE.BufferGeometry>(); scene.traverse(o => { if (o instanceof THREE.Mesh) geometries.add(o.geometry); });
    for(const geometry of geometries)geometry.dispose(); for(const material of materials)material.dispose(); plaster.dispose(); wood.dispose();
    renderer.dispose(); renderer.domElement.remove();
  } };
}
