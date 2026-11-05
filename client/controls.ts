/** Rotate view-relative intent into authoritative world axes (camera looks down -Z). */
export function worldDirection(x: number, z: number, yaw: number) {
  return { x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) };
}
export function wrapYaw(yaw: number) { return Math.atan2(Math.sin(yaw), Math.cos(yaw)); }
