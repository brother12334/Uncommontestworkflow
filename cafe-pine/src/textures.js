// Procedural PBR textures: albedo, normal and roughness maps generated once at startup.
import * as THREE from 'three';
import { mulberry32, clamp, smooth, lerp } from './util.js';

// ---------- tileable noise ----------
const TBL = (() => { const r = mulberry32(4242); const t = new Float32Array(4096); for (let i = 0; i < 4096; i++) t[i] = r(); return t; })();
function H(i, j) { return TBL[((Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0) & 4095]; }
// periodic value noise, period px × py lattice cells
export function pn(x, y, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = H(x0, y0), b = H(x1, y0), c = H(x0, y1), d = H(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// fbm over u,v in [0,1) with base periods px, py
export function pf(u, v, px, py, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += pn(u * px, v * py, px, py) * a; n += a; px *= 2; py *= 2; a *= 0.5; }
  return s / n;
}
const ridge = (n) => 1 - Math.abs(2 * n - 1);
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; }; // linear values
const toS = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055); // linear → sRGB

function dataTex(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function normalFrom(h, size, strength) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
    }
  }
  return out;
}

// fn(u, v, o) sets o.c = [r,g,b] (linear), o.h (0..1), o.ro (0..1)
export function makePBR(size, fn, { normal = 3, repeat = [1, 1] } = {}) {
  const N = size * size;
  const alb = new Uint8ClampedArray(N * 4), rough = new Uint8ClampedArray(N * 4), h = new Float32Array(N);
  const o = { c: [0.5, 0.5, 0.5], h: 0.5, ro: 0.8 };
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      o.h = 0.5; o.ro = 0.8;
      fn(x / size, v, o);
      const i = y * size + x, j = i * 4;
      alb[j] = toS(clamp(o.c[0])) * 255; alb[j + 1] = toS(clamp(o.c[1])) * 255; alb[j + 2] = toS(clamp(o.c[2])) * 255; alb[j + 3] = 255;
      const rr = clamp(o.ro) * 255;
      rough[j] = rr; rough[j + 1] = rr; rough[j + 2] = rr; rough[j + 3] = 255;
      h[i] = o.h;
    }
  }
  const strength = normal * size / 256;
  const set = {
    map: dataTex(alb, size, true),
    normalMap: dataTex(normalFrom(h, size, strength), size, false),
    roughnessMap: dataTex(rough, size, false),
  };
  for (const t of Object.values(set)) t.repeat.set(repeat[0], repeat[1]);
  return set;
}

// canvas-drawn albedo; height from luminance
function fromCanvas(canvas, { normal = 2, rough = (l) => 0.85, repeat = [1, 1], blurH = true } = {}) {
  const size = canvas.width;
  const img = canvas.getContext('2d').getImageData(0, 0, size, size).data;
  const N = size * size;
  const alb = new Uint8ClampedArray(img);
  const rgh = new Uint8ClampedArray(N * 4);
  let h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const l = (img[i * 4] * 0.3 + img[i * 4 + 1] * 0.55 + img[i * 4 + 2] * 0.15) / 255;
    h[i] = l;
    const r = clamp(rough(l)) * 255;
    rgh[i * 4] = rgh[i * 4 + 1] = rgh[i * 4 + 2] = r; rgh[i * 4 + 3] = 255;
  }
  if (blurH) {
    const b = new Float32Array(N);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = -1; k <= 1; k++) for (let m = -1; m <= 1; m++) s += h[((y + k + size) % size) * size + ((x + m + size) % size)];
      b[y * size + x] = s / 9;
    }
    h = b;
  }
  const set = {
    map: dataTex(alb, size, true),
    normalMap: dataTex(normalFrom(h, size, normal * size / 256), size, false),
    roughnessMap: dataTex(rgh, size, false),
  };
  for (const t of Object.values(set)) t.repeat.set(repeat[0], repeat[1]);
  return set;
}

function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return [c, c.getContext('2d')]; }
// draw with wrap-around so the tile is seamless
function wrapDraw(size, x, y, r, fn) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    if (x + dx < -r || x + dx > size + r || y + dy < -r || y + dy > size + r) continue;
    fn(x + dx, y + dy);
  }
}

