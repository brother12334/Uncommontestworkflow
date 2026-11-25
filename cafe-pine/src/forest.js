// Trees, grass, ferns, shrubs, ground and the gravel drive.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, clamp, smooth, lerp, segDist, groundHeight, driveDist, DRIVE } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

// ---------- wind + translucency shader patches ----------
export function windPatch(mat, uniforms, { height = 20, leaf = false, grass = false, trans = 0 } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.uniforms.uH = { value: height };
    sh.uniforms.uTrans = { value: trans };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uSway; uniform float uH;
        ${grass ? '' : 'attribute float aPhase; attribute float aShake;'}`)
      .replace('#include <begin_vertex>', grass ? `vec3 transformed = vec3(position);
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float k = position.y / 0.42; k *= k;
        float w = sin(uTime * 1.7 + ip.x * 0.35 + ip.z * 0.28) * 0.6 + sin(uTime * 3.1 + ip.x * 1.3) * 0.25;
        transformed.x += w * 0.09 * k * (uSway > 0.0 ? 1.0 : 0.0);
        transformed.z += w * 0.04 * k * (uSway > 0.0 ? 1.0 : 0.0);`
        : `vec3 transformed = vec3(position);
        float hn = clamp(position.y / uH, 0.0, 1.0); hn *= hn;
        float sway = uSway * sin(uTime * 0.9 + aPhase) + aShake;
        transformed.x += sway * hn * position.y;
        transformed.z += uSway * 0.6 * sin(uTime * 0.71 + aPhase * 1.3) * hn * position.y;
        ${leaf ? `float rr = min(length(position.xz), 5.0) / 5.0;
        float ph = dot(position, vec3(1.7, 0.9, 2.3));
        float fl = (uSway > 0.0 ? 1.0 : 0.0);
        transformed += objectNormal * sin(uTime * (3.5 + fract(ph) * 3.0) + ph) * 0.035 * rr * fl;
        transformed.y += sin(uTime * 1.3 + ph * 0.5 + aPhase) * 0.06 * rr * fl;` : ''}`);
    if (trans > 0) {
      sh.uniforms.uSunView = uniforms.uSunView; sh.uniforms.uSunCol = uniforms.uSunCol;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunView; uniform vec3 uSunCol; uniform float uTrans;')
        .replace('#include <opaque_fragment>', `
          float tr = pow(max(dot(-normalize(vViewPosition), uSunView), 0.0), 3.0);
          outgoingLight += diffuseColor.rgb * uSunCol * (tr * uTrans + 0.06 * uTrans);
          #include <opaque_fragment>`);
    }
  };
  mat.customProgramCacheKey = () => `wind-${leaf}-${grass}-${trans}-${height}`;
  return mat;
}

