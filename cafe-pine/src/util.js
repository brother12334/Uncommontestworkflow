export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm2(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, y * f) * a; f *= 2.03; a *= 0.5; }
  return s;
}

// distance from point to segment in xz
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// the gravel drive, as a polyline in xz
export const DRIVE = [[-16, 44], [-13.5, 30], [-10.5, 20], [-8.6, 13], [-8.2, 8], [-8.6, 4.5]];
export function driveDist(x, z) {
  let d = Infinity;
  for (let i = 0; i < DRIVE.length - 1; i++) d = Math.min(d, segDist(x, z, DRIVE[i][0], DRIVE[i][1], DRIVE[i + 1][0], DRIVE[i + 1][1]));
  return d;
}

// gentle terrain: flat around the cabin, rolling beyond
export function groundHeight(x, z) {
  const r = Math.hypot(x + 1, z - 2);
  const n = vnoise(x * 0.035, z * 0.035) * 2.2 + vnoise(x * 0.09, z * 0.09) * 0.7;
  const roll = (n - 1.45) * 1.8 * smooth(22, 55, r);
  const lawn = -0.012 * Math.max(0, z - 6) * smooth(30, 12, r); // lawn falls gently toward the drive
  return roll + lawn;
}
