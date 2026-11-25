import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LIQUIDS } from './site.js';

// ---------- deterministic helpers ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1127);
const rr = (a, b) => a + (b - a) * rand();

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const n = vnoise(x * 0.04, z * 0.04) * 2 + vnoise(x * 0.11, z * 0.11) * 0.6;
  return (n - 1.3) * 1.6 * smooth(24, 60, r);
}

// distance from point to segment in xz
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const C = (hex) => new THREE.Color(hex);
const PAL = {
  dawnTop: C('#3E5A5C'), dawnHorizon: C('#F3B98A'), dawnFog: C('#9A9782'),
  nightTop: C('#070B10'), nightHorizon: C('#16222A'), nightFog: C('#0B1217'),
  ember: C('#E8873A'),
};

const CABIN = new THREE.Vector3(-1, 0, -16);

// ---------- camera path, in section units ----------
function orbit(deg, r, h) {
  const a = THREE.MathUtils.degToRad(deg);
  return [Math.sin(a) * r, h, Math.cos(a) * r];
}
const MUG_T = [0, 0.56, 0];
const KEYS = [
  [0.0, [0, 34, 22], [0, 18, 0], 45],
  [0.9, [1.5, 28, 18], [0, 13, 0], 45],
  [1.5, [5, 11, 13], [0, 4, 0], 48],
  [2.0, [2.4, 1.6, 4.6], [0, 0.7, 0], 45],
  [2.45, orbit(15, 0.47, 0.71), MUG_T, 40],
  [3.0, orbit(70, 0.41, 0.67), MUG_T, 40],
  [3.45, orbit(110, 0.36, 0.8), [0, 0.55, 0], 40],
  [4.0, orbit(130, 0.36, 0.8), [0, 0.55, 0], 40],
  [4.5, [3.5, 2.0, 6.5], [0, 1.4, -5], 50],
  [5.0, [6, 3.4, 11], [0, 2.2, -9], 50],
].map(([t, p, g, f]) => ({ t, p: new THREE.Vector3(...p), g: new THREE.Vector3(...g), f }));

const _p = new THREE.Vector3(), _g = new THREE.Vector3();
function cameraPose(t) {
  if (t <= KEYS[0].t) return [KEYS[0].p, KEYS[0].g, KEYS[0].f];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (t <= b.t) {
      const k = smooth(a.t, b.t, t);
      _p.lerpVectors(a.p, b.p, k);
      _g.lerpVectors(a.g, b.g, k);
      return [_p, _g, lerp(a.f, b.f, k)];
    }
  }
  const z = KEYS[KEYS.length - 1];
  return [z.p, z.g, z.f];
}

// ---------- soft point sprites (steam, dust, fireflies) ----------
function pointsMaterial(color, { additive = false, boost = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uColor: { value: C(color) },
      uScale: { value: 400 },
      uOpacity: { value: 1 },
      uBoost: { value: boost },
    },
    vertexShader: /* glsl */`
      attribute float aSize; attribute float aAlpha;
      uniform float uScale; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.5, aSize * uScale / -mv.z);
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity; uniform float uBoost; varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(uColor * uBoost, a * vAlpha * uOpacity);
      }`,
  });
}

function makePoints(count, color, opts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1));
  const m = new THREE.Points(g, pointsMaterial(color, opts));
  m.frustumCulled = false;
  return m;
}

// ---------- canvas textures ----------
function ringTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#B68A5E'; x.fillRect(0, 0, 512, 512);
  const r2 = mulberry32(77);
  for (let r = 6; r < 250; r += 5 + r2() * 9) {
    x.strokeStyle = `rgba(92,60,34,${0.25 + r2() * 0.4})`;
    x.lineWidth = 1 + r2() * 2.5;
    x.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.05) {
      const w = r + Math.sin(a * 3 + r) * 1.5 + Math.sin(a * 7) * 0.8;
      const px = 256 + Math.cos(a) * w, py = 256 + Math.sin(a) * w;
      a === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.stroke();
  }
  x.strokeStyle = 'rgba(60,38,20,.6)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(256, 256); x.lineTo(256 + 180, 256 - 60); x.stroke();
  x.fillStyle = '#4A3526';
  x.beginPath(); x.arc(256, 256, 256, 0, Math.PI * 2); x.arc(256, 256, 238, 0, Math.PI * 2, true); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function shaftTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  x.globalCompositeOperation = 'destination-in';
  const v = x.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.3, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = v; x.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

