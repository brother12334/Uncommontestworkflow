// The great room: planked walls, vaulted pine ceiling, trusses, fieldstone fireplace with a live fire,
// chesterfields, live-edge table, pool table, lamp, rug and the coffee counter.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from './util.js';
import { scaleUV } from './forest.js';
import { L, beam, quad, placeStones } from './cabin.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const IN = { x0: -4.37, x1: 4.37, z0: -6.88, z1: 3.88, wall: 3.0 };
const SLOPE = Math.tan(L.pitch);
const ceilAt = (x) => IN.wall + (IN.x1 - Math.abs(x)) * SLOPE; // ceiling height above the floor
export const ROOM = { ...IN, ridge: ceilAt(0) };

function rbox(w, h, d, r, mat, segs = 4) {
  const g = new RoundedBoxGeometry(w, h, d, segs, r);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function buildInterior(scene, T, { mats, stones }) {
  const r = mulberry32(55);
  const room = new THREE.Group();
  room.position.y = L.FLOOR;
  scene.add(room);

  const wallMat = new THREE.MeshStandardMaterial({ ...T.planks, roughness: 1, side: THREE.DoubleSide });
  const ceilMat = new THREE.MeshStandardMaterial({ ...T.ceiling, roughness: 1, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshStandardMaterial({ ...T.beam, roughness: 1 });
  const carpetMat = new THREE.MeshStandardMaterial({ ...T.carpet, roughness: 1 });
  const leatherT = new THREE.MeshStandardMaterial({ ...T.leatherTufted, roughness: 1 });
  const leatherP = new THREE.MeshStandardMaterial({ ...T.leatherPlain, roughness: 1 });
  const feltMat = new THREE.MeshStandardMaterial({ ...T.felt, roughness: 1 });
  const walnutMat = new THREE.MeshStandardMaterial({ ...T.walnut, roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: '#1E1D1B', roughness: 0.45, metalness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: '#C9C8C4', roughness: 0.22, metalness: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: '#B08A4A', roughness: 0.32, metalness: 1 });
  const soot = new THREE.MeshStandardMaterial({ color: '#141110', roughness: 1, side: THREE.BackSide });
  const rugMat = new THREE.MeshStandardMaterial({ ...T.rug, roughness: 1 });
  mats.push(wallMat, ceilMat, beamMat, carpetMat, leatherT, leatherP, feltMat, walnutMat, iron, steel, brass, rugMat);

  // ---------- shell ----------
  const floor = quad(V(IN.x0, 0, IN.z1), V(IN.x1, 0, IN.z1), V(IN.x1, 0, IN.z0), V(IN.x0, 0, IN.z0), (IN.x1 - IN.x0) / 1.5, (IN.z1 - IN.z0) / 1.5, carpetMat);
  room.add(floor);
  function wall(pts, holes, pos, rotY) {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const [a, b, c, d] of holes) sh.holes.push(new THREE.Path([new THREE.Vector2(a, c), new THREE.Vector2(b, c), new THREE.Vector2(b, d), new THREE.Vector2(a, d)]));
    const g = new THREE.ShapeGeometry(sh);
    scaleUV(g, 1 / 4, 1 / 4);
    const m = new THREE.Mesh(g, wallMat);
    m.position.copy(pos); m.rotation.y = rotY;
    m.receiveShadow = true;
    room.add(m);
  }
  const gable = [[IN.x0, 0], [IN.x1, 0], [IN.x1, IN.wall], [0, ROOM.ridge], [IN.x0, IN.wall]];
  const F = L.FLOOR;
  wall(gable, [[L.door.x0, L.door.x1, 0, L.door.h], [-2.6, -0.9, 0.9, 2.1], [-0.6, 0.6, 5.1 - F, 6.1 - F]], V(0, 0, IN.z1), 0);
  wall(gable, [[2.4, 3.4, 1.0, 2.0]], V(0, 0, IN.z0), 0);
  wall([[IN.z0, 0], [IN.z1, 0], [IN.z1, IN.wall], [IN.z0, IN.wall]], [[1.1, 2.3, 0.9, 2.0]], V(IN.x1, 0, 0), -Math.PI / 2);
  wall([[IN.z0, 0], [IN.z1, 0], [IN.z1, IN.wall], [IN.z0, IN.wall]], [], V(IN.x0, 0, 0), -Math.PI / 2);
  // window reveals (sills)
  for (const [x, z, w, d, ry] of [[-1.75, IN.z1 - 0.05, 1.7, 0.25, 0], [1.7, 0, 1.2, 0.25, Math.PI / 2]]) {
    const s = beam(w + 0.1, 0.04, d, beamMat, 1);
    s.rotation.y = ry; s.position.set(ry ? IN.x1 - 0.06 : x, 0.88, ry ? x : z);
    room.add(s);
  }
  // vaulted ceiling
  const sl = Math.hypot(IN.x1, ROOM.ridge - IN.wall);
  room.add(quad(V(IN.x0, IN.wall, IN.z1), V(IN.x0, IN.wall, IN.z0), V(0, ROOM.ridge, IN.z0), V(0, ROOM.ridge, IN.z1), (IN.z1 - IN.z0) / 2, sl / 2, ceilMat));
  room.add(quad(V(IN.x1, IN.wall, IN.z0), V(IN.x1, IN.wall, IN.z1), V(0, ROOM.ridge, IN.z1), V(0, ROOM.ridge, IN.z0), (IN.z1 - IN.z0) / 2, sl / 2, ceilMat));

  // trusses
  const ang = L.pitch;
  for (const z of [-5.4, -1.9, 1.6]) {
    const tie = beam(IN.x1 - IN.x0, 0.26, 0.2, beamMat); tie.position.set(0, IN.wall - 0.13, z); room.add(tie);
    for (const side of [-1, 1]) {
      const raf = beam(sl + 0.1, 0.24, 0.2, beamMat);
      raf.rotation.z = -side * ang;
      raf.position.set(side * IN.x1 / 2, IN.wall + (ROOM.ridge - IN.wall) / 2 - 0.14, z);
      room.add(raf);
      const strut = beam(2.45, 0.16, 0.16, beamMat);
      strut.rotation.z = side * 0.75;
      strut.position.set(side * 1.0, IN.wall + 0.84, z);
      room.add(strut);
    }
    const king = beam(ROOM.ridge - IN.wall, 0.2, 0.2, beamMat); king.rotation.z = Math.PI / 2;
    king.position.set(0, IN.wall + (ROOM.ridge - IN.wall) / 2, z); room.add(king);
  }
  const ridgeBeam = beam(IN.z1 - IN.z0, 0.28, 0.24, beamMat); ridgeBeam.rotation.y = Math.PI / 2; ridgeBeam.position.set(0, ROOM.ridge - 0.16, (IN.z0 + IN.z1) / 2); room.add(ridgeBeam);
  for (const side of [-1, 1]) {
    const pur = beam(IN.z1 - IN.z0, 0.2, 0.18, beamMat); pur.rotation.y = Math.PI / 2;
    pur.position.set(side * IN.x1 * 0.5, IN.wall + (ROOM.ridge - IN.wall) * 0.5 - 0.15, (IN.z0 + IN.z1) / 2); room.add(pur);
  }
  for (const z of [-1.9]) {
    const post = beam(IN.wall - 0.26, 0.22, 0.22, beamMat); post.rotation.z = Math.PI / 2; post.position.set(-0.9, (IN.wall - 0.26) / 2, z); room.add(post);
    const tie = beam(1.2, 0.2, 0.2, beamMat); tie.position.set(-0.9, IN.wall - 0.36, z); tie.rotation.y = Math.PI / 2; room.add(tie);
  }

  // ---------- fireplace ----------
  const fx = 3.4; // stone face
  const fz0 = -3.8, fz1 = -1.2;
  const open = { z0: -3.0, z1: -2.0, y0: 0.45, y1: 1.25 };
  const top = ceilAt(fx) - 0.02;
  placeStones(stones, r, V(fx, F, fz0), V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0), fz1 - fz0, top, [[open.z0 - fz0, open.z1 - fz0, open.y0, open.y1 + 0.02], [0, fz1 - fz0, 0, 0.45], [fz1 - fz0 - 0.15, fz1 - fz0, 1.5, 1.8], [0, 0.15, 1.5, 1.8]]);
  placeStones(stones, r, V(IN.x1, F, fz0), V(-1, 0, 0), V(0, 1, 0), V(0, 0, -1), IN.x1 - fx, IN.wall);
  placeStones(stones, r, V(fx, F, fz1), V(1, 0, 0), V(0, 1, 0), V(0, 0, 1), IN.x1 - fx, IN.wall);
  const mortarMat = new THREE.MeshStandardMaterial({ ...T.mortar, roughness: 1 });
  mats.push(mortarMat, soot);
  const core = (x0, x1, y0, y1, z0, z1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mortarMat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.receiveShadow = true; room.add(m); };
  core(fx + 0.04, IN.x1, 0.45, open.y0, fz0, fz1);
  core(fx + 0.04, IN.x1, open.y0, open.y1, fz0, open.z0);
  core(fx + 0.04, IN.x1, open.y0, open.y1, open.z1, fz1);
  core(fx + 0.04, IN.x1, open.y1, top, fz0, fz1);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, open.y1 - open.y0, open.z1 - open.z0), [soot, new THREE.MeshBasicMaterial({ visible: false }), soot, soot, soot, soot]);
  box.position.set(fx + 0.33, (open.y0 + open.y1) / 2, (open.z0 + open.z1) / 2);
  room.add(box);
  // hearth slab + mantel
  const hearth = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(0.62, 0.45, fz1 - fz0 + 0.1), 0.6, 0.6), new THREE.MeshStandardMaterial({ ...T.stone, color: '#7E7468', roughness: 1 }));
  hearth.position.set(fx - 0.26, 0.225, (fz0 + fz1) / 2); hearth.castShadow = hearth.receiveShadow = true; room.add(hearth);
  const mantel = beam(fz1 - fz0 - 0.1, 0.2, 0.3, beamMat); mantel.rotation.y = Math.PI / 2; mantel.position.set(fx - 0.08, 1.65, (fz0 + fz1) / 2); room.add(mantel);

  // fire: charred logs, ember glow, flames
  const fireGroup = new THREE.Group();
  fireGroup.position.set(fx + 0.32, open.y0, (open.z0 + open.z1) / 2);
  room.add(fireGroup);
  const charMat = new THREE.MeshStandardMaterial({ color: '#1A1512', roughness: 0.9, emissive: new THREE.Color('#FF6A20'), emissiveMap: T.ember, emissiveIntensity: 1.5 });
  for (const [x, y, rz, ry] of [[0, 0.06, 0, 0.1], [0.05, 0.06, 0, -0.25], [-0.02, 0.17, 0, 1.2]]) {
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 10), charMat);
    lg.rotation.set(Math.PI / 2, 0, 0); lg.rotateOnWorldAxis(V(0, 1, 0), ry);
    lg.position.set(x, y, 0);
    fireGroup.add(lg);
  }
  const andiron = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.6), iron); andiron.position.y = 0.01; fireGroup.add(andiron);
  const flameU = { uTime: { value: 0 }, uBoost: { value: 1 } };
  const flameMat = new THREE.ShaderMaterial({
    uniforms: flameU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uBoost; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=n(p)*a; p*=2.1; a*=.5; } return s; }
      void main(){
        vec2 uv = vUv;
        float t = uTime;
        float q = fbm(vec2(uv.x * 3.0, uv.y * 2.0 - t * 1.6));
        float w = (0.5 - abs(uv.x - 0.5 + (q - 0.5) * 0.35 * uv.y)) * 2.0;
        float shape = w - pow(uv.y, 1.25) * (1.15 / uBoost) - (q - 0.5) * 0.7;
        float f = smoothstep(0.0, 0.35, shape);
        float core = smoothstep(0.25, 0.75, shape);
        vec3 col = mix(vec3(0.9, 0.22, 0.03), vec3(1.0, 0.62, 0.22), core);
        col = mix(col, vec3(1.0, 0.8, 0.5), core * core * 0.6);
        float a = f * smoothstep(0.0, 0.06, uv.y) * (1.0 - smoothstep(0.75, 1.0, uv.y));
        gl_FragColor = vec4(col * a * 2.2, a);
      }`,
  });
  const flames = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5 - i * 0.05, 0.62 + (i % 2) * 0.1).translate(0, 0.31, 0), flameMat);
    f.rotation.y = Math.PI / 2 + (i - 1.5) * 0.45;
    f.position.set(-0.02 + i * 0.03, 0.08, (i - 1.5) * 0.08);
    fireGroup.add(f); flames.push(f);
  }
  const fireLight = new THREE.PointLight('#FF9A4D', 9, 0, 2);
  fireLight.position.set(fx - 0.15, 0.85, (open.z0 + open.z1) / 2);
  room.add(fireLight);

  // firewood stack
  {
    const wood = new THREE.MeshStandardMaterial({ ...T.barkPine, roughness: 1 });
    mats.push(wood);
    const n = 12;
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.065, 0.45, 9).rotateX(Math.PI / 2), wood, n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - (row === 2 ? 1 : 0); i++) {
      m.makeRotationZ(r() * 6); m.setPosition(fx - 0.3 + i * 0.13 + row * 0.065 - 0.2, 0.06 + row * 0.11, -0.75);
      mesh.setMatrixAt(k++, m);
    }
    mesh.count = k; mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere();
    mesh.position.x = -0.15;
    room.add(mesh);
  }

  // ---------- chesterfield sofas ----------
  function chesterfield(len) {
    const g = new THREE.Group();
    const D = 0.95;
    const base = rbox(len, 0.36, D, 0.05, leatherP); base.position.y = 0.26; g.add(base);
    const cw = (len - 0.56) / 3;
    for (let i = 0; i < 3; i++) {
      const c = rbox(cw - 0.012, 0.14, D - 0.3, 0.06, leatherP, 5);
      c.position.set(-len / 2 + 0.28 + cw * (i + 0.5), 0.5, 0.1);
      c.rotation.z = (r() - 0.5) * 0.02;
      g.add(c);
    }
    const back = rbox(len, 0.42, 0.24, 0.08, leatherT, 5);
    scaleUV(back.geometry, len / 0.6, 0.42 / 0.6 * 2);
    back.position.set(0, 0.64, -D / 2 + 0.12); g.add(back);
    for (const sx of [-1, 1]) {
      const arm = rbox(0.26, 0.34, D, 0.06, leatherT, 5);
      scaleUV(arm.geometry, 1.4, 1.6);
      arm.position.set(sx * (len / 2 - 0.13), 0.58, 0); g.add(arm);
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, D, 24), leatherP);
      roll.rotation.x = Math.PI / 2; roll.position.set(sx * (len / 2 - 0.1), 0.74, 0);
      roll.castShadow = roll.receiveShadow = true; g.add(roll);
      for (const sz of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.08, 10), beamMat);
        foot.position.set(sx * (len / 2 - 0.08), 0.04, sz * (D / 2 - 0.08)); g.add(foot);
      }
    }
    // a throw pillow
    const pillow = rbox(0.42, 0.38, 0.14, 0.07, new THREE.MeshStandardMaterial({ ...T.wool, roughness: 1 }), 5);
    pillow.position.set(len / 2 - 0.45, 0.72, -0.2); pillow.rotation.set(-0.3, 0.2, 0.1); g.add(pillow);
    return g;
  }
  const sofaA = chesterfield(2.3); sofaA.rotation.y = Math.PI / 2; sofaA.position.set(0.15, 0, -2.45); room.add(sofaA);
  const sofaB = chesterfield(2.2); sofaB.rotation.y = Math.PI; sofaB.position.set(1.95, 0, -0.25); room.add(sofaB);

  // ---------- live-edge table ----------
  const TABLE_TOP = 0.46;
  const tableC = V(2.0, 0, -2.45);
  {
    const pts = [];
    const n = 40;
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([t * 1.6, 0.04 * Math.sin(t * 9 + 1) + 0.025 * Math.sin(t * 23)]); }
    for (let i = n; i >= 0; i--) { const t = i / n; pts.push([t * 1.6, 0.74 + 0.05 * Math.sin(t * 7 + 2) + 0.02 * Math.sin(t * 19)]); }
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.065, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 4 });
    g.translate(-0.8, -0.38, 0); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 2);
    const slab = new THREE.Mesh(g, walnutMat);
    slab.position.set(tableC.x, TABLE_TOP - 0.065, tableC.z);
    slab.castShadow = slab.receiveShadow = true;
    room.add(slab);
    for (const dz of [-0.6, 0.6]) {
      const legG = new THREE.Group();
      for (const [w, h, x, y] of [[0.05, TABLE_TOP - 0.07, -0.25, (TABLE_TOP - 0.07) / 2], [0.05, TABLE_TOP - 0.07, 0.25, (TABLE_TOP - 0.07) / 2], [0.55, 0.04, 0, 0.02], [0.55, 0.04, 0, TABLE_TOP - 0.09]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), iron); m.position.set(x, y, 0); m.castShadow = true; legG.add(m);
      }
      legG.rotation.y = Math.PI / 2; legG.position.set(tableC.x, 0, tableC.z + dz);
      room.add(legG);
    }
    // a book and a coaster
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.16), new THREE.MeshStandardMaterial({ color: '#3E4A3A', roughness: 0.7 }));
    book.position.set(tableC.x - 0.15, TABLE_TOP + 0.015, tableC.z + 0.45); book.rotation.y = 0.3; book.castShadow = true; room.add(book);
  }
  const mugAnchor = V(tableC.x + 0.05, L.FLOOR + TABLE_TOP, tableC.z - 0.15);

  // rug
  {
    const rg = new THREE.PlaneGeometry(3.0, 2.3).rotateX(-Math.PI / 2);
    const rugM = new THREE.Mesh(rg, rugMat); rugM.position.set(1.75, 0.006, -2.3); rugM.receiveShadow = true; room.add(rugM);
  }

  // side table + lamp
  const lampPos = V(0.25, 0, -0.35);
  {
    const t = rbox(0.5, 0.55, 0.5, 0.02, beamMat); t.position.set(lampPos.x, 0.275, lampPos.z); room.add(t);
    const base = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.09, 0], [0.1, 0.02], [0.05, 0.06], [0.08, 0.18], [0.03, 0.34], [0.015, 0.4], [0, 0.4]].map(([x, y]) => new THREE.Vector2(x, y)), 32), brass);
    base.position.set(lampPos.x, 0.55, lampPos.z); base.castShadow = true; room.add(base);
    const shadeMat = new THREE.MeshStandardMaterial({ ...T.linen, roughness: 1, side: THREE.DoubleSide, emissive: new THREE.Color('#FFC98A'), emissiveIntensity: 0.9, transparent: true, opacity: 0.96 });
    shadeMat.emissiveMap = T.linen.map;
    mats.push(shadeMat);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.28, 40, 1, true), shadeMat);
    shade.position.set(lampPos.x, 1.08, lampPos.z); room.add(shade);
  }
  const lampLight = new THREE.PointLight('#FFB877', 3.5, 0, 2);
  lampLight.position.set(lampPos.x, 1.0, lampPos.z);
  room.add(lampLight);

  // ---------- pool table ----------
  {
    const g = new THREE.Group();
    const W = 1.42, Lg = 2.6, H = 0.8;
    const body = rbox(W, 0.28, Lg, 0.03, beamMat); body.position.y = H - 0.2; g.add(body);
    const cloth = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(W - 0.26, Lg - 0.26).rotateX(-Math.PI / 2), 2, 4), feltMat);
    cloth.position.y = H - 0.055; cloth.receiveShadow = true; g.add(cloth);
    for (const [w, d, x, z] of [[W, 0.13, 0, Lg / 2 - 0.065], [W, 0.13, 0, -Lg / 2 + 0.065], [0.13, Lg, W / 2 - 0.065, 0], [0.13, Lg, -W / 2 + 0.065, 0]]) {
      const rail = rbox(w, 0.06, d, 0.015, beamMat); rail.position.set(x, H - 0.02, z); g.add(rail);
      const cush = new THREE.Mesh(new THREE.BoxGeometry(w > d ? w - 0.26 : 0.04, 0.04, w > d ? 0.04 : d - 0.26), feltMat);
      cush.position.set(x * (w > d ? 1 : 0.8), H - 0.035, z * (w > d ? 0.92 : 1)); g.add(cush);
    }
    const pocket = new THREE.MeshStandardMaterial({ color: '#0A0908', roughness: 1 });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), pocket);
      p.position.set(x * (W / 2 - 0.12), H - 0.045, z * (Lg / 2 - 0.12)); g.add(p);
    }
    const legGeo = new THREE.LatheGeometry([[0, 0], [0.1, 0], [0.11, 0.05], [0.07, 0.12], [0.09, 0.3], [0.06, 0.5], [0.08, 0.55], [0, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const l = new THREE.Mesh(legGeo, beamMat); l.position.set(x * (W / 2 - 0.15), 0, z * (Lg / 2 - 0.2)); l.castShadow = true; g.add(l);
    }
    const ballCols = ['#E9DFC8', '#D8A21E', '#1F3E8C', '#B02420', '#4A2266', '#D2601E', '#1E5A2E', '#701E1E', '#111111'];
    ballCols.forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.028, 20, 14), new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.15, clearcoat: 1 }));
      b.position.set((r() - 0.5) * (W - 0.4), H - 0.027, (r() - 0.5) * (Lg - 0.6) + (i < 1 ? 0.6 : -0.2));
      b.castShadow = true; g.add(b);
    });
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(-2.55, 0, -2.6);
    room.add(g);
  }

  // ---------- coffee counter ----------
  const counterZ = -6.25;
  {
    const front = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(4.2, 1.0, 0.62), 4.2 / 4, 1 / 4), wallMat);
    front.position.set(-0.6, 0.5, counterZ - 0.31 + 0.0); front.castShadow = front.receiveShadow = true; room.add(front);
    const top = beam(4.35, 0.06, 0.72, walnutMat, 1); top.position.set(-0.6, 1.03, counterZ - 0.3); room.add(top);
    // espresso machine
    const em = new THREE.Group();
    const bodyM = rbox(0.72, 0.42, 0.52, 0.03, steel); bodyM.position.y = 0.21; em.add(bodyM);
    const topM = rbox(0.76, 0.04, 0.56, 0.015, steel); topM.position.y = 0.44; em.add(topM);
    for (const x of [-0.17, 0.17]) {
      const gh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 20), steel); gh.position.set(x, 0.24, 0.28); em.add(gh);
      const pf = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 10), new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.5 }));
      pf.rotation.x = Math.PI / 2; pf.position.set(x, 0.2, 0.38); em.add(pf);
    }
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.025, 0.18), steel); tray.position.set(0, 0.04, 0.32); em.add(tray);
    em.position.set(-0.9, 1.06, counterZ - 0.33);
    em.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    room.add(em);
    // grinder
    const gr = new THREE.Group();
    const gb = rbox(0.18, 0.32, 0.24, 0.02, iron); gb.position.y = 0.16; gr.add(gb);
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.05, 0.22, 24, 1, true), new THREE.MeshPhysicalMaterial({ color: '#3A2416', roughness: 0.1, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    hop.position.y = 0.43; gr.add(hop);
    const beans = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.05, 0.14, 20), new THREE.MeshStandardMaterial({ color: '#2A170C', roughness: 0.6 }));
    beans.position.y = 0.39; gr.add(beans);
    gr.position.set(-0.05, 1.06, counterZ - 0.35); room.add(gr);
    // shelf with coffee bags
    const shelf = beam(2.4, 0.05, 0.28, beamMat, 1); shelf.position.set(-0.6, 1.95, IN.z0 + 0.14); room.add(shelf);
    const kraft = new THREE.MeshStandardMaterial({ color: '#B08A5E', roughness: 0.85 });
    const label = new THREE.MeshStandardMaterial({ color: '#E9DFC8', roughness: 0.8 });
    for (let i = 0; i < 7; i++) {
      const bag = rbox(0.16, 0.26, 0.1, 0.02, kraft); bag.position.set(-1.6 + i * 0.32, 2.1, IN.z0 + 0.14); room.add(bag);
      const lb = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.1), label); lb.position.set(-1.6 + i * 0.32, 2.1, IN.z0 + 0.195); room.add(lb);
    }
    // pendants
    for (const x of [-2.0, -0.6, 0.8]) {
      const sh = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#1E1D1B', roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }));
      sh.position.set(x, 2.25, counterZ - 0.2); room.add(sh);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), new THREE.MeshStandardMaterial({ color: '#000', emissive: new THREE.Color('#FFC27A'), emissiveIntensity: 6 }));
      bulb.position.set(x, 2.17, counterZ - 0.2); room.add(bulb);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, ceilAt(x) - 2.35, 6), iron);
      cord.position.set(x, 2.35 + (ceilAt(x) - 2.35) / 2, counterZ - 0.2); room.add(cord);
    }
  }
  const counterLight = new THREE.SpotLight('#FFC27A', 14, 0, 1.1, 0.7, 2);
  counterLight.position.set(-0.6, 2.2, counterZ - 0.2);
  counterLight.target.position.set(-0.6, 0, counterZ - 0.2);
  room.add(counterLight, counterLight.target);

  // mugs on the counter
  const mugSpots = [[0.55, counterZ - 0.2], [0.72, counterZ - 0.28], [0.62, counterZ - 0.42]];

  // ---------- sparks ----------
  const SPARK = 70;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK * 3), 3));
  sparkGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(SPARK), 1));
  sparkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(SPARK), 1));
  const sparkSeed = Array.from({ length: SPARK }, () => [r(), r(), r(), r()]);
  let stokeAt = -10;

  function update(now, { reduced }) {
    const since = now - stokeAt;
    const boost = since >= 0 && since < 2 ? 1 + 0.6 * (since < 0.25 ? since / 0.25 : 1 - (since - 0.25) / 1.75) : 1;
    flameU.uTime.value = reduced ? 0 : now;
    flameU.uBoost.value = boost;
    const flick = reduced ? 1 : 1 + Math.sin(now * 7.3) * 0.08 + Math.sin(now * 13.7 + 1) * 0.06 + Math.sin(now * 23.1) * 0.04;
    fireLight.intensity = (9 + (boost - 1) * 11.7) * flick;
    charMat.emissiveIntensity = (1.2 + Math.sin(now * 2.1) * 0.25) * boost;
    flames.forEach((f, i) => { f.scale.y = boost * (1 + Math.sin(now * (5 + i) + i) * 0.06); });
    const p = sparkGeo.attributes;
    const fp = fireGroup.position;
    for (let i = 0; i < SPARK; i++) {
      const [a, b, c, d] = sparkSeed[i];
      const extra = since < 2 && i < 40;
      const life = ((now * (0.45 + b * 0.4) + a) % 1);
      const show = extra ? 1 : (i % 4 === 0 ? 1 : 0);
      p.position.setXYZ(i, fp.x - 0.05 + Math.sin(life * 8 + d * 6) * 0.06 * life, F + fp.y + 0.1 + life * (extra ? 1.4 : 0.9), fp.z + (c - 0.5) * 0.5 + Math.cos(life * 6 + a * 5) * 0.05);
      p.aSize.setX(i, 0.012);
      p.aAlpha.setX(i, show * (1 - life) * (reduced ? 0 : 1));
    }
    p.position.needsUpdate = p.aAlpha.needsUpdate = p.aSize.needsUpdate = true;
  }

  return {
    group: room, update, mugAnchor, mugSpots, sparkGeo,
    fireLight, lampLight, counterLight,
    firePos: V(fx + 0.3, F + 0.8, (open.z0 + open.z1) / 2),
    fireHit: { center: V(fx - 0.05, F + 1.0, (fz0 + fz1) / 2), radius: 1.3 },
    stoke(now) { stokeAt = now; },
  };
}