// ---------- tree templates ----------
function cyl(r0, r1, len, seg) {
  return new THREE.CylinderGeometry(r1, r0, len, seg, 1, true).translate(0, len / 2, 0);
}
function orient(g, from, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  g.applyQuaternion(q); g.translate(from.x, from.y, from.z);
  return g;
}
function card(size, base, up, roll, normalFrom) {
  const g = new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0);
  const y = up.clone().normalize();
  let x = new THREE.Vector3().crossVectors(y, V(0, 0, 1));
  if (x.lengthSq() < 1e-3) x.set(1, 0, 0);
  x.normalize().applyAxisAngle(y, roll);
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(base);
  g.applyMatrix4(m);
  // soft volumetric normals: outward from the trunk axis, biased up
  const n = g.attributes.normal, p = g.attributes.position;
  for (let i = 0; i < n.count; i++) {
    const v = V(p.getX(i) - normalFrom.x, (p.getY(i) - normalFrom.y) * 0.6, p.getZ(i) - normalFrom.z).normalize();
    v.y += 0.35; v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

function pineTemplate(seed, detail) {
  const r = mulberry32(seed);
  const H = 22;
  const wood = [], leaves = [];
  const trunk = new THREE.CylinderGeometry(0.06, 0.34, H, 12, 10, false).translate(0, H / 2, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 0.21 + seed) * 0.12);
    p.setZ(i, p.getZ(i) + Math.cos(y * 0.17 + seed) * 0.1);
    if (y < 0.6) { const f = 1 + (0.6 - y) * 0.5; p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); }
  }
  trunk.computeVertexNormals();
  wood.push(trunk);
  const centre = (y) => V(Math.sin(y * 0.21 + seed) * 0.12, y, Math.cos(y * 0.17 + seed) * 0.1);
  // dead stubs low on the trunk
  for (let i = 0; i < 6; i++) {
    const y = 2.5 + r() * 4, a = r() * 6.28;
    wood.push(orient(cyl(0.03, 0.01, 0.4 + r() * 0.5, 4), centre(y), V(Math.cos(a), -0.2, Math.sin(a))));
  }
  let y = H * 0.33;
  while (y < H * 0.97) {
    const hn = (y - H * 0.33) / (H * 0.67);
    const n = 4 + Math.floor(r() * 2);
    const a0 = r() * 6.28;
    for (let b = 0; b < n; b++) {
      if (r() < 0.18) continue;
      const a = a0 + (b / n) * 6.28 + (r() - 0.5) * 0.5;
      const len = (Math.pow(1 - hn, 0.75) * 5.2 + 0.4) * (0.65 + r() * 0.6);
      const up = 0.05 + r() * 0.25 + hn * 0.2;
      const dir = V(Math.cos(a), up, Math.sin(a)).normalize();
      const base = centre(y);
      const mid = base.clone().addScaledVector(dir, len * 0.55);
      const dir2 = V(Math.cos(a), up - 0.25, Math.sin(a)).normalize();
      wood.push(orient(cyl(0.07 * (1 - hn * 0.6), 0.03, len * 0.55, 5), base, dir));
      wood.push(orient(cyl(0.03, 0.008, len * 0.5, 4), mid, dir2));
      const tufts = Math.max(2, Math.round(len * 4.2 * detail));
      for (let k = 0; k < tufts; k++) {
        const t = 0.3 + (k / tufts) * 0.75;
        const pos = t < 0.55 ? base.clone().addScaledVector(dir, len * t) : mid.clone().addScaledVector(dir2, len * (t - 0.55));
        const upv = dir.clone().multiplyScalar(0.8).add(V((r() - 0.5) * 0.8, 0.45 + r() * 0.5, (r() - 0.5) * 0.8));
        leaves.push(card(1.35 + r() * 0.6 - hn * 0.3, pos, upv, r() * 6.28, V(0, pos.y, 0)));
      }
    }
    y += 0.65 + r() * 0.35;
  }
  // leader tuft
  for (let k = 0; k < 4; k++) leaves.push(card(1.1, centre(H * 0.95), V((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3), r() * 6.28, V(0, H * 0.9, 0)));
  return { wood: mergeGeometries(wood.map(norm)), leaves: mergeGeometries(leaves), H, crown: 4.5 };
}

function broadTemplate(seed, detail) {
  const r = mulberry32(seed);
  const H = 15;
  const wood = [], leaves = [];
  const split = H * (0.32 + r() * 0.08);
  const trunk = new THREE.CylinderGeometry(0.22, 0.36, split + 0.4, 12, 4).translate(0, (split + 0.4) / 2, 0);
  wood.push(trunk);
  const cy = H * 0.63, rx = H * 0.33, ry = H * 0.3;
  const limbs = 3 + Math.floor(r() * 2);
  const tips = [];
  for (let l = 0; l < limbs; l++) {
    const a = (l / limbs) * 6.28 + r() * 0.6;
    const end = V(Math.cos(a) * rx * 0.45, cy + (r() - 0.3) * ry * 0.5, Math.sin(a) * rx * 0.45);
    const base = V(0, split, 0);
    const d = end.clone().sub(base);
    wood.push(orient(cyl(0.2, 0.11, d.length(), 8), base, d));
    for (let b = 0; b < 5; b++) {
      const aa = a + (r() - 0.5) * 1.6;
      const tip = V(Math.cos(aa) * rx * (0.75 + r() * 0.3), cy + (r() - 0.35) * ry * 1.3, Math.sin(aa) * rx * (0.75 + r() * 0.3));
      const dd = tip.clone().sub(end);
      wood.push(orient(cyl(0.09, 0.025, dd.length(), 5), end, dd));
      tips.push(tip);
    }
  }
  const nCards = Math.round(420 * detail);
  for (let i = 0; i < nCards; i++) {
    // points on/inside the crown ellipsoid, biased to the shell
    const th = r() * 6.28, ph = Math.acos(1 - 2 * Math.pow(r(), 0.85));
    const s = 0.7 + Math.pow(r(), 0.5) * 0.32;
    const pos = V(Math.sin(ph) * Math.cos(th) * rx * s, cy + Math.cos(ph) * ry * s, Math.sin(ph) * Math.sin(th) * rx * s);
    if (pos.y < split + 1.2) pos.y = split + 1.2 + r();
    const out = pos.clone().sub(V(0, cy, 0)).normalize();
    const upv = out.clone().multiplyScalar(0.7).add(V((r() - 0.5) * 0.6, 0.7, (r() - 0.5) * 0.6));
    leaves.push(card(1.5 + r() * 0.8, pos, upv, r() * 6.28, V(0, cy, 0)));
  }
  return { wood: mergeGeometries(wood.map(norm)), leaves: mergeGeometries(leaves), H, crown: rx };
}
// cylinders here are open-ended and indexed; give every part the same attribute set
function norm(g) { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; }