// ---------- wood ----------
function columns(seed, tile, wMin, wMax) {
  const r = mulberry32(seed); const cols = []; let x = 0;
  while (x < 1 - 1e-6) {
    let w = (wMin + r() * (wMax - wMin)) / tile;
    if (1 - (x + w) < wMin / tile) w = 1 - x;
    cols.push({ x0: x, x1: x + w, j: [r(), r() < 0.55 ? r() : 2], t: [r(), r(), r()], s: r() * 100 });
    x += w;
  }
  return cols;
}
function findCol(cols, u) { for (const c of cols) if (u < c.x1) return c; return cols[cols.length - 1]; }

export function planksWall(size) {
  const cols = columns(5, 4, 0.09, 0.21);
  const pal = ['#C79A6A', '#A8774A', '#7A5236', '#D4B288', '#8E6440', '#B58658'].map(hex);
  return makePBR(size, (u, v, o) => {
    const c = findCol(cols, u);
    const lu = (u - c.x0) / (c.x1 - c.x0);
    const seg = (v > c.j[0] ? 1 : 0) + (v > c.j[1] ? 1 : 0);
    const base = pal[Math.floor(c.t[seg] * pal.length)];
    const warp = pf(u, v, 8, 2, 3) * 0.6;
    const grain = pf(u + warp * 0.02, v, 220, 5, 3);
    const fine = pn(u * 900, v * 20, 900, 20);
    const patch = pf(u, v, 6, 6, 3);
    const k = (0.72 + grain * 0.45 + fine * 0.08) * (0.86 + patch * 0.28);
    const wm = (c.x1 - c.x0) * 4; // width in meters
    const edge = Math.min(lu, 1 - lu) * wm;
    const jd = Math.min(Math.abs(v - c.j[0]), c.j[1] < 1 ? Math.abs(v - c.j[1]) : 1) * 4;
    const groove = smooth(0, 0.005, edge) * smooth(0, 0.003, jd);
    // nail holes near joints
    const nail = (Math.abs(lu - 0.5) < 0.04 && (Math.abs(v - c.j[0]) < 0.004)) ? 0.4 : 1;
    o.c = [base[0] * k * nail * (0.35 + 0.65 * groove), base[1] * k * nail * (0.35 + 0.65 * groove), base[2] * k * nail * (0.35 + 0.65 * groove)];
    o.h = groove * 0.7 + grain * 0.12 + patch * 0.1;
    o.ro = 0.58 + grain * 0.18 + (1 - groove) * 0.2;
  }, { normal: 2.5 });
}

export function boards(size, { tile = 2, width = 0.125, palette, gap = 0.005, seed = 9, grainScale = 1, joints = true, rough = 0.6 }) {
  const n = Math.round(tile / width);
  const pal = palette.map(hex);
  const r = mulberry32(seed);
  const rows = Array.from({ length: n }, () => ({ j: joints ? r() : 2, t: [r(), r()], k: r() * 50 }));
  return makePBR(size, (u, v, o) => {
    const fy = v * n, row = Math.floor(fy), lv = fy - row, R = rows[row];
    const seg = u > R.j ? 1 : 0;
    const base = pal[Math.floor(R.t[seg] * pal.length)];
    const warp = pf(u, v, 3, 12, 2);
    const grain = pf(u, v + warp * 0.01, Math.round(4 * grainScale), Math.round(180 * grainScale), 3);
    const fine = pn(u * 30, v * 700, 30, 700);
    const patch = pf(u, v, 4, 4, 3);
    // occasional knot
    const kx = (R.k % 1), ky = 0.5;
    const kd = Math.hypot((u - kx) * tile * 6, (lv - ky) * width * 6 / width * 0.12);
    const knot = R.k > 30 ? smooth(0.12, 0.0, kd) : 0;
    const k = (0.75 + grain * 0.4 + fine * 0.06) * (0.88 + patch * 0.24) * (1 - knot * 0.55);
    const edge = Math.min(lv, 1 - lv) * width;
    const jd = joints ? Math.abs(u - R.j) * tile : 1;
    const g = smooth(0, gap, edge) * smooth(0, gap * 0.6, jd);
    const s = 0.25 + 0.75 * g;
    o.c = [base[0] * k * s, base[1] * k * s, base[2] * k * s];
    o.h = g * 0.75 + grain * 0.12 - knot * 0.1;
    o.ro = rough + grain * 0.15 + (1 - g) * 0.25;
  }, { normal: 2.5 });
}

