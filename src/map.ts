/** Shared, flat ground-floor blockout. No production art or final puzzle layout. */
export interface Wall { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Zone extends Wall { id: string; label: string; x: number; z: number; kind: 'room' | 'hall' | 'courtyard' }
const wall = (minX: number, maxX: number, minZ: number, maxZ: number): Wall => ({ minX,maxX,minZ,maxZ });
export const ARENA = {
  id: 'mansion-ground-v2', minX: 0, maxX: 32, minZ: 0, maxZ: 32,
  walls: [
    // Main north/south galleries: permanent openings, not functional doors yet.
    ...[[0,2],[4,7],[9,14],[18,23],[25,28],[30,32]].flatMap(([a,b]) => [wall(a,b,6,6.3),wall(a,b,25.7,26)]),
    // Central courtyard enclosure, with an opening on each side.
    wall(9,10,6.3,14),wall(9,10,18,25.7),wall(22,23,6.3,14),wall(22,23,18,25.7),
    wall(10,14,9,10),wall(18,22,9,10),wall(10,14,22,23),wall(18,22,22,23),
    // West/east corridor and room entrances.
    ...[[6.3,9],[11,17],[19,24]].flatMap(([a,b]) => [wall(6,6.3,a,b),wall(25.7,26,a,b)]),
    // Three rooms in each wing, doorways between adjacent rooms.
    ...[14,22].flatMap(z => [wall(0,2.2,z,z+.3),wall(4.2,6,z,z+.3),wall(26,28.2,z,z+.3),wall(30.2,32,z,z+.3)]),
  ],
  doors: [
    { ...wall(2,4,6,6.3), id:'entry-west', label:'باب الجناح الغربي' },
    { ...wall(14,18,9,10), id:'court-north', label:'باب الفناء الشمالي' },
    { ...wall(9,10,14,18), id:'court-west', label:'باب الفناء الغربي' },
    { ...wall(22,23,14,18), id:'court-east', label:'باب الفناء الشرقي' },
  ],
  spawns: [{ x:2,z:2 },{ x:3,z:2 },{ x:4,z:2 },{ x:5,z:2 }],
  zones: [
    { ...wall(0,32,0,6), id:'entrance',label:'رواق الدخول',x:16,z:3,kind:'hall' },
    { ...wall(10,22,10,22), id:'courtyard',label:'الفناء المركزي',x:16,z:16,kind:'courtyard' },
    { ...wall(0,6,6.3,14), id:'kitchen',label:'المطبخ',x:3,z:10,kind:'room' },
    { ...wall(0,6,14.3,22), id:'storage',label:'المخزن',x:3,z:18,kind:'room' },
    { ...wall(0,6,22.3,26), id:'archive',label:'غرفة جانبية',x:3,z:24,kind:'room' },
    { ...wall(26,32,6.3,14), id:'reception',label:'الاستقبال',x:29,z:10,kind:'room' },
    { ...wall(26,32,14.3,22), id:'office',label:'المكتب',x:29,z:18,kind:'room' },
    { ...wall(26,32,22.3,26), id:'utility',label:'غرفة خدمات',x:29,z:24,kind:'room' },
    { ...wall(6.3,9,6.3,25.7), id:'west-hall',label:'الممر الغربي',x:7.5,z:16,kind:'hall' },
    { ...wall(23,25.7,6.3,25.7), id:'east-hall',label:'الممر الشرقي',x:24,z:16,kind:'hall' },
    { ...wall(0,32,26,32), id:'rear-hall',label:'الرواق الخلفي',x:16,z:29,kind:'hall' },
  ] satisfies Zone[],
};
export function zoneAt(x: number,z: number) {
  return ARENA.zones.find(a => x>=a.minX && x<=a.maxX && z>=a.minZ && z<=a.maxZ)?.label ?? 'ممر رابط';
}

export type DoorStates = Record<string,boolean>; // true = open, false = closed
export function initialDoors(): DoorStates { return Object.fromEntries(ARENA.doors.map(d => [d.id,true])); }
export function closedDoors(states: DoorStates): Wall[] { return ARENA.doors.filter(d => states[d.id] === false); }
export function doorDistance(x:number,z:number,d:Wall) { return Math.hypot(x-(d.minX+d.maxX)/2,z-(d.minZ+d.maxZ)/2); }