// ---------- forest ----------
export function buildForest(scene, T, uniforms, { tier }) {
  const r = mulberry32(1127);
  const rr = (a, b) => a + (b - a) * r();
  const nearCount = tier === 'low' ? 80 : 140;
  const farCount = tier === 'low' ? 180 : 330;

  const barkPine = new THREE.MeshStandardMaterial({ ...T.barkPine, roughness: 1 });
  const barkMaple = new THREE.MeshStandardMaterial({ ...T.barkMaple, roughness: 1 });
  const needleMat = new THREE.MeshStandardMaterial({ map: T.needle, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.75, color: '#C9D4C0' });
  const leafMat = new THREE.MeshStandardMaterial({ map: T.leaf, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, color: '#E2E6D2' });
  windPatch(barkPine, uniforms, { height: 22 }); windPatch(barkMaple, uniforms, { height: 15 });
  windPatch(needleMat, uniforms, { height: 22, leaf: true, trans: 0.35 });
  windPatch(leafMat, uniforms, { height: 15, leaf: true, trans: 0.55 });

  const templates = [
    { kind: 'pine', hi: pineTemplate(11, 1), lo: pineTemplate(11, 0.35) },
    { kind: 'pine', hi: pineTemplate(23, 1), lo: pineTemplate(23, 0.35) },
    { kind: 'broad', hi: broadTemplate(5, 1), lo: broadTemplate(5, 0.3) },
    { kind: 'broad', hi: broadTemplate(17, 1), lo: broadTemplate(17, 0.3) },
  ];

  // placement
  const trees = [];
  const ok = (x, z, minGap) => {
    if (x > -10.5 && x < 10.5 && z > -10 && z < 10.5) return false;          // cabin, deck, yard
    if (Math.hypot((x + 3) / 11, (z - 11) / 8) < 1) return false;           // lawn
    if (driveDist(x, z) < 3.4) return false;
    if (segDist(x, z, 6, 40, -2, 26) < 5 || segDist(x, z, -2, 26, -8, 19) < 4.5) return false; // descent corridor
    return !trees.some((t) => Math.hypot(t.x - x, t.z - z) < minGap);
  };
  let guard = 0;
  while (trees.length < nearCount && guard++ < 40000) {
    const a = r() * 6.28, d = 9 + Math.pow(r(), 0.8) * 36;
    const x = -1 + Math.cos(a) * d, z = 2 + Math.sin(a) * d;
    if (!ok(x, z, 3.4)) continue;
    trees.push({ x, z, lod: 'hi' });
  }
  guard = 0;
  while (trees.length < nearCount + farCount && guard++ < 40000) {
    const a = r() * 6.28, d = 45 + Math.pow(r(), 0.9) * 75;
    const x = -1 + Math.cos(a) * d, z = 2 + Math.sin(a) * d;
    if (!ok(x, z, 4.2)) continue;
    trees.push({ x, z, lod: 'lo' });
  }
  for (const t of trees) {
    t.tpl = r() < 0.7 ? (r() < 0.5 ? 0 : 1) : (r() < 0.5 ? 2 : 3);
    const tp = templates[t.tpl];
    t.s = tp.kind === 'pine' ? rr(0.65, 1.15) : rr(0.75, 1.2);
    t.y = groundHeight(t.x, t.z) - 0.1;
    t.rot = r() * 6.28;
    t.phase = r() * 6.28;
    t.h = tp.hi.H * t.s; t.crown = tp.hi.crown * t.s;
    t.autumn = tp.kind === 'broad' && r() < 0.12;
    t.shake = 0; t.vel = 0;
  }

  const meshes = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  templates.forEach((tp, ti) => {
    for (const lod of ['hi', 'lo']) {
      const list = trees.filter((t) => t.tpl === ti && t.lod === lod);
      if (!list.length) continue;
      const geoW = tp[lod].wood.clone(), geoL = tp[lod].leaves.clone();
      scaleUV(geoW, 1, tp[lod].H / 4);
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
      const shake = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
      shake.setUsage(THREE.DynamicDrawUsage);
      for (const g of [geoW, geoL]) { g.setAttribute('aPhase', phase); g.setAttribute('aShake', shake); }
      const wood = new THREE.InstancedMesh(geoW, tp.kind === 'pine' ? barkPine : barkMaple, list.length);
      const leaf = new THREE.InstancedMesh(geoL, tp.kind === 'pine' ? needleMat : leafMat, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(V(0, 1, 0), t.rot);
        m4.compose(V(t.x, t.y, t.z), q, sc.set(t.s, t.s, t.s));
        wood.setMatrixAt(i, m4); leaf.setMatrixAt(i, m4);
        phase.setX(i, t.phase);
        const hv = rr(-0.06, 0.06), lv = rr(0.85, 1.1);
        if (t.autumn) col.setRGB(1.5 * lv, 1.05 * lv, 0.5 * lv); else col.setRGB(lv * (1 - hv), lv, lv * (1 + hv));
        leaf.setColorAt(i, col);
        t.ref = { shake, i };
      });
      wood.castShadow = leaf.castShadow = true;
      wood.receiveShadow = leaf.receiveShadow = true;
      wood.computeBoundingSphere(); leaf.computeBoundingSphere();
      scene.add(wood, leaf);
      meshes.push(wood, leaf);
    }
  });

  // ---------- ground ----------
  const groundGeo = new THREE.PlaneGeometry(320, 320, 200, 200).rotateX(-Math.PI / 2);
  {
    const p = groundGeo.attributes.position, uv = groundGeo.attributes.uv;
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, groundHeight(x, z));
      uv.setXY(i, x / 4, z / 4);
      const big = 0.82 + (Math.sin(x * 0.07) * Math.cos(z * 0.06) * 0.5 + 0.5) * 0.25;
      const lawn = smooth(1.25, 0.8, Math.hypot((x + 3) / 12, (z - 10) / 9));
      cols.set([big * lerp(1, 0.75, lawn), big * lerp(1, 0.95, lawn), big * lerp(1, 0.7, lawn)], i * 3);
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ ...T.floor, vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- gravel drive and path ----------
  function ribbon(points, width, segs, mats) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => V(x, 0, z)), false, 'centripetal');
    const len = curve.getLength();
    const cols = 5;
    const pos = [], uv = [], col = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, c = curve.getPointAt(t), tan = curve.getTangentAt(t);
      const nrm = V(-tan.z, 0, tan.x).normalize();
      for (let j = 0; j < cols; j++) {
        const f = j / (cols - 1) - 0.5;
        const w = f * width * (1 + (Math.abs(f) > 0.3 ? 0.18 : 0));
        const x = c.x + nrm.x * w, z = c.z + nrm.z * w;
        pos.push(x, groundHeight(x, z) + 0.025, z);
        uv.push((f + 0.5) * width / 2, t * len / 2);
        const a = j === 0 || j === cols - 1 ? 0 : 1;
        col.push(1, 1, 1, a);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats);
    m.receiveShadow = true;
    m.renderOrder = 1;
    return m;
  }
  const gravelMat = new THREE.MeshStandardMaterial({ ...T.gravel, vertexColors: true, transparent: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  scene.add(ribbon(DRIVE, 3.2, 140, gravelMat));
  scene.add(ribbon([[-8.4, 6], [-6.5, 8.6], [-4.2, 9.2], [-2.7, 8.6]], 1.5, 40, gravelMat));

  // ---------- grass ----------
  const grassN = tier === 'high' ? 60000 : tier === 'medium' ? 30000 : 14000;
  {
    const blade = new THREE.PlaneGeometry(0.045, 0.42, 1, 4).translate(0, 0.21, 0);
    const p = blade.attributes.position, n = blade.attributes.normal;
    const cols = new Float32Array(p.count * 3);
    const base = new THREE.Color('#2A3A1C'), tip = new THREE.Color('#8E9C4C'), tc = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 0.42;
      p.setX(i, p.getX(i) * (1 - y * 0.85));
      p.setZ(i, y * y * 0.07);
      n.setXYZ(i, 0, 1, 0.25);
      tc.copy(base).lerp(tip, Math.pow(y, 0.8));
      cols.set([tc.r, tc.g, tc.b], i * 3);
    }
    blade.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82 }), uniforms, { grass: true });
    const mesh = new THREE.InstancedMesh(blade, mat, grassN);
    let k = 0, g2 = 0;
    const gc = new THREE.Color();
    while (k < grassN && g2++ < grassN * 6) {
      const a = r() * 6.28, d = Math.sqrt(r()) * 24;
      const x = -2 + Math.cos(a) * d * 1.2, z = 8 + Math.sin(a) * d;
      if (x > -8.7 && x < 7.0 && z > -7.6 && z < 6.5) continue;      // cabin + deck
      if (x > -3.5 && x < -1.9 && z > 6 && z < 8.5) continue;        // front stairs
      if (x > 6.5 && x < 9 && z > 2.2 && z < 3.8) continue;          // right stairs
      if (driveDist(x, z) < 1.9) continue;
      if (d > 14 && r() < smooth(14, 24, d) * 0.9) continue;
      const h = 0.38 + r() * 0.3;
      q.setFromAxisAngle(V(0, 1, 0), r() * 6.28);
      m4.compose(V(x, groundHeight(x, z) - 0.02, z), q, sc.set(1 + r() * 0.6, h, 1));
      mesh.setMatrixAt(k, m4);
      const v = 0.75 + r() * 0.4; gc.setRGB(v * (0.95 + r() * 0.12), v, v * (0.85 + r() * 0.1));
      mesh.setColorAt(k, gc);
      k++;
    }
    mesh.count = k;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // ---------- ferns ----------
  {
    const parts = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28;
      const g = new THREE.PlaneGeometry(0.55, 0.9, 1, 3).translate(0, 0.45, 0);
      const p = g.attributes.position;
      for (let j = 0; j < p.count; j++) { const y = p.getY(j) / 0.9; p.setZ(j, -y * y * 0.35); }
      g.rotateX(-0.75).rotateY(a);
      parts.push(g);
    }
    const geo = mergeGeometries(parts); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: T.fern, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 });
    const n = tier === 'low' ? 90 : 220;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    let k = 0, g3 = 0;
    while (k < n && g3++ < 6000) {
      const a = r() * 6.28, d = 10 + r() * 26;
      const x = -1 + Math.cos(a) * d, z = 2 + Math.sin(a) * d;
      if (!ok(x, z, 0)) continue;
      q.setFromAxisAngle(V(0, 1, 0), r() * 6.28);
      const s = 0.7 + r() * 0.7;
      m4.compose(V(x, groundHeight(x, z), z), q, sc.set(s, s, s));
      mesh.setMatrixAt(k++, m4);
    }
    mesh.count = k; mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // ---------- arborvitae shrubs ----------
  {
    const parts = [];
    const rs = mulberry32(8);
    for (let i = 0; i < 90; i++) {
      const h = rs() * 1.55;
      const rad = 0.42 * Math.pow(1 - h / 1.7, 0.9) + 0.02;
      const a = rs() * 6.28;
      const base = V(Math.cos(a) * rad * 0.6, h, Math.sin(a) * rad * 0.6);
      const out = V(Math.cos(a), 1.3, Math.sin(a));
      parts.push(card(0.45 + rs() * 0.15, base, out, rs() * 6.28, V(0, h, 0)));
    }
    const geo = mergeGeometries(parts);
    const mat = new THREE.MeshStandardMaterial({ map: T.needle, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, color: '#5E7A52' });
    const spots = [[-0.6, 6.95], [1.9, 6.95], [4.4, 6.95]];
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, z], i) => {
      const s = 0.95 + i * 0.07;
      m4.compose(V(x, groundHeight(x, z), z), q.setFromAxisAngle(V(0, 1, 0), i * 2), sc.set(s, s * 1.05, s));
      mesh.setMatrixAt(i, m4);
    });
    mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // ---------- boulders ----------
  {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = V(p.getX(i), p.getY(i), p.getZ(i));
      const n = 1 + Math.sin(v.x * 3.1) * 0.12 + Math.sin(v.y * 4.3 + v.z * 2) * 0.1;
      v.multiplyScalar(n); p.setXYZ(i, v.x, v.y * 0.6, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ ...T.stone, color: '#9A958C' });
    const spots = [[-13, 4, 0.9], [9, 14, 0.6], [12, -4, 1.2], [-11, -9, 0.8], [3, 16, 0.5], [-16, 15, 1.0]];
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach(([x, z, s], i) => { m4.compose(V(x, groundHeight(x, z) + s * 0.15, z), q.setFromEuler(new THREE.Euler(0, i, 0.1)), sc.set(s * 1.3, s, s)); mesh.setMatrixAt(i, m4); });
    mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  return { trees, meshes, materials: [barkPine, barkMaple, needleMat, leafMat, ground.material, gravelMat] };
}