export function darkBeam(size) {
  const b = hex('#3A2618'), l = hex('#5A3C24');
  return makePBR(size, (u, v, o) => {
    const warp = pf(u, v, 2, 6, 2);
    const g = pf(u, v + warp * 0.03, 6, 160, 4);
    const checks = smooth(0.985, 1, pn(u * 3, v * 40, 3, 40)) * smooth(0.6, 0.7, pn(u * 40, v * 2, 40, 2));
    const k = g * (1 - checks * 0.8);
    o.c = [lerp(b[0], l[0], k) * 0.9, lerp(b[1], l[1], k) * 0.9, lerp(b[2], l[2], k) * 0.9];
    o.h = g * 0.4 - checks * 0.5;
    o.ro = 0.5 + g * 0.2;
  }, { normal: 2 });
}

export function logWood(size) {
  const pal = ['#7A5232', '#8A6040', '#6A4528', '#93694A'].map(hex);
  const grey = hex('#7C746A');
  return makePBR(size, (u, v, o) => {
    const band = pf(u, v, 2, 1, 3);
    const base = pal[Math.floor(pn(u * 2, v * 1, 2, 1) * 3.99)];
    const warp = pf(u, v, 2, 4, 2);
    const g = pf(u + warp * 0.05, v, 40, 3, 4);
    const checks = smooth(0.94, 0.99, ridge(pn(u * 18 + warp, v * 2, 18, 2))) * smooth(0.45, 0.6, pn(u * 5, v * 8, 5, 8));
    const weather = smooth(0.45, 0.75, pf(u, v, 3, 2, 4));
    const k = (0.75 + g * 0.45) * (1 - checks * 0.7);
    const c = [lerp(base[0], grey[0], weather * 0.45), lerp(base[1], grey[1], weather * 0.45), lerp(base[2], grey[2], weather * 0.45)];
    o.c = [c[0] * k, c[1] * k, c[2] * k * (0.95 + band * 0.1)];
    o.h = g * 0.35 - checks * 0.8 + band * 0.1;
    o.ro = 0.72 + g * 0.15 + weather * 0.1;
  }, { normal: 3, repeat: [1, 3] });
}

