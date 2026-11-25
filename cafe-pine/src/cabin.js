// The log cabin exterior: log walls, roofs, deck, stairs, windows, door, porch lights, chimney.
import * as THREE from 'three';
import { mulberry32, groundHeight } from './util.js';
import { scaleUV } from './forest.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const L = {
  FLOOR: 1.4, EAVE: 4.4, RIDGE: 7.9,
  X0: -4.5, X1: 4.5, Z0: -7, Z1: 4,
  WX0: -8, WZ0: -5, WZ1: 1, WEAVE: 4.1, WRIDGE: 5.3,
  DECK_Z: 6.2, DECK_X: 6.7, RDECK_Z0: -0.5,
  door: { x0: 0.82, x1: 1.78, h: 2.05 },
  STAIR: { x0: -3.3, x1: -2.1 },
  RSTAIR: { z0: 2.4, z1: 3.6 },
  pitch: Math.atan2(7.9 - 4.4, 4.5),
};

// box whose long axis is x, with UVs scaled so wood grain runs along it
export function beam(len, h, d, mat, tile = 2) {
  const g = new THREE.BoxGeometry(len, h, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    // faces 0,1 are ±x (end grain): keep small
    const su = face < 2 ? d / tile : len / tile, sv = face < 2 ? h / tile : (face < 4 ? d : h) / tile;
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// quad from four corners with explicit UV extents
export function quad(p0, p1, p2, p3, U, Vv, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p0.toArray(), ...p1.toArray(), ...p2.toArray(), ...p3.toArray()], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, U, 0, U, Vv, 0, Vv], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------- stones (fireplace + chimney) ----------
export function rockGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1, 5, 4, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const len = Math.hypot(x * 1.0, y * 1.0, z * 1.6);
    const k = 0.62 / Math.max(0.3, len);
    x = x * 0.55 + x * k * 0.45; y = y * 0.55 + y * k * 0.45;
    const n = 1 + Math.sin(x * 9 + y * 5) * 0.04 + Math.sin(y * 13 - x * 4) * 0.03;
    z = (z + 0.5) * (0.6 + 0.4 * (1 - Math.min(1, Math.abs(x) * 1.6 + Math.abs(y) * 1.2) * 0.5)) - 0.5;
    p.setXYZ(i, x * n, y * n, z);
  }
  g.computeVertexNormals();
  return g;
}

export function placeStones(list, rand, origin, uAx, vAx, nAx, W, Ht, holes = []) {
  let y = 0;
  while (y < Ht - 0.05) {
    const h = Math.min(0.12 + rand() * 0.16, Ht - y);
    let x = -rand() * 0.15;
    while (x < W) {
      const w = Math.min(0.18 + rand() * 0.3, W - x + 0.05);
      const cx = x + w / 2, cy = y + h / 2;
      const inHole = holes.some(([a, b, c, d]) => cx > a - 0.05 && cx < b + 0.05 && cy > c - 0.05 && cy < d + 0.05);
      if (!inHole && w > 0.06) {
        const depth = 0.08 + rand() * 0.08;
        const pos = origin.clone().addScaledVector(uAx, cx).addScaledVector(vAx, cy).addScaledVector(nAx, depth * 0.35);
        list.push({ pos, u: uAx, v: vAx, n: nAx, w: w - 0.025, h: h - 0.025, d: depth, roll: (rand() - 0.5) * 0.12, tone: rand() });
      }
      x += w;
    }
    y += h;
  }
}