// ---------- the scene ----------
export function createScene(canvas, { mobile }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: mobile, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  console.info('Cafe Pine · THREE.REVISION', THREE.REVISION);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PAL.dawnFog.clone(), 0.022);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 520);

  const uniforms = { uTime: { value: 0 }, uSway: { value: 0.014 } };

  // sky dome
  const skyU = {
    uTop: { value: PAL.dawnTop.clone() }, uHorizon: { value: PAL.dawnHorizon.clone() },
    uFog: { value: PAL.dawnFog.clone() }, uSun: { value: new THREE.Vector3() }, uNight: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uTop, uHorizon, uFog, uSun; uniform float uNight; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float y = clamp(d.y, -1., 1.);
          vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, y));
          col = mix(uFog, col, smoothstep(-0.02, 0.16, y));
          float s = max(dot(d, normalize(uSun)), 0.);
          col += vec3(1.0,0.78,0.5) * (pow(s, 18.) * 0.55 + pow(s, 400.) * 1.2) * (1. - uNight);
          vec3 q = floor(d * 380.);
          float star = step(0.9975, h(q)) * smoothstep(0.08, 0.35, y) * uNight;
          col += vec3(star) * (0.6 + 0.4 * h(q + 3.));
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  scene.add(sky);

  // lights
  const hemi = new THREE.HemisphereLight('#CFE0D8', '#2A2418', 0.9);
  scene.add(hemi);
  const sunDir = new THREE.Vector3();
  {
    const el = THREE.MathUtils.degToRad(35), az = THREE.MathUtils.degToRad(225);
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  }
  skyU.uSun.value.copy(sunDir);
  const sun = new THREE.DirectionalLight('#FFC58A', 2.2);
  sun.position.copy(sunDir).multiplyScalar(30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 1, far: 70 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // ground
  {
    const g = new THREE.CircleGeometry(170, 140, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const a = C('#1F3220'), b = C('#3A4A24'), path = C('#5A4530'), moss = C('#3F5A2A'), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, groundHeight(x, z));
      const n = vnoise(x * 0.35, z * 0.35) * 0.6 + vnoise(x * 1.7, z * 1.7) * 0.4;
      tmp.copy(a).lerp(b, n);
      const r = Math.hypot(x, z);
      tmp.lerp(moss, smooth(6, 2.5, r) * 0.6);
      const pd = segDist(x, z, 0.4, 1.4, CABIN.x, CABIN.z + 2);
      tmp.lerp(path, smooth(1.2, 0.2, pd + (vnoise(x, z) - 0.5) * 0.6) * 0.85);
      cols.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // ---------- pines ----------
  const swayMaterial = (params) => {
    const m = new THREE.MeshStandardMaterial(params);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uSway = uniforms.uSway;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPhase; attribute float aShake; attribute float aBend;
          uniform float uTime; uniform float uSway;`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
          float hf = clamp(position.y, 0.0, 1.0); hf *= hf;
          float sway = uSway * sin(uTime * 1.13 + aPhase) + aShake;
          transformed.x += sway * hf * aBend;
          transformed.z += uSway * 0.6 * sin(uTime * 0.83 + aPhase * 1.7) * hf * aBend;`);
    };
    return m;
  };

  function foliageGeometry() {
    const parts = [];
    const tiers = 5;
    const low = C('#1F3A2A'), high = C('#3E6342');
    const r2 = mulberry32(31);
    for (let k = 0; k < tiers; k++) {
      const f = k / (tiers - 1);
      const radius = lerp(0.42, 0.13, f);
      const h = lerp(0.36, 0.3, f);
      const cone = new THREE.ConeGeometry(radius, h, 10, 2);
      const p = cone.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (y > h / 2 - 1e-4) continue;
        const ang = Math.atan2(z, x);
        const j = 1 + (Math.sin(ang * 5 + k * 1.7) * 0.5 + (r2() - 0.5)) * 0.3;
        const droop = y < -h / 2 + 1e-4 ? -0.035 * (Math.sin(ang * 10) * 0.5 + 0.5) : 0;
        p.setXYZ(i, x * j, y + droop, z * j);
      }
      cone.translate(0, 0.22 + f * 0.62 + h / 2, 0);
      const cols = new Float32Array(p.count * 3);
      const c = low.clone().lerp(high, f * 0.8);
      for (let i = 0; i < p.count; i++) {
        const shade = p.getY(i) > 0.22 + f * 0.62 + h * 0.4 ? 1.12 : 0.92;
        cols.set([c.r * shade, c.g * shade, c.b * shade], i * 3);
      }
      cone.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      parts.push(cone.toNonIndexed());
    }
    const g = mergeGeometries(parts);
    g.computeVertexNormals();
    return g;
  }

  const TREE_COUNT = mobile ? 140 : 240;
  const trees = [];
  {
    let guard = 0;
    while (trees.length < TREE_COUNT && guard++ < 20000) {
      const ang = rand() * Math.PI * 2;
      const r = 6.5 + Math.pow(rand(), 0.85) * 72;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (Math.hypot(x - CABIN.x, z - CABIN.z) < 7) continue;
      if (segDist(x, z, 5, 14, 3.5, 7.5) < 3.2 || segDist(x, z, 3.5, 7.5, 2, 3.5) < 2.4) continue;
      if (segDist(x, z, 5, 9, CABIN.x, CABIN.z + 3) < 2.6) continue;
      if (segDist(x, z, 0, 22, 2, 16) < 3) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.2)) continue;
      const h = rr(6, 19) * (r < 12 ? 0.85 : 1);
      const s = h * rr(0.2, 0.27);
      trees.push({ x, z, y: groundHeight(x, z) - 0.15, h, s, lean: [rr(-0.05, 0.05), rand() * 6.28, rr(-0.05, 0.05)], phase: rand() * 6.28, shake: 0, vel: 0 });
    }
  }
  const foliageGeo = foliageGeometry();
  const trunkGeo = new THREE.CylinderGeometry(0.03, 0.055, 1, 7, 3).translate(0, 0.5, 0);
  const aPhase = new THREE.InstancedBufferAttribute(new Float32Array(trees.length), 1);
  const aShake = new THREE.InstancedBufferAttribute(new Float32Array(trees.length), 1);
  const aBend = new THREE.InstancedBufferAttribute(new Float32Array(trees.length), 1);
  aShake.setUsage(THREE.DynamicDrawUsage);
  foliageGeo.setAttribute('aPhase', aPhase); foliageGeo.setAttribute('aShake', aShake); foliageGeo.setAttribute('aBend', aBend);
  trunkGeo.setAttribute('aPhase', aPhase); trunkGeo.setAttribute('aShake', aShake); trunkGeo.setAttribute('aBend', aBend);

  const foliage = new THREE.InstancedMesh(foliageGeo, swayMaterial({ vertexColors: true, roughness: 0.88, flatShading: true }), trees.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, swayMaterial({ color: '#3A2A1E', roughness: 0.95 }), trees.length);
  foliage.castShadow = trunks.castShadow = true;
  foliage.receiveShadow = true;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    trees.forEach((t, i) => {
      e.set(t.lean[0], t.lean[1], t.lean[2]);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.h, t.s));
      foliage.setMatrixAt(i, m); trunks.setMatrixAt(i, m);
      const hs = rr(-0.04, 0.04), ls = rr(0.82, 1.12);
      col.setRGB(ls * (1 + hs), ls, ls * (1 - hs * 0.5));
      foliage.setColorAt(i, col);
      aPhase.setX(i, t.phase);
      aBend.setX(i, t.h / t.s);
    });
  }
  scene.add(foliage, trunks);

  // ---------- clearing: stump, mug, lanterns, cabin ----------
  const clearing = new THREE.Group();
  scene.add(clearing);

  const barkMat = new THREE.MeshStandardMaterial({ color: '#4A3526', roughness: 0.95 });
  {
    const g = new THREE.CylinderGeometry(0.42, 0.5, 0.5, 40, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const rad = Math.hypot(x, z);
      if (rad < 0.01) continue;
      const k = 1 + (Math.sin(a * 23) * 0.012 + Math.sin(a * 7 + y * 9) * 0.01) * (Math.abs(y) < 0.249 ? 1 : 0.4);
      const flare = y < -0.2 ? 1 + (Math.sin(a * 5) * 0.5 + 0.5) * 0.08 : 1;
      p.setXYZ(i, x * k * flare, y, z * k * flare);
    }
    g.computeVertexNormals();
    const top = new THREE.MeshStandardMaterial({ map: ringTexture(), roughness: 0.8 });
    const stump = new THREE.Mesh(g, [barkMat, top, barkMat]);
    stump.position.y = 0.25;
    stump.castShadow = stump.receiveShadow = true;
    clearing.add(stump);
  }

  // mug
  const mug = new THREE.Group();
  mug.position.set(0.04, 0.5, 0.02);
  clearing.add(mug);
  const RIM = 0.104;
  {
    const pts = [
      [0.0, 0.0], [0.036, 0.0], [0.041, 0.002], [0.043, 0.008], [0.0445, 0.03], [0.0455, 0.07],
      [0.046, 0.0985], [0.046, RIM - 0.0001], [0.046, RIM], [0.0462, 0.109], [0.0445, 0.1105], [0.0412, 0.1095],
      [0.0402, 0.104], [0.0399, 0.1], [0.0394, 0.06], [0.0385, 0.02], [0.034, 0.0125], [0.0, 0.012],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(pts, 64);
    const cols = new Float32Array(g.attributes.position.count * 3);
    const glaze = C('#2F4A3A'), clay = C('#D9C7A8'), inner = C('#E6DCCB');
    for (let i = 0; i < g.attributes.position.count; i++) {
      const j = i % pts.length;
      const c = j >= 8 && j <= 12 ? clay : j > 12 ? inner : glaze;
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const body = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, envMap, envMapIntensity: 0.55 }));
    body.castShadow = true; body.receiveShadow = true;
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.025, 0.0065, 14, 28, Math.PI),
      new THREE.MeshPhysicalMaterial({ color: '#2F4A3A', roughness: 0.32, clearcoat: 0.6, envMap, envMapIntensity: 0.55 }),
    );
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(0.044, 0.058, 0);
    handle.castShadow = true;
    mug.add(body, handle);
  }
  // liquid layers
  const LIQ_BOTTOM = 0.0125, LIQ_TOP = RIM - 0.008 + 0.006; // surface sits ~8 mm below the rim top (0.110)
  const layerGeo = new THREE.CylinderGeometry(0.0386, 0.0384, 1, 48).translate(0, 0.5, 0);
  const layers = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(layerGeo, new THREE.MeshStandardMaterial({ color: '#3B2416', roughness: 0.3, envMap, envMapIntensity: 0.3 }));
    m.userData = { frac: 0, target: 0, from: new THREE.Color(), to: new THREE.Color() };
    m.scale.y = 0.0001;
    mug.add(m);
    return m;
  });
  let brew = { start: -10, dur: 0.7 };
  function setDrink(drink, now, instant = false) {
    for (let i = 0; i < 3; i++) {
      const L = layers[i];
      const spec = drink.layers[i];
      L.userData.fromFrac = L.userData.frac;
      L.userData.from.copy(L.material.color);
      if (spec) {
        const liq = LIQUIDS[spec[0]];
        L.userData.target = spec[1];
        L.userData.to.set(liq.color);
        // foam picks up the colour of what's underneath, so each drink reads from above
        if (spec[0] === 'foam' && i > 0) L.userData.to.lerp(new THREE.Color(LIQUIDS[drink.layers[i - 1][0]].color), 0.32);
        L.material.roughness = liq.rough;
      } else {
        L.userData.target = 0;
        L.userData.to.copy(L.material.color);
      }
    }
    brew = { start: now, dur: instant ? 0.0001 : 0.7 };
    puff(now, 10);
  }
  function updateLiquid(now) {
    const k = clamp((now - brew.start) / brew.dur);
    const e = 1 - Math.pow(1 - k, 3);
    let y = LIQ_BOTTOM;
    const total = LIQ_TOP - LIQ_BOTTOM;
    for (const L of layers) {
      const d = L.userData;
      d.frac = lerp(d.fromFrac ?? 0, d.target, e);
      L.material.color.copy(d.from).lerp(d.to, e);
      const h = Math.max(0.0001, d.frac * total);
      L.scale.y = h;
      L.position.y = y;
      L.visible = d.frac > 0.002;
      y += d.frac * total;
    }
    // slight slosh tilt while pouring
    const s = Math.sin(k * Math.PI) * 0.04;
    layers.forEach((L) => { L.rotation.z = s * Math.sin(now * 9); });
  }

  // mushrooms, rocks
  {
    const capMat = new THREE.MeshStandardMaterial({ color: '#B5532E', roughness: 0.6 });
    const stemMat = new THREE.MeshStandardMaterial({ color: '#E8DCC4', roughness: 0.8 });
    const spots = [[0.55, 0.15, 0.6], [0.62, -0.08, 0.45], [0.5, 0.32, 0.35], [-0.58, 0.3, 0.5], [-0.25, 0.6, 0.4]];
    spots.forEach(([x, z, s]) => {
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.05, 8).translate(0, 0.025, 0), stemMat);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.048, 0), capMat);
      g.add(stem, cap);
      g.position.set(x, 0, z); g.scale.setScalar(s * 2); g.rotation.z = (x > 0 ? -1 : 1) * 0.12;
      stem.castShadow = cap.castShadow = true;
      clearing.add(g);
    });
    const rockMat = new THREE.MeshStandardMaterial({ color: '#5E6358', roughness: 0.9, flatShading: true });
    [[1.6, 0.9, 0.22], [-1.9, -0.5, 0.3], [1.1, -1.6, 0.16], [-0.9, 1.7, 0.12]].forEach(([x, z, s]) => {
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
      r.position.set(x, s * 0.35, z); r.rotation.set(x, z, s * 9); r.scale.y = 0.6;
      r.castShadow = r.receiveShadow = true;
      clearing.add(r);
    });
  }

  // lanterns
  const lanternGlass = new THREE.MeshStandardMaterial({ color: '#2a1a0c', emissive: PAL.ember.clone(), emissiveIntensity: 0 });
  const postMat = new THREE.MeshStandardMaterial({ color: '#2E2219', roughness: 0.9 });
  const lanternLights = [];
  [[-1.7, -2.4, true], [2.1, -3.1, true], [-0.5, -8, false], [0.3, -12, false]].forEach(([x, z, light]) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.9, 8).translate(0, 0.95, 0), postMat));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.03), postMat); arm.position.set(0.14, 1.82, 0); g.add(arm);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.12), lanternGlass); glass.position.set(0.26, 1.68, 0); g.add(glass);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.07, 4).rotateY(Math.PI / 4), postMat); cap.position.set(0.26, 1.8, 0); g.add(cap);
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = x < 0 ? 0.3 : Math.PI - 0.4;
    g.children.forEach((c) => (c.castShadow = true));
    clearing.add(g);
    if (light) {
      const L = new THREE.PointLight('#E8873A', 0, 9, 1.6);
      glass.getWorldPosition(L.position);
      g.updateMatrixWorld(); glass.getWorldPosition(L.position);
      scene.add(L);
      lanternLights.push(L);
    }
  });

  // cabin
  const cabinLight = new THREE.PointLight('#F09A52', 0, 14, 1.4);
  const windowMat = new THREE.MeshStandardMaterial({ color: '#1a120a', emissive: C('#F09A52'), emissiveIntensity: 0.05 });
  {
    const cabin = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#3B2B20', roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#22261F', roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4.5), wood); body.position.y = 1.5;
    const shape = new THREE.Shape([new THREE.Vector2(-3.5, 0), new THREE.Vector2(3.5, 0), new THREE.Vector2(0, 2.4)]);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 5.2, bevelEnabled: false }).translate(0, 0, -2.6), roofMat);
    roof.position.y = 3;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 0.6), new THREE.MeshStandardMaterial({ color: '#4E4A44', roughness: 0.9 }));
    chimney.position.set(1.8, 4.4, -0.5);
    const winGeo = new THREE.PlaneGeometry(0.9, 1.1);
    [[-1.6, 1.7], [1.6, 1.7]].forEach(([x, y]) => {
      const w = new THREE.Mesh(winGeo, windowMat); w.position.set(x, y, 2.26); cabin.add(w);
    });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), windowMat); door.position.set(0, 1, 2.26);
    // porch steps
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.25, 0.8), wood); step.position.set(0, 0.12, 2.6);
    cabin.add(body, roof, chimney, door, step);
    cabin.children.forEach((c) => { c.castShadow = true; c.receiveShadow = true; });
    cabin.position.copy(CABIN); cabin.position.y = groundHeight(CABIN.x, CABIN.z) - 0.05;
    cabin.rotation.y = 0.18;
    scene.add(cabin);
    cabinLight.position.set(CABIN.x + 0.3, 1.6, CABIN.z + 3.6);
    scene.add(cabinLight);
  }

  // ---------- pinecones ----------
  const CONE_MAX = 30;
  const coneGeo = (() => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const y = i / 10;
      pts.push(new THREE.Vector2(Math.sin(Math.pow(y, 0.8) * Math.PI) * 0.032 * (1 - y * 0.35) + (i % 2) * 0.006, y * 0.085));
    }
    return new THREE.LatheGeometry(pts, 9).translate(0, -0.042, 0);
  })();
  const pinecones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: '#6B4A2E', roughness: 0.85, flatShading: true }), CONE_MAX);
  pinecones.castShadow = true;
  pinecones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cones = [];
  scene.add(pinecones);
  const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CONE_MAX; i++) pinecones.setMatrixAt(i, hideM);

  // ---------- particles ----------
  const STEAM = 40, PUFF = 24;
  const steam = makePoints(STEAM + PUFF, '#F4EEE6');
  const steamSeed = Array.from({ length: STEAM + PUFF }, () => [rand(), rand(), rand(), rand()]);
  const puffs = new Float32Array(PUFF).fill(-10);
  let puffCursor = 0;
  function puff(now, n = 12) {
    for (let i = 0; i < n; i++) { puffs[puffCursor] = now + i * 0.03; puffCursor = (puffCursor + 1) % PUFF; }
  }
  scene.add(steam);

  const DUST = mobile ? 300 : 600;
  const dust = makePoints(DUST, '#F3D9B0');
  const dustSeed = Array.from({ length: DUST }, () => [rr(-16, 16), rr(0.3, 34), rr(-14, 24), rand()]);
  scene.add(dust);

  const FF = 180;
  const ff = makePoints(FF, '#FFD27A', { additive: true, boost: 2.6 });
  const ffState = Array.from({ length: FF }, () => {
    const p = new THREE.Vector3(rr(-9, 9), rr(0.3, 3.2), rr(-19, 6));
    return { p, home: p.clone(), v: new THREE.Vector3(), seed: rand() * 100, burst: 0 };
  });
  scene.add(ff);

  // light shafts
  const shaftTex = shaftTexture();
  const shafts = new THREE.Group();
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: '#FFE1B8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  [[-6, 4], [7, -5], [-3, -9], [9, 6], [2, 9], [-10, -2], [4, -2]].forEach(([x, z], i) => {
    const w = 1.2 + (i % 3) * 0.7;
    const geo = new THREE.PlaneGeometry(w, 30);
    const a = new THREE.Mesh(geo, shaftMat), b = new THREE.Mesh(geo, shaftMat);
    b.rotation.y = Math.PI / 2;
    const s = new THREE.Group(); s.add(a, b);
    s.position.set(x, 12, z);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
    shafts.add(s);
  });
  scene.add(shafts);

  // ---------- post ----------
  let composer = null, bloom = null;
  if (!mobile) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ---------- sizing ----------
  let W = 1, H = 1;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, W < 768 ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    if (composer) { composer.setPixelRatio(dpr); composer.setSize(W, H); }
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  resize();

  // ---------- interaction ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const mugSphere = new THREE.Sphere(new THREE.Vector3(), 0.1);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointerGround = new THREE.Vector3(0, 0, -100);
  let pointerActive = false;

  function setRay(x, y) {
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function hitMug(x, y) {
    setRay(x, y);
    mug.getWorldPosition(mugSphere.center); mugSphere.center.y += 0.055;
    return raycaster.ray.intersectsSphere(mugSphere);
  }
  function hitTree(x, y) {
    setRay(x, y);
    raycaster.far = 90;
    const hits = raycaster.intersectObjects([foliage, trunks], false);
    raycaster.far = Infinity;
    return hits.length ? hits[0] : null;
  }
  function shakeTree(hit, now) {
    const i = hit.instanceId;
    const t = trees[i];
    t.vel += 1.4;
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const slot = cones.length < CONE_MAX ? cones.length : cones.reduce((o, c, j) => (c.born < cones[o].born ? j : o), 0);
      const ang = rand() * 6.28, rad = rr(0.3, 0.8) * t.s * 0.3;
      cones[slot] = {
        p: new THREE.Vector3(t.x + Math.cos(ang) * rad, t.y + t.h * rr(0.35, 0.6), t.z + Math.sin(ang) * rad),
        v: new THREE.Vector3(Math.cos(ang) * rr(0.4, 1.2), rr(0, 1.5), Math.sin(ang) * rr(0.4, 1.2)),
        rot: new THREE.Euler(rand() * 6, rand() * 6, rand() * 6), spin: rr(2, 6),
        born: now + k * 0.12, bounced: false, resting: false,
      };
    }
    return t;
  }
  function burst(x, y, now) {
    setRay(x, y);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, p)) return;
    p.y = 1.1;
    for (let k = 0; k < 24; k++) {
      const f = ffState[(Math.floor(now * 7) * 24 + k) % FF];
      f.p.copy(p);
      f.v.set(rr(-1, 1), rr(0.2, 1.4), rr(-1, 1)).normalize().multiplyScalar(rr(1.5, 3));
      f.burst = now;
    }
  }
  function pointerMove(x, y) {
    setRay(x, y);
    pointerActive = !!raycaster.ray.intersectPlane(groundPlane, pointerGround);
  }

  // ---------- per-frame ----------
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  const tmpC = new THREE.Color();
  let lastNow = 0;
  let mugSpin = 0, mugVel = 0;
  const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);

  function update(state) {
    const { t, now, night, parallax, reduced } = state;
    const dt = Math.min(0.05, Math.max(0, now - lastNow));
    lastNow = now;
    uniforms.uTime.value = now;
    uniforms.uSway.value = reduced ? 0 : 0.014;

    // camera
    const [p, g, fov] = cameraPose(t);
    camPos.copy(p); camTgt.copy(g);
    if (mobile) camPos.sub(camTgt).multiplyScalar(t > 2.2 && t < 4.3 ? 1.25 : 1.2).add(camTgt);
    const alt = camPos.y;
    const pScale = clamp((alt - 0.6) / 10, 0.04, 1) * 1.2;
    if (!reduced) { camPos.x += parallax.x * pScale; camPos.y += parallax.y * pScale * 0.5; }
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    camera.fov = fov;
    camera.near = clamp(alt * 0.03, 0.02, 0.4);
    // frame the HERO beside the copy panel
    const side = smooth(2.15, 2.5, t) * (1 - smooth(4.0, 4.4, t));
    const nightSide = smooth(4.3, 4.6, t);
    if (mobile) {
      camera.setViewOffset(W, H, 0, H * 0.2 * side + H * 0.08 * nightSide, W, H);
    } else {
      camera.setViewOffset(W, H, -W * 0.17 * side + W * 0.14 * nightSide, 0, W, H);
    }
    camera.updateProjectionMatrix();

    // time of day
    const day = 1 - night;
    skyU.uTop.value.copy(PAL.dawnTop).lerp(PAL.nightTop, night);
    skyU.uHorizon.value.copy(PAL.dawnHorizon).lerp(PAL.nightHorizon, night);
    tmpC.copy(PAL.dawnFog).lerp(PAL.nightFog, night);
    skyU.uFog.value.copy(tmpC);
    scene.fog.color.copy(tmpC);
    scene.fog.density = lerp(0.011, 0.022, smooth(30, 9, alt));
    skyU.uNight.value = night;
    sky.position.copy(camera.position);
    hemi.intensity = lerp(0.9, 0.22, night);
    hemi.color.set('#CFE0D8').lerp(C('#5C6E8C'), night);
    sun.intensity = lerp(2.2, 0.35, night);
    sun.color.set('#FFC58A').lerp(C('#8FA6C8'), night);
    renderer.toneMappingExposure = lerp(1.0, 0.85, night);
    lanternGlass.emissiveIntensity = lerp(0.0, 4, smooth(0.2, 0.8, night));
    windowMat.emissiveIntensity = lerp(0.05, 3.2, smooth(0.15, 0.7, night));
    lanternLights.forEach((L, i) => (L.intensity = smooth(0.2, 0.8, night) * (3.2 + Math.sin(now * 7 + i * 2) * 0.25 + Math.sin(now * 13.1 + i) * 0.15)));
    cabinLight.intensity = smooth(0.2, 0.8, night) * 5;
    shaftMat.opacity = 0.12 * day * smooth(0.6, 1.3, t) * (1 - smooth(2.1, 2.6, t));

    // tree shake springs (fixed substeps)
    let dirty = false;
    for (let i = 0; i < trees.length; i++) {
      const tr = trees[i];
      if (tr.vel === 0 && tr.shake === 0) continue;
      const steps = Math.ceil(dt * 120);
      for (let s = 0; s < steps; s++) {
        const h = 1 / 120;
        const acc = -90 * tr.shake - 7 * tr.vel;
        tr.vel += acc * h; tr.shake += tr.vel * h;
      }
      if (Math.abs(tr.shake) < 1e-4 && Math.abs(tr.vel) < 1e-3) { tr.shake = 0; tr.vel = 0; }
      aShake.setX(i, tr.shake);
      dirty = true;
    }
    if (dirty) aShake.needsUpdate = true;

    // pinecones
    for (let i = 0; i < CONE_MAX; i++) {
      const c = cones[i];
      if (!c || now < c.born) { pinecones.setMatrixAt(i, hideM); continue; }
      const age = now - c.born;
      if (!c.resting) {
        const steps = Math.ceil(dt * 120);
        for (let s = 0; s < steps; s++) {
          const h = 1 / 120;
          c.v.y -= 9.8 * h;
          c.p.addScaledVector(c.v, h);
          c.rot.x += c.spin * h; c.rot.z += c.spin * 0.7 * h;
          const gy = groundHeight(c.p.x, c.p.z) + 0.028;
          if (c.p.y < gy) {
            c.p.y = gy;
            if (!c.bounced && Math.abs(c.v.y) > 0.5) { c.v.y = -c.v.y * 0.3; c.v.x *= 0.5; c.v.z *= 0.5; c.bounced = true; c.spin *= 0.4; }
            else { c.resting = true; c.rot.set(Math.PI / 2, c.rot.y, 0); break; }
          }
        }
      }
      const fade = 1 - smooth(6, 6.8, age);
      if (fade <= 0) { cones[i] = null; pinecones.setMatrixAt(i, hideM); continue; }
      q.setFromEuler(c.rot);
      mat4.compose(c.p, q, one.set(fade, fade, fade));
      pinecones.setMatrixAt(i, mat4);
    }
    pinecones.instanceMatrix.needsUpdate = true;
    one.set(1, 1, 1);

    // mug spin
    if (!state.dragging) { mugVel *= Math.pow(0.92, dt * 60); }
    mugSpin += mugVel * dt;
    mug.rotation.y = -0.6 + mugSpin + (reduced ? 0 : Math.sin(now * 0.4) * 0.05);
    updateLiquid(now);

    // steam
    const sp = steam.geometry.attributes;
    const steamVis = smooth(1.8, 2.3, t) * (1 - smooth(4.3, 4.8, t));
    mug.getWorldPosition(_g);
    for (let i = 0; i < STEAM; i++) {
      const [a, b, c2, d] = steamSeed[i];
      const life = reduced ? (a % 1) : ((now * (0.16 + b * 0.1) + a) % 1);
      const sw = Math.sin(life * 6 + d * 6.28 + now * 0.8) * 0.012 * (0.3 + life);
      sp.position.setXYZ(i, _g.x + (c2 - 0.5) * 0.04 + sw, _g.y + 0.1 + life * 0.22, _g.z + (d - 0.5) * 0.04 + sw * 0.5);
      sp.aSize.setX(i, 0.018 + life * 0.06);
      sp.aAlpha.setX(i, Math.sin(life * Math.PI) * 0.22 * steamVis);
    }
    for (let k = 0; k < PUFF; k++) {
      const i = STEAM + k;
      const age = now - puffs[k];
      const [a, b, c2] = steamSeed[i];
      if (age < 0 || age > 1.6) { sp.aAlpha.setX(i, 0); continue; }
      const l = age / 1.6;
      sp.position.setXYZ(i, _g.x + (a - 0.5) * 0.08 * (0.3 + l), _g.y + 0.1 + l * 0.3 * (0.7 + b * 0.5), _g.z + (c2 - 0.5) * 0.08 * (0.3 + l));
      sp.aSize.setX(i, 0.03 + l * 0.08);
      sp.aAlpha.setX(i, Math.sin(l * Math.PI) * 0.35 * steamVis);
    }
    sp.position.needsUpdate = sp.aSize.needsUpdate = sp.aAlpha.needsUpdate = true;

    // dust
    const dp = dust.geometry.attributes;
    for (let i = 0; i < DUST; i++) {
      const [x, y, z, s] = dustSeed[i];
      const tt = reduced ? 0 : now;
      dp.position.setXYZ(i, x + Math.sin(tt * 0.15 + s * 20) * 1.2, y + ((tt * 0.15 * (0.5 + s)) % 3) - 1.5, z + Math.cos(tt * 0.12 + s * 9) * 1.2);
      dp.aSize.setX(i, 0.03 + s * 0.03);
      dp.aAlpha.setX(i, 0.5 * day * (0.4 + 0.6 * Math.sin(now * 0.7 + s * 30) ** 2));
    }
    dp.position.needsUpdate = dp.aSize.needsUpdate = dp.aAlpha.needsUpdate = true;

    // fireflies
    const fp = ff.geometry.attributes;
    const ffVis = smooth(0.35, 0.9, night);
    const attract = ffVis > 0.1 && pointerActive && !reduced;
    for (let i = 0; i < FF; i++) {
      const f = ffState[i];
      const s = f.seed;
      if (!reduced) {
        const wx = Math.sin(now * 0.6 + s) * 0.35, wy = Math.sin(now * 0.9 + s * 2) * 0.25, wz = Math.cos(now * 0.5 + s * 3) * 0.35;
        f.v.x += (wx - f.v.x) * 0.02; f.v.y += (wy - f.v.y) * 0.02; f.v.z += (wz - f.v.z) * 0.02;
        if (attract) {
          const dx = pointerGround.x - f.p.x, dz = pointerGround.z - f.p.z, dy = 1.2 - f.p.y;
          const d = Math.hypot(dx, dz);
          if (d < 3 && d > 0.15) { f.v.x += (dx / d) * 0.8 * dt * 3; f.v.z += (dz / d) * 0.8 * dt * 3; f.v.y += dy * dt; }
        }
        // spring home softly
        f.v.x += (f.home.x - f.p.x) * 0.02 * dt; f.v.y += (f.home.y - f.p.y) * 0.08 * dt; f.v.z += (f.home.z - f.p.z) * 0.02 * dt;
        f.v.multiplyScalar(now - f.burst < 1 ? 0.985 : 0.995);
        const sp2 = f.v.length(); if (sp2 > 3) f.v.multiplyScalar(3 / sp2);
        f.p.addScaledVector(f.v, dt);
        if (f.p.y < 0.15) { f.p.y = 0.15; f.v.y = Math.abs(f.v.y); }
      }
      const flick = reduced ? 0.8 : Math.max(0, Math.sin(now * (1.3 + (s % 1.7)) + s * 5)) ** 2;
      fp.position.setXYZ(i, f.p.x, f.p.y, f.p.z);
      fp.aSize.setX(i, 0.05 + (now - f.burst < 1.5 ? 0.04 : 0));
      fp.aAlpha.setX(i, ffVis * (0.25 + 0.75 * flick));
    }
    fp.position.needsUpdate = fp.aSize.needsUpdate = fp.aAlpha.needsUpdate = true;

    // point sprite scale
    const scale = (H * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    steam.material.uniforms.uScale.value = dust.material.uniforms.uScale.value = ff.material.uniforms.uScale.value = scale;

    if (composer) composer.render(); else renderer.render(scene, camera);
    return { alt: Math.max(0, alt - 0.66) };
  }

  return {
    renderer, update, resize, setDrink,
    hitMug, hitTree, shakeTree, burst, pointerMove, puff,
    spinMug(v) { mugVel = v; },
    nudgeMug(d) { mugSpin += d; },
    info: () => ({ trees: trees.length, cones: cones.filter(Boolean).length, revision: THREE.REVISION }),
  };
}