export function walnut(size) {
  const a = hex('#4A2C18'), b = hex('#7A5030'), sap = hex('#B8946A');
  return makePBR(size, (u, v, o) => {
    const warp = pf(u, v, 2, 2, 4);
    const rings = Math.sin((v * 2 + warp * 1.6 + pf(u, v, 3, 1, 2) * 0.3) * Math.PI * 22) * 0.5 + 0.5;
    const fine = pf(u, v, 300, 8, 2);
    const k = rings * 0.6 + fine * 0.4;
    const c = [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    const sw = smooth(0.06, 0.0, Math.min(v, 1 - v)) * 0.6; // sapwood streak toward edges
    o.c = [lerp(c[0], sap[0], sw), lerp(c[1], sap[1], sw), lerp(c[2], sap[2], sw)];
    o.h = rings * 0.15 + fine * 0.15;
    o.ro = 0.32 + fine * 0.12;
  }, { normal: 1.2 });
}

export function bark(size, kind) {
  const pine = kind === 'pine';
  const top = hex(pine ? '#5A4A3E' : '#7A766C'), fur = hex(pine ? '#2A201A' : '#4C4840'), red = hex('#6E4A36');
  return makePBR(size, (u, v, o) => {
    const w = pf(u, v, 3, 2, 3);
    const n = pf(u + w * 0.1, v, pine ? 7 : 14, pine ? 3 : 2, 4);
    const plates = Math.pow(ridge(n), pine ? 1.6 : 3);
    const fine = pf(u, v, 60, 30, 2);
    const lichen = pine ? 0 : smooth(0.62, 0.7, pf(u, v, 5, 5, 4)) * 0.5;
    let c = [lerp(fur[0], top[0], plates), lerp(fur[1], top[1], plates), lerp(fur[2], top[2], plates)];
    if (pine) { const rr = smooth(0.4, 0.15, plates) * 0.6; c = [lerp(c[0], red[0], rr), lerp(c[1], red[1], rr), lerp(c[2], red[2], rr)]; }
    const k = 0.8 + fine * 0.4;
    o.c = [lerp(c[0] * k, 0.33, lichen), lerp(c[1] * k, 0.38, lichen), lerp(c[2] * k, 0.24, lichen)];
    o.h = plates * 0.8 + fine * 0.2;
    o.ro = 0.88 + fine * 0.1;
  }, { normal: pine ? 5 : 3, repeat: [1, 4] });
}

// ---------- stone, masonry ----------
export function stone(size) {
  return makePBR(size, (u, v, o) => {
    const n = pf(u, v, 4, 4, 6);
    const grain = pn(u * 400, v * 400, 400, 400);
    const vein = smooth(0.48, 0.5, pf(u, v, 3, 5, 3)) * smooth(0.52, 0.5, pf(u, v, 3, 5, 3));
    const k = 0.72 + n * 0.35 + (grain - 0.5) * 0.18 - vein * 0.15;
    o.c = [0.62 * k, 0.55 * k, 0.47 * k];
    o.h = n * 0.8 + grain * 0.15;
    o.ro = 0.78 + grain * 0.15;
  }, { normal: 4 });
}

export function mortar(size) {
  const c0 = hex('#8F877A');
  return makePBR(size, (u, v, o) => {
    const n = pf(u, v, 8, 8, 4), g = pn(u * 300, v * 300, 300, 300);
    const k = 0.75 + n * 0.3 + (g - 0.5) * 0.25;
    o.c = [c0[0] * k, c0[1] * k, c0[2] * k];
    o.h = n * 0.5 + g * 0.5; o.ro = 0.95;
  }, { normal: 3 });
}

export function blocks(size) {
  const c0 = hex('#56534D');
  return makePBR(size, (u, v, o) => {
    const rows = 5, cols = 2.5, fy = v * rows, row = Math.floor(fy);
    const fx = u * cols + (row % 2) * 0.5, lx = fx - Math.floor(fx), ly = fy - row;
    const e = Math.min(lx * 0.8, (1 - lx) * 0.8, ly * 0.4, (1 - ly) * 0.4);
    const j = smooth(0, 0.012, e);
    const n = pf(u, v, 10, 10, 4);
    const k = (0.7 + n * 0.4) * (0.6 + 0.4 * j);
    o.c = [c0[0] * k, c0[1] * k, c0[2] * k];
    o.h = j * 0.6 + n * 0.3; o.ro = 0.92;
  }, { normal: 3 });
}

// ---------- roofing ----------
export function shingles(size) {
  const rows = 14;
  const r = mulberry32(21);
  const tabs = Array.from({ length: rows }, () => { const a = []; let x = r() * 0.1; while (x < 1) { const w = 0.08 + r() * 0.12; a.push([x, x + w, r()]); x += w; } return a; });
  return makePBR(size, (u, v, o) => {
    const fy = v * rows, row = Math.floor(fy), lv = fy - row;
    let tab = null; for (const t of tabs[row]) if ((u >= t[0] && u < t[1]) || (u + 1 >= t[0] && u + 1 < t[1])) { tab = t; break; }
    if (!tab) tab = tabs[row][0];
    const lu = ((u - tab[0] + 1) % 1) / (tab[1] - tab[0]);
    const slot = smooth(0, 0.02, Math.min(lu, 1 - lu) * (tab[1] - tab[0]) * 2);
    const gran = pn(u * 500, v * 500, 500, 500);
    const tone = 0.18 + tab[2] * 0.1;
    const shade = lerp(0.55, 1.0, smooth(0.0, 0.25, lv)) * (0.55 + 0.45 * slot);
    const k = tone * shade * (0.8 + gran * 0.4);
    o.c = [k * 1.02, k, k * 0.95];
    o.h = lv * 0.6 * slot + gran * 0.15;
    o.ro = 0.86 + gran * 0.1;
  }, { normal: 4 });
}

export function metalSeam(size) {
  const c0 = hex('#6F8C8A');
  return makePBR(size, (u, v, o) => {
    const seams = 5, fx = u * seams, lx = fx - Math.floor(fx);
    const ridgeH = smooth(0.025, 0.0, Math.abs(lx - 0.5)) ;
    const pan = pf(u, v, 2, 3, 3) * 0.15;
    const streak = pf(u, v, 40, 2, 3);
    const k = 0.86 + streak * 0.2 - smooth(0.6, 0.8, streak) * 0.15;
    o.c = [c0[0] * k, c0[1] * k, c0[2] * k];
    o.h = ridgeH * 0.9 + pan;
    o.ro = 0.38 + streak * 0.2;
  }, { normal: 5 });
}

// ---------- textiles, leather ----------
export function leather(size, tufted) {
  const c0 = hex('#5A3A24'), dark = hex('#2E1C12'), wear = hex('#8A5E3C');
  const N = 3; // diamonds per tile
  return makePBR(size, (u, v, o) => {
    const mott = pf(u, v, 6, 6, 5);
    const wr = pf(u, v, 24, 24, 3);
    let pillow = 1, crease = 0, button = 0;
    if (tufted) {
      const a = (u + v) * N, b = (u - v + 1) * N;
      const fa = a - Math.floor(a), fb = b - Math.floor(b);
      const da = Math.min(fa, 1 - fa), db = Math.min(fb, 1 - fb);
      const d = Math.min(Math.hypot(da, db), 0.5);
      pillow = smooth(0.0, 0.45, Math.min(da, db) * 2.2);
      button = smooth(0.05, 0.02, d);
      crease = smooth(0.06, 0.0, Math.min(da, db)) * (1 - button);
    }
    const wrinkle = ridge(pn(u * 30, v * 60, 30, 60)) * 0.25;
    let k = 0.75 + mott * 0.45;
    let c = [c0[0] * k, c0[1] * k, c0[2] * k];
    const w = smooth(0.55, 0.8, pillow * 0.7 + mott * 0.5) * 0.45;
    c = [lerp(c[0], wear[0], w), lerp(c[1], wear[1], w), lerp(c[2], wear[2], w)];
    const dk = crease * 0.7 + button * 0.8;
    o.c = [lerp(c[0], dark[0], dk), lerp(c[1], dark[1], dk), lerp(c[2], dark[2], dk)];
    o.h = (tufted ? pillow * 0.8 - button * 0.5 : 0.5) + wrinkle * (tufted ? 0.2 : 0.6) + wr * 0.08;
    o.ro = 0.42 + crease * 0.25 + (1 - pillow) * 0.1 + wr * 0.12;
  }, { normal: tufted ? 4 : 2 });
}

export function fabric(size, color, { pile = 300, rough = 0.95, var: vr = 0.25 } = {}) {
  const c0 = hex(color);
  return makePBR(size, (u, v, o) => {
    const f = pn(u * pile, v * pile, pile, pile), m = pf(u, v, 4, 4, 3);
    const k = 1 - vr / 2 + f * vr * 0.6 + m * vr * 0.4;
    o.c = [c0[0] * k, c0[1] * k, c0[2] * k];
    o.h = f; o.ro = rough;
  }, { normal: 1 });
}

export function rug(size) {
  const cream = hex('#D9CFBD'), band = hex('#8C7A62'), rust = hex('#9A5A3A');
  const t = makePBR(size, (u, v, o) => {
    const weave = (Math.sin(u * size * 0.9) * Math.sin(v * size * 0.9)) * 0.5 + 0.5;
    const m = pf(u, v, 5, 5, 3);
    const e = Math.min(u, 1 - u, v, 1 - v);
    let c = cream;
    if (e < 0.08 && e > 0.05) c = band;
    else if (e < 0.04 && e > 0.03) c = rust;
    else if (e >= 0.08 && e < 0.1 && (Math.floor((u + v) * 40) % 2 === 0)) c = band;
    const k = 0.85 + weave * 0.15 + m * 0.1;
    o.c = [c[0] * k, c[1] * k, c[2] * k];
    o.h = weave; o.ro = 0.97;
  }, { normal: 1.5 });
  for (const x of Object.values(t)) { x.wrapS = x.wrapT = THREE.ClampToEdgeWrapping; }
  return t;
}

// ---------- ground ----------
export function forestFloor(size) {
  const [c, x] = canvas(size);
  const r = mulberry32(99);
  x.fillStyle = '#3B2E22'; x.fillRect(0, 0, size, size);
  // soil mottling
  for (let i = 0; i < 260; i++) {
    const px = r() * size, py = r() * size, rad = (10 + r() * 40) * size / 1024;
    wrapDraw(size, px, py, rad, (X, Y) => {
      const g = x.createRadialGradient(X, Y, 0, X, Y, rad);
      g.addColorStop(0, r() < 0.5 ? 'rgba(70,56,40,.5)' : 'rgba(40,30,22,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(X, Y, rad, 0, 7); x.fill();
    });
  }
  const needleCols = ['#8A5A32', '#6E4A2C', '#A07040', '#5A3E26', '#7E6038', '#B08050'];
  x.lineCap = 'round';
  for (let i = 0; i < 9000 * (size / 1024) ** 2; i++) {
    const px = r() * size, py = r() * size, a = r() * Math.PI * 2, len = (14 + r() * 20) * size / 1024;
    x.strokeStyle = needleCols[Math.floor(r() * needleCols.length)];
    x.lineWidth = (1 + r() * 1.2) * size / 1024;
    wrapDraw(size, px, py, len, (X, Y) => { x.beginPath(); x.moveTo(X, Y); x.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len); x.stroke(); });
  }
  const leafCols = ['#6B5A2E', '#8A6A32', '#7A4A26', '#5E5A30', '#9A7A3A'];
  for (let i = 0; i < 420 * (size / 1024) ** 2; i++) {
    const px = r() * size, py = r() * size, a = r() * Math.PI, s = (8 + r() * 12) * size / 1024;
    x.fillStyle = leafCols[Math.floor(r() * leafCols.length)];
    wrapDraw(size, px, py, s * 2, (X, Y) => { x.save(); x.translate(X, Y); x.rotate(a); x.beginPath(); x.ellipse(0, 0, s, s * 0.55, 0, 0, 7); x.fill(); x.restore(); });
  }
  for (let i = 0; i < 70 * (size / 1024) ** 2; i++) {
    const px = r() * size, py = r() * size, rad = (6 + r() * 22) * size / 1024;
    x.fillStyle = `rgba(${70 + r() * 20},${86 + r() * 20},${40},${0.5 + r() * 0.4})`;
    wrapDraw(size, px, py, rad, (X, Y) => { x.beginPath(); x.arc(X, Y, rad, 0, 7); x.fill(); });
  }
  return fromCanvas(c, { normal: 3, rough: (l) => 0.92 - l * 0.1 });
}

export function gravel(size) {
  const [c, x] = canvas(size);
  const r = mulberry32(7);
  x.fillStyle = '#5E5850'; x.fillRect(0, 0, size, size);
  const cols = ['#B9B2A4', '#9E978A', '#CFC8BA', '#7E776C', '#A89F90', '#8C8477', '#C4B8A2'];
  const n = 9000 * (size / 1024) ** 2;
  for (let i = 0; i < n; i++) {
    const px = r() * size, py = r() * size, s = (3 + r() * 7) * size / 1024, a = r() * Math.PI;
    const col = cols[Math.floor(r() * cols.length)];
    wrapDraw(size, px, py, s * 2, (X, Y) => {
      x.save(); x.translate(X, Y); x.rotate(a);
      const g = x.createRadialGradient(-s * 0.3, -s * 0.3, 0, 0, 0, s * 1.2);
      g.addColorStop(0, '#E8E2D6'); g.addColorStop(0.25, col); g.addColorStop(1, '#4A443C');
      x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, s, s * (0.6 + r() * 0.3), 0, 0, 7); x.fill();
      x.restore();
    });
  }
  return fromCanvas(c, { normal: 4, rough: (l) => 0.85 });
}