export function stoneMesh(list, T, rand) {
  const geo = rockGeometry();
  const mat = new THREE.MeshStandardMaterial({ ...T.stone, roughness: 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), b = new THREE.Matrix4(), s = new THREE.Matrix4(), rz = new THREE.Matrix4(), c = new THREE.Color();
  const tones = ['#8C7A66', '#6E6458', '#9A8A74', '#5E5247', '#A39582', '#7A6A5A', '#8A8072'].map((h) => new THREE.Color(h));
  list.forEach((st, i) => {
    b.makeBasis(st.u, st.v, st.n).setPosition(st.pos);
    rz.makeRotationZ(st.roll);
    s.makeScale(st.w, st.h, st.d);
    m.copy(b).multiply(rz).multiply(s);
    mesh.setMatrixAt(i, m);
    c.copy(tones[Math.floor(st.tone * tones.length)]).multiplyScalar(0.85 + rand() * 0.3);
    mesh.setColorAt(i, c);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------- the cabin ----------
export function buildCabin(scene, T, { mats }) {
  const r = mulberry32(31);
  const group = new THREE.Group();
  scene.add(group);
  const { FLOOR, EAVE, RIDGE, X0, X1, Z0, Z1 } = L;

  const logMat = new THREE.MeshStandardMaterial({ ...T.log, roughness: 1 });
  const chinkMat = new THREE.MeshStandardMaterial({ color: '#3A2E24', roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({ ...T.beam, color: '#6A5A4A', roughness: 1 });
  const black = new THREE.MeshStandardMaterial({ color: '#1C1B1A', roughness: 0.55, metalness: 0.1 });
  const deckMat = new THREE.MeshStandardMaterial({ ...T.deck, roughness: 1 });
  const shingleMat = new THREE.MeshStandardMaterial({ ...T.shingles, roughness: 1 });
  const metalMat = new THREE.MeshStandardMaterial({ ...T.metal, roughness: 1, metalness: 0.55 });
  const soffitMat = new THREE.MeshStandardMaterial({ ...T.ceiling, roughness: 1, color: '#B8A080' });
  const blockMat = new THREE.MeshStandardMaterial({ ...T.blocks, roughness: 1 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#1E2629', roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.38, depthWrite: false, emissive: new THREE.Color('#FFB36B'), emissiveIntensity: 0, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  mats.push(logMat, trimMat, black, deckMat, shingleMat, metalMat, soffitMat, blockMat, glassMat, chinkMat);

  // ---------- log walls ----------
  const logs = [];
  const RAD = 0.108;
  function row(axis, fixed, a0, a1, y, holes) {
    let segs = [[a0, a1]];
    for (const h of holes) {
      if (y < h.y0 - RAD || y > h.y1 + RAD) continue;
      const next = [];
      for (const [s, e] of segs) {
        if (h.a1 <= s || h.a0 >= e) { next.push([s, e]); continue; }
        if (h.a0 > s) next.push([s, h.a0]);
        if (h.a1 < e) next.push([h.a1, e]);
      }
      segs = next;
    }
    for (const [s, e] of segs) if (e - s > 0.05) logs.push({ axis, fixed, a0: s, a1: e, y, r: RAD * (0.94 + r() * 0.12) });
  }
  const frontHoles = [
    { a0: L.door.x0 - 0.06, a1: L.door.x1 + 0.06, y0: FLOOR, y1: FLOOR + L.door.h + 0.06 },
    { a0: -2.66, a1: -0.84, y0: FLOOR + 0.84, y1: FLOOR + 2.16 },
    { a0: -0.66, a1: 0.66, y0: 5.04, y1: 6.16 },
  ];
  const rightHoles = [{ a0: 1.04, a1: 2.36, y0: FLOOR + 0.84, y1: FLOOR + 2.06 }];
  const backHoles = [{ a0: 2.34, a1: 3.46, y0: FLOOR + 0.94, y1: FLOOR + 2.06 }];
  const wingFrontHoles = [{ a0: -7.26, a1: -5.74, y0: FLOOR + 0.84, y1: FLOOR + 2.06 }];
  for (let i = 0; i < 15; i++) {
    const y = FLOOR + 0.11 + i * 0.2;
    row('x', Z1, X0 - 0.32, X1 + 0.32, y, frontHoles);
    row('x', Z0, X0 - 0.32, X1 + 0.32, y, backHoles);
    const y2 = y + 0.1;
    row('z', X1, Z0 - 0.32, Z1 + 0.32, y2, rightHoles);
    row('z', X0, Z0 - 0.32, Z1 + 0.32, y2, []);
  }
  for (let y = EAVE + 0.11; y < RIDGE - 0.15; y += 0.2) {
    const hl = 4.5 * (RIDGE - y) / (RIDGE - EAVE) - 0.04;
    row('x', Z1, -hl, hl, y, frontHoles);
    row('x', Z0, -hl, hl, y, []);
  }
  // wing
  for (let i = 0; i < 14; i++) {
    const y = FLOOR + 0.11 + i * 0.2;
    if (y > L.WEAVE) break;
    row('x', L.WZ1, L.WX0 - 0.32, X0 - 0.1, y, wingFrontHoles);
    row('x', L.WZ0, L.WX0 - 0.32, X0 - 0.1, y, []);
    row('z', L.WX0, L.WZ0 - 0.32, L.WZ1 + 0.32, y + 0.1, [{ a0: -2.6, a1: -1.4, y0: FLOOR + 0.84, y1: FLOOR + 2.06 }]);
  }
  for (let y = L.WEAVE + 0.11; y < L.WRIDGE - 0.1; y += 0.2) {
    const hl = 1.75 * (L.WRIDGE - y) / (L.WRIDGE - L.WEAVE) - 0.04;
    row('x', L.WZ1, -6.25 - hl, -6.25 + hl, y, []);
    row('x', L.WZ0, -6.25 - hl, -6.25 + hl, y, []);
  }
  {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 18, 1).rotateZ(Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, logMat, logs.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
    logs.forEach((lg, i) => {
      const mid = (lg.a0 + lg.a1) / 2, len = lg.a1 - lg.a0;
      const pos = lg.axis === 'x' ? V(mid, lg.y, lg.fixed) : V(lg.fixed, lg.y, mid);
      q.setFromAxisAngle(V(0, 1, 0), lg.axis === 'x' ? 0 : Math.PI / 2);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), r() * 6.28));
      m.compose(pos, q, s.set(len, lg.r, lg.r));
      mesh.setMatrixAt(i, m);
      const k = 0.82 + r() * 0.3; c.setRGB(k, k * (0.97 + r() * 0.05), k * (0.94 + r() * 0.06));
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  // chinking slabs behind the logs
  function slab(shapePts, holes, depth, pos, rotY) {
    const sh = new THREE.Shape(shapePts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of holes) sh.holes.push(new THREE.Path([new THREE.Vector2(h[0], h[2]), new THREE.Vector2(h[1], h[2]), new THREE.Vector2(h[1], h[3]), new THREE.Vector2(h[0], h[3])]));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
    const m = new THREE.Mesh(g, chinkMat);
    m.position.copy(pos); m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  const gable = [[X0, FLOOR], [X1, FLOOR], [X1, EAVE], [0, RIDGE - 0.1], [X0, EAVE]];
  slab(gable, frontHoles.map((h) => [h.a0, h.a1, h.y0, h.y1]), 0.14, V(0, 0, Z1), 0);
  slab(gable, backHoles.map((h) => [h.a0, h.a1, h.y0, h.y1]), 0.14, V(0, 0, Z0), 0);
  slab([[Z0, FLOOR], [Z1, FLOOR], [Z1, EAVE + 0.05], [Z0, EAVE + 0.05]], rightHoles.map((h) => [h.a0, h.a1, h.y0, h.y1]), 0.14, V(X1, 0, 0), -Math.PI / 2);
  slab([[Z0, FLOOR], [Z1, FLOOR], [Z1, EAVE + 0.05], [Z0, EAVE + 0.05]], [], 0.14, V(X0, 0, 0), -Math.PI / 2);
  const wg = [[L.WX0, FLOOR], [X0, FLOOR], [X0, L.WEAVE], [-6.25, L.WRIDGE - 0.08], [L.WX0, L.WEAVE]];
  slab(wg, wingFrontHoles.map((h) => [h.a0, h.a1, h.y0, h.y1]), 0.14, V(0, 0, L.WZ1), 0);
  slab(wg, [], 0.14, V(0, 0, L.WZ0), 0);
  slab([[L.WZ0, FLOOR], [L.WZ1, FLOOR], [L.WZ1, L.WEAVE], [L.WZ0, L.WEAVE]], [[-2.6, -1.4, FLOOR + 0.84, FLOOR + 2.06]], 0.14, V(L.WX0, 0, 0), -Math.PI / 2);

  // ---------- foundation ----------
  {
    const f = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(9.3, FLOOR + 0.2, 11.3), 2.3, 0.4), blockMat);
    f.position.set(0, (FLOOR + 0.2) / 2 - 0.2, (Z0 + Z1) / 2);
    const w = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(3.7, FLOOR + 0.2, 6.3), 1, 0.4), blockMat);
    w.position.set(-6.25, (FLOOR + 0.2) / 2 - 0.2, -2);
    f.receiveShadow = w.receiveShadow = true;
    group.add(f, w);
  }

  // ---------- roofs ----------
  function roof(cx, ridgeY, halfW, eaveY, z0, z1, overhang, mat, ridgeMat) {
    const pitch = Math.atan2(ridgeY - eaveY, halfW);
    const run = halfW + overhang;
    const slope = run / Math.cos(pitch);
    const len = z1 - z0 + overhang * 2;
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(len, 0.16, slope);
      // UVs: top face rows run along the slope
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        const su = face === 2 || face === 3 ? len / 2 : 0.2, sv = face === 2 || face === 3 ? slope / 2 : 0.2;
        uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      }
      const m = new THREE.Mesh(g, [trimMat, trimMat, mat, soffitMat, trimMat, trimMat]);
      m.rotation.order = 'YXZ';
      m.rotation.y = Math.PI / 2;
      m.rotation.x = side * pitch;
      const midRun = run / 2;
      m.position.set(cx + side * midRun, ridgeY + 0.22 - Math.tan(pitch) * midRun, (z0 + z1) / 2);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    const cap = beam(len, 0.1, 0.34, ridgeMat);
    cap.rotation.y = Math.PI / 2;
    cap.position.set(cx, ridgeY + 0.3, (z0 + z1) / 2);
    group.add(cap);
  }
  roof(0, RIDGE, 4.5, EAVE, Z0, Z1, 0.7, shingleMat, black);
  roof(-6.25, L.WRIDGE, 1.75, L.WEAVE, L.WZ0, L.WZ1, 0.45, metalMat, metalMat);

  // ---------- windows + door ----------
  const windows = [];
  function windowAt(cx, cy, w, h, pos, rotY) {
    const g = new THREE.Group();
    const t = 0.08;
    const frame = [
      [w + t * 2, t, 0, h / 2 + t / 2], [w + t * 2, t * 1.4, 0, -h / 2 - t * 0.7],
      [t, h, -w / 2 - t / 2, 0], [t, h, w / 2 + t / 2, 0], [0.04, h, 0, 0], [w, 0.04, 0, 0],
    ];
    for (const [a, b, x, y] of frame) {
      const m = beam(a, b, 0.07, trimMat, 1);
      m.position.set(x, y, 0.13);
      g.add(m);
    }
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    g.add(glass);
    g.position.copy(pos); g.position.x += cx * Math.cos(rotY); g.position.z -= cx * Math.sin(rotY); g.position.y = cy;
    g.rotation.y = rotY;
    group.add(g);
    windows.push(glass);
  }
  windowAt(-1.75, FLOOR + 1.5, 1.7, 1.2, V(0, 0, Z1), 0);
  windowAt(0, 5.6, 1.2, 1.0, V(0, 0, Z1), 0);
  windowAt(-2.9, FLOOR + 1.5, 1.0, 1.0, V(0, 0, Z0), Math.PI);
  windowAt(-6.5, FLOOR + 1.45, 1.4, 1.1, V(0, 0, L.WZ1), 0);
  windowAt(-1.7, FLOOR + 1.45, 1.2, 1.1, V(X1, 0, 0), Math.PI / 2);
  windowAt(-2.0, FLOOR + 1.45, 1.1, 1.1, V(L.WX0, 0, 0), -Math.PI / 2);

  // door frame + leaf on a hinge
  {
    const { x0, x1, h } = L.door;
    const w = x1 - x0;
    for (const [a, b, x, y] of [[w + 0.2, 0.1, (x0 + x1) / 2, FLOOR + h + 0.05], [0.1, h, x0 - 0.05, FLOOR + h / 2], [0.1, h, x1 + 0.05, FLOOR + h / 2]]) {
      const m = beam(a, b, 0.26, trimMat, 1);
      m.position.set(x, y, Z1);
      group.add(m);
    }
  }
  const door = new THREE.Group();
  {
    const { x0, x1, h } = L.door;
    const w = x1 - x0 - 0.02;
    const leaf = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ ...T.beam, color: '#9A7A5A', roughness: 1 });
    mats.push(wood);
    const parts = [[w, 0.14, w / 2, 0.07], [w, 0.22, w / 2, h - 0.11], [w, 0.9, w / 2, 0.45 + 0.14], [0.12, h, 0.06, h / 2], [0.12, h, w - 0.06, h / 2]];
    for (const [a, b, x, y] of parts) { const m = beam(a, b, 0.05, wood, 1); m.position.set(x, y, 0); leaf.add(m); }
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.24, h - 1.25), glassMat);
    gl.position.set(w / 2, 1.14 + (h - 1.25) / 2 + 0.06, 0);
    leaf.add(gl);
    windows.push(gl);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshStandardMaterial({ color: '#B08A4A', metalness: 1, roughness: 0.3 }));
    knob.position.set(w - 0.1, 1.0, 0.05);
    const knob2 = knob.clone(); knob2.position.z = -0.05;
    leaf.add(knob, knob2);
    door.add(leaf);
    door.position.set(x0 + 0.01, FLOOR, Z1);
    group.add(door);
  }

  // sign
  {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.3), new THREE.MeshStandardMaterial({ map: T.sign, roughness: 0.8 }));
    sign.position.set(-0.15, FLOOR + 2.15, Z1 + 0.14);
    group.add(sign);
  }

  // ---------- deck ----------
  const DY = FLOOR;
  {
    const front = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(L.DECK_X - X0, 0.05, L.DECK_Z - Z1), (L.DECK_X - X0) / 2, (L.DECK_Z - Z1) / 2), deckMat);
    front.position.set((X0 + L.DECK_X) / 2, DY - 0.025, (Z1 + L.DECK_Z) / 2);
    const rg = new THREE.BoxGeometry(L.DECK_X - X1, 0.05, Z1 - L.RDECK_Z0);
    // boards run along z: swap uv axes
    const uv = rg.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v * (Z1 - L.RDECK_Z0) / 2, u * (L.DECK_X - X1) / 2); }
    const right = new THREE.Mesh(rg, deckMat);
    right.position.set((X1 + L.DECK_X) / 2, DY - 0.025, (Z1 + L.RDECK_Z0) / 2);
    front.castShadow = front.receiveShadow = right.castShadow = right.receiveShadow = true;
    group.add(front, right);
    // rim joists
    const fr = beam(L.DECK_X - X0, 0.24, 0.05, black);
    fr.position.set((X0 + L.DECK_X) / 2, DY - 0.15, L.DECK_Z);
    const rr = beam(L.DECK_Z - L.RDECK_Z0, 0.24, 0.05, black);
    rr.rotation.y = Math.PI / 2; rr.position.set(L.DECK_X, DY - 0.15, (L.RDECK_Z0 + L.DECK_Z) / 2);
    group.add(fr, rr);
  }
  // posts, rails, balusters
  const balusters = [];
  function railRun(ax, az, bx, bz, gaps = []) {
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const ang = Math.atan2(-dz, dx);
    const segs = [[0, len]];
    for (const [g0, g1] of gaps) {
      const s = segs.pop();
      segs.push([s[0], g0], [g1, s[1]]);
    }
    for (const [s0, s1] of segs) {
      const l = s1 - s0, mx = ax + dx * (s0 + l / 2), mz = az + dz * (s0 + l / 2);
      const top = beam(l + 0.06, 0.045, 0.1, black); top.position.set(mx, DY + 0.98, mz); top.rotation.y = ang; group.add(top);
      const bot = beam(l, 0.05, 0.06, black); bot.position.set(mx, DY + 0.09, mz); bot.rotation.y = ang; group.add(bot);
      for (let t = s0 + 0.1; t < s1 - 0.05; t += 0.125) balusters.push([ax + dx * t, az + dz * t]);
      for (const t of [s0, s1]) {
        const x = ax + dx * t, z = az + dz * t;
        const post = beam(DY + 1.02, 0.12, 0.12, black); post.rotation.z = Math.PI / 2;
        post.position.set(x, (DY + 1.02) / 2, z); group.add(post);
      }
    }
    // intermediate posts down to grade
    for (let t = 2.2; t < len - 0.5; t += 2.2) {
      const x = ax + dx * t, z = az + dz * t;
      const post = beam(DY, 0.12, 0.12, black); post.rotation.z = Math.PI / 2; post.position.set(x, DY / 2, z); group.add(post);
    }
  }
  const ex = 0.05;
  railRun(X0 + ex, L.DECK_Z - ex, L.DECK_X - ex, L.DECK_Z - ex, [[L.STAIR.x0 - X0 - 0.05, L.STAIR.x1 - X0 + 0.05]]);
  railRun(L.DECK_X - ex, L.DECK_Z - ex, L.DECK_X - ex, L.RDECK_Z0 + ex, [[L.DECK_Z - L.RSTAIR.z1 - 0.05, L.DECK_Z - L.RSTAIR.z0 + 0.05]]);
  railRun(X0 + ex, Z1 + 0.15, X0 + ex, L.DECK_Z - ex);
  railRun(X1 + 0.15, L.RDECK_Z0 + ex, L.DECK_X - ex, L.RDECK_Z0 + ex);
  {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.032, 0.84, 0.032), black, balusters.length);
    const m = new THREE.Matrix4();
    balusters.forEach(([x, z], i) => { m.makeTranslation(x, DY + 0.53, z); mesh.setMatrixAt(i, m); });
    mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere();
    group.add(mesh);
  }
  // lattice skirt
  {
    const lat = new THREE.MeshStandardMaterial({ map: T.lattice, alphaTest: 0.5, color: '#5A5650', roughness: 0.8, side: THREE.DoubleSide });
    const runs = [[X0, L.DECK_Z, L.DECK_X, L.DECK_Z], [L.DECK_X, L.DECK_Z, L.DECK_X, L.RDECK_Z0], [X0, Z1, X0, L.DECK_Z]];
    for (const [ax, az, bx, bz] of runs) {
      const len = Math.hypot(bx - ax, bz - az);
      const g = new THREE.PlaneGeometry(len, DY - 0.2);
      scaleUV(g, len / 0.6, (DY - 0.2) / 0.6);
      const m = new THREE.Mesh(g, lat);
      m.position.set((ax + bx) / 2, (DY - 0.2) / 2, (az + bz) / 2);
      m.rotation.y = Math.atan2(-(bz - az), bx - ax);
      m.castShadow = true;
      group.add(m);
    }
    // dark void under the deck
    const under = new THREE.Mesh(new THREE.PlaneGeometry(L.DECK_X - X0, L.DECK_Z - Z1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1 }));
    under.position.set((X0 + L.DECK_X) / 2, 0.01, (Z1 + L.DECK_Z) / 2);
    group.add(under);
  }
  // stairs
  function stairs(x0, x1, z0, dir) { // dir: +z or +x run
    const steps = 8, rise = DY / steps, run = 0.27;
    const width = x1 - x0;
    for (let k = 1; k < steps; k++) {
      const t = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(width, 0.04, 0.3), width / 2, 0.15), deckMat);
      const along = z0 + (k - 0.5) * run;
      if (dir === 'z') t.position.set((x0 + x1) / 2, DY - k * rise, along);
      else { t.rotation.y = Math.PI / 2; t.position.set(along, DY - k * rise, (x0 + x1) / 2); }
      t.castShadow = t.receiveShadow = true;
      group.add(t);
    }
    const lenS = Math.hypot(steps * run, DY);
    const ang = Math.atan2(DY, steps * run);
    for (const side of [x0 + 0.03, x1 - 0.03]) {
      const s = beam(lenS, 0.24, 0.05, black);
      const h = beam(lenS + 0.1, 0.045, 0.08, black);
      const mid = z0 + steps * run / 2;
      if (dir === 'z') {
        s.rotation.set(0, -Math.PI / 2, -ang); s.position.set(side, DY / 2 - 0.12, mid);
        h.rotation.set(0, -Math.PI / 2, -ang); h.position.set(side, DY / 2 + 0.92, mid);
      } else {
        s.rotation.set(0, 0, -ang); s.position.set(mid, DY / 2 - 0.12, side);
        h.rotation.set(0, 0, -ang); h.position.set(mid, DY / 2 + 0.92, side);
      }
      group.add(s, h);
      const post = beam(1.0, 0.1, 0.1, black); post.rotation.z = Math.PI / 2;
      if (dir === 'z') post.position.set(side, 0.5, z0 + steps * run - 0.05); else post.position.set(z0 + steps * run - 0.05, 0.5, side);
      group.add(post);
    }
  }
  stairs(L.STAIR.x0, L.STAIR.x1, L.DECK_Z, 'z');
  stairs(L.RSTAIR.z0, L.RSTAIR.z1, L.DECK_X, 'x');

  // ---------- porch lights ----------
  const porch = [];
  const lampGlass = new THREE.MeshStandardMaterial({ color: '#2a1a0c', emissive: new THREE.Color('#FFB46B'), emissiveIntensity: 0.6 });
  mats.push(lampGlass);
  for (const [x, y, z] of [[2.2, FLOOR + 1.95, Z1 + 0.2], [-3.4, FLOOR + 1.95, Z1 + 0.2]]) {
    const g = new THREE.Group();
    g.add(beam(0.16, 0.24, 0.16, black, 1));
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.17), lampGlass); g.add(gl);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.08, 4).rotateY(Math.PI / 4), black); cap.position.y = 0.16; g.add(cap);
    g.position.set(x, y, z);
    group.add(g);
    const light = new THREE.PointLight('#FFB46B', 0.5, 12, 2);
    light.position.set(x, y - 0.05, z + 0.15);
    group.add(light);
    porch.push(light);
  }

  // ---------- chimney ----------
  const stones = [];
  const rs = mulberry32(77);
  const cx0 = 4.62, cx1 = 5.42, cz0 = -3.3, cz1 = -1.7, top = RIDGE + 0.7;
  placeStones(stones, rs, V(cx1, 0, cz1), V(0, 0, -1), V(0, 1, 0), V(1, 0, 0), cz1 - cz0, top);
  placeStones(stones, rs, V(cx0, 0, cz1), V(1, 0, 0), V(0, 1, 0), V(0, 0, 1), cx1 - cx0, top);
  placeStones(stones, rs, V(cx1, 0, cz0), V(-1, 0, 0), V(0, 1, 0), V(0, 0, -1), cx1 - cx0, top);
  const chimCore = new THREE.Mesh(new THREE.BoxGeometry(cx1 - cx0, top, cz1 - cz0), new THREE.MeshStandardMaterial({ ...T.mortar, roughness: 1 }));
  chimCore.position.set((cx0 + cx1) / 2, top / 2, (cz0 + cz1) / 2);
  chimCore.castShadow = true;
  group.add(chimCore);
  const capStone = new THREE.Mesh(new THREE.BoxGeometry(cx1 - cx0 + 0.25, 0.12, cz1 - cz0 + 0.25), new THREE.MeshStandardMaterial({ ...T.stone, color: '#8A847A' }));
  capStone.position.set((cx0 + cx1) / 2, top + 0.06, (cz0 + cz1) / 2);
  group.add(capStone);

  return { group, door, porch, windows, glassMat, lampGlass, stones };
}