// ---------- foliage cards (alpha) ----------
function cardTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function needleCard(size, seed = 3) {
  const [c, x] = canvas(size);
  const r = mulberry32(seed);
  x.lineCap = 'round';
  const S = size / 512;
  // twig from bottom center
  x.strokeStyle = '#4A3826'; x.lineWidth = 5 * S;
  x.beginPath(); x.moveTo(256 * S, 512 * S); x.quadraticCurveTo(250 * S, 300 * S, 262 * S, 60 * S); x.stroke();
  const greens = ['#3E5A40', '#4E6E4E', '#5C7A50', '#36503A', '#6A8656', '#4A6448'];
  for (let i = 0; i < 95; i++) {
    const t = 0.08 + r() * 0.9;
    const bx = (256 + (r() - 0.5) * 14) * S, by = (512 - t * 450) * S;
    const side = r() < 0.5 ? -1 : 1;
    const ang = -Math.PI / 2 + side * (0.35 + r() * 0.9) * (1 - t * 0.4);
    const len = (90 + r() * 110) * S * (1 - t * 0.35);
    x.strokeStyle = greens[Math.floor(r() * greens.length)];
    for (let k = 0; k < 5; k++) {
      const a = ang + (r() - 0.5) * 0.35;
      const l = len * (0.8 + r() * 0.3);
      const ex = bx + Math.cos(a) * l, ey = by + Math.sin(a) * l;
      x.lineWidth = (1.6 + r() * 1.2) * S;
      x.beginPath(); x.moveTo(bx, by);
      x.quadraticCurveTo(bx + Math.cos(a) * l * 0.5 + side * 8 * S, by + Math.sin(a) * l * 0.5 + 10 * S, ex, ey + 14 * S);
      x.stroke();
    }
  }
  return cardTex(c);
}

function leafPath(x, s, lobes) {
  x.beginPath();
  if (lobes === 5) { // maple
    const pts = [[0, 0], [-0.18, -0.12], [-0.5, -0.1], [-0.38, -0.32], [-0.52, -0.55], [-0.24, -0.5], [-0.15, -0.8], [0, -0.62], [0.15, -0.8], [0.24, -0.5], [0.52, -0.55], [0.38, -0.32], [0.5, -0.1], [0.18, -0.12]];
    pts.forEach(([a, b], i) => (i ? x.lineTo(a * s, b * s) : x.moveTo(a * s, b * s)));
  } else { // oak-ish lobed oval
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      const rr = 0.5 + Math.sin(t * 7) * 0.06;
      x.lineTo(Math.sin(t) * rr * 0.55 * s, (-0.5 - Math.cos(t) * rr) * s);
    }
  }
  x.closePath();
}

export function leafCard(size, seed = 11, autumn = false) {
  const [c, x] = canvas(size);
  const r = mulberry32(seed);
  const S = size / 512;
  x.lineCap = 'round';
  x.strokeStyle = '#4E3A28'; x.lineWidth = 4 * S;
  x.beginPath(); x.moveTo(256 * S, 512 * S); x.quadraticCurveTo(230 * S, 280 * S, 270 * S, 40 * S); x.stroke();
  const greens = autumn ? ['#B8782E', '#C08A36', '#9A6A2A', '#7C8F3A', '#A84E22'] : ['#4E6B2E', '#5E7A34', '#6A8638', '#466028', '#7C8F3A', '#56722F'];
  for (let i = 0; i < 26; i++) {
    const t = 0.06 + r() * 0.92;
    const bx = (256 + (r() - 0.5) * 30) * S, by = (512 - t * 470) * S;
    const a = (r() - 0.5) * 2.6;
    const s = (95 + r() * 60) * S;
    x.save(); x.translate(bx, by); x.rotate(a);
    x.strokeStyle = '#4A5A2A'; x.lineWidth = 2 * S;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -s * 0.25); x.stroke();
    x.translate(0, -s * 0.22);
    const col = greens[Math.floor(r() * greens.length)];
    const g = x.createLinearGradient(-s * 0.4, 0, s * 0.4, -s);
    g.addColorStop(0, col); g.addColorStop(1, shade(col, 1.18));
    x.fillStyle = g;
    leafPath(x, s, r() < 0.65 ? 5 : 7);
    x.fill();
    x.strokeStyle = shade(col, 0.75); x.lineWidth = 1.2 * S;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -s * 0.75);
    for (const sgn of [-1, 1]) { x.moveTo(0, -s * 0.12); x.lineTo(sgn * s * 0.35, -s * 0.45); x.moveTo(0, -s * 0.3); x.lineTo(sgn * s * 0.25, -s * 0.62); }
    x.stroke();
    x.restore();
  }
  return cardTex(c);
}
function shade(hexs, k) {
  const c = new THREE.Color(hexs); c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
  return '#' + c.getHexString();
}

export function fernCard(size) {
  const [c, x] = canvas(size);
  const S = size / 512;
  x.strokeStyle = '#4E6A30'; x.lineWidth = 3 * S;
  x.beginPath(); x.moveTo(256 * S, 510 * S); x.quadraticCurveTo(250 * S, 250 * S, 300 * S, 20 * S); x.stroke();
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const px = (256 + t * 40 * t) * S, py = (500 - t * 470) * S;
    const len = (150 * Math.sin((1 - t) * Math.PI * 0.85 + 0.2)) * S;
    for (const sgn of [-1, 1]) {
      x.save(); x.translate(px, py); x.rotate(sgn * 1.25 - 0.1);
      for (let k = 0; k < 9; k++) {
        const kk = k / 9;
        x.fillStyle = k % 2 ? '#5E7E36' : '#6C8C3E';
        x.beginPath(); x.ellipse(0, -kk * len, len * 0.09 * (1 - kk * 0.6), len * 0.06, 0.5, 0, 7); x.fill();
      }
      x.restore();
    }
  }
  return cardTex(c);
}

export function signTex() {
  const [c, x] = canvas(512);
  c.height = 160;
  const g = x.createLinearGradient(0, 0, 0, 160);
  g.addColorStop(0, '#6B4A30'); g.addColorStop(1, '#4E3420');
  x.fillStyle = g; x.fillRect(0, 0, 512, 160);
  for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(30,18,10,${0.08 + (i % 5) * 0.03})`; x.beginPath(); x.moveTo(0, i * 4 + Math.sin(i) * 3); x.bezierCurveTo(170, i * 4 + 6, 340, i * 4 - 6, 512, i * 4 + Math.cos(i) * 3); x.stroke(); }
  x.font = '800 74px "Bricolage Grotesque", Georgia, serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(20,12,6,.8)'; x.fillText('CAFE PINE', 258, 84);
  x.fillStyle = '#E9D9B8'; x.fillText('CAFE PINE', 256, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function latticeTex() {
  const [c, x] = canvas(256);
  x.clearRect(0, 0, 256, 256);
  x.strokeStyle = '#1E1C1A'; x.lineWidth = 22;
  for (let i = -256; i <= 512; i += 64) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 256, 256); x.stroke();
    x.beginPath(); x.moveTo(i + 256, 0); x.lineTo(i, 256); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function emberTex() {
  const [c, x] = canvas(256);
  x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
  const r = mulberry32(13);
  for (let i = 0; i < 90; i++) {
    x.strokeStyle = `rgba(255,${100 + r() * 90},${30 + r() * 30},${0.4 + r() * 0.6})`;
    x.lineWidth = 1 + r() * 2.5;
    x.beginPath(); let px = r() * 256, py = r() * 256; x.moveTo(px, py);
    for (let k = 0; k < 4; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
