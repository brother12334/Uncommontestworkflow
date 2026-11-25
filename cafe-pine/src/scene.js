import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import * as TX from './textures.js';
import { buildForest } from './forest.js';
import { buildCabin, stoneMesh, L } from './cabin.js';
import { buildInterior } from './interior.js';
import { makeMug } from './mug.js';
import { mulberry32, clamp, smooth, lerp, groundHeight } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- camera path in section units (0 canopy … 6 night vista) ----------
const MUG = V(2.05, L.FLOOR + 0.46, -2.6);
function orbit(deg, r, h) { const a = THREE.MathUtils.degToRad(deg); return [MUG.x + Math.sin(a) * r, MUG.y + h, MUG.z + Math.cos(a) * r]; }
const MT = [MUG.x, MUG.y + 0.06, MUG.z];
const KEYS = [
  [0.0, [6, 34, 40], [0, 14, 5], 50],
  [0.9, [4, 27, 33], [-1, 10, 4], 50],
  [1.5, [-2, 13, 26], [-1, 4, 4], 50],
  [2.0, [-8.5, 2.3, 20], [0, 3.2, 2], 45],
  [2.28, [-9.6, 1.75, 16.5], [0.6, 3.3, 1.5], 45],
  [2.52, [-8.4, 1.75, 14.6], [0.4, 3.2, 2], 45],
  [2.75, [-2.7, 2.0, 9.8], [-2.4, 2.6, 5], 55],
  [2.92, [-2.7, 3.1, 6.6], [1.3, 3.0, 4.6], 60],
  [3.05, [1.3, 3.1, 5.6], [1.3, 3.0, 2.0], 60],
  [3.22, [1.3, 3.0, 3.3], [0.6, 2.8, -1.0], 62],
  [3.5, [-3.0, 3.05, 2.9], [1.0, 2.25, -3.4], 64],
  [3.8, [-1.4, 3.0, 0.9], [3.6, 2.2, -2.6], 60],
  [4.05, [0.9, 2.7, 0.2], [2.05, 1.95, -2.6], 50],
  [4.25, orbit(-70, 0.42, 0.24), MT, 40],
  [4.95, orbit(-110, 0.38, 0.26), MT, 40],
  [5.02, [1.0, 3.0, -1.2], [1.3, 3.0, 4.0], 60],
  [5.12, [1.3, 3.0, 3.0], [1.3, 3.0, 8], 60],
  [5.3, [-2.7, 3.1, 6.6], [-8, 1.6, 15], 55],
  [5.6, [-6.0, 1.75, 12.5], [0, 3, 2], 50],
  [6.0, [-10.5, 1.8, 18], [0.5, 3.4, 1.5], 48],
].map(([t, p, g, f]) => ({ t, p: V(...p), g: V(...g), f }));
const _p = V(0, 0, 0), _g = V(0, 0, 0);
function cameraPose(t) {
  if (t <= KEYS[0].t) return [KEYS[0].p, KEYS[0].g, KEYS[0].f];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (t <= b.t) {
      const k = smooth(a.t, b.t, t);
      return [_p.lerpVectors(a.p, b.p, k), _g.lerpVectors(a.g, b.g, k), lerp(a.f, b.f, k)];
    }
  }
  const z = KEYS[KEYS.length - 1];
  return [z.p, z.g, z.f];
}
export const INSIDE = [3.1, 5.08];

// ---------- point sprites ----------
function pointsMaterial(color, { additive = false, boost = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 400 }, uBoost: { value: boost } },
    vertexShader: `attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vAlpha;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = max(1.5, aSize * uScale / -mv.z); vAlpha = aAlpha; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uBoost; varying float vAlpha;
      void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); a *= a; gl_FragColor = vec4(uColor * uBoost, a * vAlpha); }`,
  });
}
function makePoints(count, color, opts, geo) {
  const g = geo || new THREE.BufferGeometry();
  if (!geo) {
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1));
  }
  const m = new THREE.Points(g, pointsMaterial(color, opts));
  m.frustumCulled = false;
  return m;
}
function shaftTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  x.globalCompositeOperation = 'destination-in';
  const v = x.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.35, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = v; x.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 }, uVig: { value: 0.25 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.95, 0.25, length(vUv - .5) * 1.25);
      c.rgb *= mix(1. - uVig, 1., v);
      c.rgb += (h(vUv * 1000.) - .5) * uGrain;
      gl_FragColor = c; }`,
};

export async function createScene(canvas, { tier, onProgress = () => {} }) {
  const mobile = tier === 'low';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'low', powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  console.info('Cafe Pine · THREE.REVISION', THREE.REVISION, '· tier', tier);

  // ---------- textures ----------
  const S1 = tier === 'high' ? 1024 : 512, S2 = tier === 'low' ? 256 : 512;
  const T = {};
  const jobs = [
    ['planks', () => TX.planksWall(S1)],
    ['ceiling', () => TX.boards(S2, { tile: 2, width: 0.125, palette: ['#D8B98C', '#CFA978', '#E0C49A', '#C79E6E'], seed: 12, rough: 0.5 })],
    ['beam', () => TX.darkBeam(S2)],
    ['log', () => TX.logWood(S1)],
    ['deck', () => TX.boards(S2, { tile: 2, width: 2 / 14, palette: ['#6B5A48', '#7A6650', '#5E4E3E', '#837058'], seed: 4, rough: 0.68, gap: 0.007 })],
    ['walnut', () => TX.walnut(S2)],
    ['barkPine', () => TX.bark(S2, 'pine')],
    ['barkMaple', () => TX.bark(S2, 'maple')],
    ['stone', () => TX.stone(S2)],
    ['mortar', () => TX.mortar(256)],
    ['blocks', () => TX.blocks(256)],
    ['shingles', () => TX.shingles(S2)],
    ['metal', () => TX.metalSeam(256)],
    ['leatherTufted', () => TX.leather(S1, true)],
    ['leatherPlain', () => TX.leather(S2, false)],
    ['felt', () => TX.fabric(256, '#A3282A', { pile: 200 })],
    ['carpet', () => TX.fabric(S2, '#5F6457', { pile: 260, var: 0.3 })],
    ['wool', () => TX.fabric(256, '#8A3A2A', { pile: 120 })],
    ['linen', () => TX.fabric(256, '#E8DCC4', { pile: 200, var: 0.15, rough: 0.9 })],
    ['rug', () => TX.rug(512)],
    ['floor', () => TX.forestFloor(S1)],
    ['gravel', () => TX.gravel(tier === 'low' ? 512 : 1024)],
  ];
  for (let i = 0; i < jobs.length; i++) {
    T[jobs[i][0]] = jobs[i][1]();
    onProgress((i + 1) / (jobs.length + 4));
    if (i % 3 === 2) await tick();
  }
  T.needle = TX.needleCard(512); T.leaf = TX.leafCard(512); T.fern = TX.fernCard(256);
  T.sign = TX.signTex(); T.lattice = TX.latticeTex(); T.ember = TX.emberTex();
  await tick();

  // ---------- scene, sky, lights ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2500);
  const uniforms = {
    uTime: { value: 0 }, uSway: { value: 0.012 },
    uSunView: { value: V(0, 1, 0) }, uSunCol: { value: new THREE.Color('#FFE2B0') },
  };

  const sky = new Sky();
  sky.scale.setScalar(1800);
  const su = sky.material.uniforms;
  su.turbidity.value = 6; su.rayleigh.value = 1.4; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  scene.add(sky);
  const envScene = new THREE.Scene();
  const skyEnv = new THREE.Mesh(sky.geometry, sky.material); skyEnv.scale.setScalar(1800);
  envScene.add(skyEnv);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, envNight = -1;
  const sunDir = V(0, 1, 0);
  function setSun(night) {
    const el = THREE.MathUtils.degToRad(lerp(18, -8, night)), az = THREE.MathUtils.degToRad(215);
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    su.sunPosition.value.copy(sunDir);
    if (Math.abs(night - envNight) > 0.02) {
      const old = envRT;
      envRT = pmrem.fromScene(envScene, 0, 0.1, 4000);
      scene.environment = envRT.texture;
      if (old) old.dispose();
      envNight = night;
    }
  }
  setSun(0);

  const fogDay = new THREE.Color('#9FA7A0'), fogNight = new THREE.Color('#06090C');
  scene.fog = new THREE.FogExp2(fogDay.clone(), 0.008);

  const sun = new THREE.DirectionalLight('#FFE2B0', 3.0);
  sun.castShadow = true;
  const SM = tier === 'high' ? 4096 : tier === 'medium' ? 2048 : 1024;
  sun.shadow.mapSize.set(SM, SM);
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight('#8FA6C8', 0);
  moon.position.set(30, 60, 40);
  scene.add(moon);
  const hemi = new THREE.HemisphereLight('#B8C8D8', '#2A2418', 0.0);
  scene.add(hemi);

  const mats = [];
  onProgress(0.86); await tick();
  const forest = buildForest(scene, T, uniforms, { tier });
  onProgress(0.92); await tick();
  const cabin = buildCabin(scene, T, { mats });
  const interior = buildInterior(scene, T, { mats, stones: cabin.stones });
  scene.add(stoneMesh(cabin.stones, T, mulberry32(3)));
  for (const lt of [interior.fireLight, interior.lampLight, interior.counterLight]) scene.attach(lt);
  scene.attach(interior.counterLight.target);
  onProgress(0.97); await tick();

  // hero mug + counter mugs
  const hero = makeMug();
  hero.group.position.copy(interior.mugAnchor);
  scene.add(hero.group);
  for (const [x, z] of interior.mugSpots) {
    const m = makeMug();
    m.setDrink({ layers: [] }, 0, true); m.update(1);
    m.group.position.set(x, L.FLOOR + 1.06, z);
    m.group.rotation.y = x * 7;
    scene.add(m.group);
  }

  // pinecones
  const CONE_MAX = 30;
  const coneGeo = (() => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const y = i / 12; pts.push(new THREE.Vector2(Math.sin(Math.pow(y, 0.8) * Math.PI) * 0.032 * (1 - y * 0.35) + (i % 2) * 0.007, y * 0.09)); }
    return new THREE.LatheGeometry(pts, 10).translate(0, -0.045, 0);
  })();
  const pinecones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: '#6B4A2E', roughness: 0.85, flatShading: true }), CONE_MAX);
  pinecones.castShadow = true; pinecones.frustumCulled = false;
  pinecones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CONE_MAX; i++) pinecones.setMatrixAt(i, hideM);
  scene.add(pinecones);
  const cones = [];

  // particles
  const rand = mulberry32(1127);
  const rr = (a, b) => a + (b - a) * rand();
  const STEAM = 40, PUFF = 24;
  const steam = makePoints(STEAM + PUFF, '#F4EEE6');
  const steamSeed = Array.from({ length: STEAM + PUFF }, () => [rand(), rand(), rand(), rand()]);
  const puffs = new Float32Array(PUFF).fill(-10);
  let puffCursor = 0;
  function puff(now, n = 12) { for (let i = 0; i < n; i++) { puffs[puffCursor] = now + i * 0.03; puffCursor = (puffCursor + 1) % PUFF; } }
  scene.add(steam);
  const DUST = mobile ? 250 : 500;
  const dust = makePoints(DUST, '#F6E2BC');
  const dustSeed = Array.from({ length: DUST }, () => [rr(-16, 14), rr(1, 34), rr(-4, 40), rand()]);
  scene.add(dust);
  const FF = 180;
  const ff = makePoints(FF, '#FFD27A', { additive: true, boost: 3 });
  const ffState = Array.from({ length: FF }, () => { const p = V(rr(-15, 9), rr(0.3, 3), rr(6, 24)); return { p, home: p.clone(), v: V(0, 0, 0), seed: rand() * 100, burst: -10 }; });
  scene.add(ff);
  const sparks = makePoints(0, '#FFB060', { additive: true, boost: 3 }, interior.sparkGeo);
  scene.add(sparks);
  const stars = (() => {
    const n = 1600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = rand() * 6.28, y = 0.08 + rand() * 0.92, rad = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * rad * 900, y * 900, Math.sin(th) * rad * 900], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: '#DCE6FF', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  })();
  scene.add(stars);
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), color: '#FFE6C0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const shafts = new THREE.Group();
  [[-6, 14], [5, 20], [-3, 8], [9, 12], [1, 28], [-11, 22], [4, 4], [-8, 30]].forEach(([x, z], i) => {
    const geo = new THREE.PlaneGeometry(1.4 + (i % 3) * 0.9, 34);
    const a = new THREE.Mesh(geo, shaftMat), b = new THREE.Mesh(geo, shaftMat); b.rotation.y = Math.PI / 2;
    const s = new THREE.Group(); s.add(a, b); s.position.set(x, 13, z);
    shafts.add(s);
  });
  scene.add(shafts);

  // ---------- materials: environment control ----------
  const envMats = [];
  scene.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.isMeshStandardMaterial && !envMats.includes(m)) { m.userData.env = m.envMapIntensity ?? 1; envMats.push(m); }
    }
  });
  let envFactor = -1;
  function setEnv(f) {
    if (Math.abs(f - envFactor) < 0.005) return;
    envFactor = f;
    for (const m of envMats) m.envMapIntensity = m.userData.env * f;
  }

  // ---------- post ----------
  let composer = null, gtao = null, bloom = null, bokeh = null, grain = null;
  if (tier !== 'low') {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (tier === 'high') {
      gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      gtao.blendIntensity = 1;
      composer.addPass(gtao);
    }
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.6, 0.9);
    composer.addPass(bloom);
    if (tier === 'high') {
      bokeh = new BokehPass(scene, camera, { focus: 0.4, aperture: 0.004, maxblur: 0.008 });
      composer.addPass(bokeh);
    }
    composer.addPass(new OutputPass());
    grain = new ShaderPass(GrainShader);
    composer.addPass(grain);
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
  const groundPlane = new THREE.Plane(V(0, 1, 0), 0);
  const pointerGround = V(0, 0, -100);
  let pointerActive = false;
  function setRay(x, y) { ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1); raycaster.setFromCamera(ndc, camera); }
  const sphere = new THREE.Sphere();
  function hitMug(x, y) { setRay(x, y); sphere.center.copy(hero.group.position); sphere.center.y += 0.055; sphere.radius = 0.1; return raycaster.ray.intersectsSphere(sphere); }
  function hitFire(x, y) { setRay(x, y); sphere.center.copy(interior.fireHit.center); sphere.radius = interior.fireHit.radius; return raycaster.ray.intersectsSphere(sphere); }
  function hitTree(x, y) {
    setRay(x, y);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    let best = null, bestT = 80;
    for (const tr of forest.trees) {
      if (tr.lod !== 'hi') continue;
      const R = tr.crown * 0.75;
      const ox = o.x - tr.x, oz = o.z - tr.z;
      const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - R * R;
      const disc = b * b - 4 * a * c;
      if (disc < 0 || a < 1e-6) continue;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0 || t > bestT) continue;
      const y = o.y + d.y * t;
      if (y < tr.y + tr.h * 0.3 || y > tr.y + tr.h) continue;
      best = tr; bestT = t;
    }
    return best;
  }
  function shakeTree(tr, now) {
    tr.vel += 1.1;
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      let slot = cones.findIndex((c) => !c);
      if (slot < 0) slot = cones.length < CONE_MAX ? cones.length : cones.reduce((o, c, j) => (c.born < cones[o].born ? j : o), 0);
      const ang = rand() * 6.28, rad = rr(0.3, 1) * tr.crown * 0.5;
      cones[slot] = {
        p: V(tr.x + Math.cos(ang) * rad, tr.y + tr.h * rr(0.45, 0.7), tr.z + Math.sin(ang) * rad),
        v: V(Math.cos(ang) * rr(0.3, 1), rr(0, 1.2), Math.sin(ang) * rr(0.3, 1)),
        rot: new THREE.Euler(rand() * 6, rand() * 6, rand() * 6), spin: rr(2, 6), born: now + k * 0.12, bounced: false, resting: false,
      };
    }
  }
  function burst(x, y, now) {
    setRay(x, y);
    const p = V(0, 0, 0);
    if (!raycaster.ray.intersectPlane(groundPlane, p)) return;
    p.y = 1.1;
    for (let k = 0; k < 24; k++) {
      const f = ffState[(Math.floor(now * 7) * 24 + k) % FF];
      f.p.copy(p); f.v.set(rr(-1, 1), rr(0.2, 1.4), rr(-1, 1)).normalize().multiplyScalar(rr(1.5, 3)); f.burst = now;
    }
  }
  function pointerMove(x, y) { setRay(x, y); pointerActive = !!raycaster.ray.intersectPlane(groundPlane, pointerGround); }

  // ---------- per-frame ----------
  const camPos = V(0, 0, 0), camTgt = V(0, 0, 0), tmpC = new THREE.Color();
  let lastNow = 0, mugSpin = 0, mugVel = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = V(1, 1, 1), focus = V(0, 0, 0), nightSun = V(0.3, 0.8, 0.3).normalize();
  let tierNow = tier;

  function update(state) {
    const { t, now, night, parallax, reduced } = state;
    const dt = Math.min(0.05, Math.max(0, now - lastNow));
    lastNow = now;
    uniforms.uTime.value = now;
    uniforms.uSway.value = reduced ? 0 : 0.012;
    const inside = smooth(INSIDE[0] - 0.08, INSIDE[0] + 0.05, t) * (1 - smooth(INSIDE[1] - 0.04, INSIDE[1] + 0.06, t));

    // camera
    const [p, g, fov] = cameraPose(t);
    camPos.copy(p); camTgt.copy(g);
    if (mobile) {
      const k = t > 4.15 && t < 5.0 ? 1.3 : t > 2.1 && t < 2.6 ? 1.25 : 1.0;
      camPos.sub(camTgt).multiplyScalar(k).add(camTgt);
    }
    const alt = camPos.y;
    const pScale = inside > 0.5 ? 0.04 : clamp((alt - 1.5) / 12, 0.08, 1);
    if (!reduced) { camPos.x += parallax.x * pScale; camPos.y -= parallax.y * pScale * 0.4; }
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    camera.fov = mobile ? Math.min(75, fov * 1.15) : fov;
    camera.near = t > 4.1 && t < 5.0 ? 0.02 : inside > 0.5 ? 0.04 : alt > 8 ? 0.3 : 0.06;
    const brewSide = smooth(4.12, 4.3, t) * (1 - smooth(4.92, 5.0, t));
    const cabinSide = smooth(2.1, 2.22, t) * (1 - smooth(2.52, 2.62, t));
    const nightSide = smooth(5.3, 5.55, t);
    if (mobile) camera.setViewOffset(W, H, 0, H * (0.22 * brewSide + 0.12 * cabinSide + 0.1 * nightSide), W, H);
    else camera.setViewOffset(W, H, -W * (0.17 * brewSide + 0.1 * cabinSide) + W * 0.1 * nightSide, 0, W, H);
    camera.updateProjectionMatrix();

    // time of day + exposure
    setSun(night);
    const day = 1 - night;
    sun.intensity = 3.0 * smooth(0.0, 0.25, sunDir.y + 0.02) * day;
    moon.intensity = 0.35 * night;
    hemi.intensity = 0.25 * night;
    tmpC.copy(fogDay).lerp(fogNight, night);
    scene.fog.color.copy(tmpC);
    scene.fog.density = lerp(0.008, 0.016, night) * lerp(0.7, 1.0, smooth(30, 8, alt));
    renderer.toneMappingExposure = lerp(lerp(0.62, 0.95, inside), 0.9, night);
    setEnv(lerp(1, 0.18, Math.max(inside, night * 0.6)));
    stars.material.opacity = night;
    uniforms.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    uniforms.uSunCol.value.set('#FFE2B0').multiplyScalar(day * (1 - inside));

    // shadow frustum follows the focus area, snapped to texels
    const ext = inside > 0.5 ? 8 : 26;
    focus.set(camTgt.x, 0, camTgt.z);
    if (alt > 12) focus.set(-1, 0, 6);
    const texel = (ext * 2) / SM;
    focus.x = Math.round(focus.x / texel) * texel; focus.z = Math.round(focus.z / texel) * texel;
    const sc = sun.shadow.camera;
    if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix(); }
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir.y > 0.05 ? sunDir : nightSun, 70);

    // lights by time
    const glow = smooth(0.15, 0.7, night);
    cabin.porch.forEach((pl, i) => { pl.intensity = lerp(0.4, 7, glow) * (1 + Math.sin(now * 9 + i) * 0.02); });
    cabin.lampGlass.emissiveIntensity = lerp(0.6, 5, glow);
    cabin.glassMat.emissiveIntensity = lerp(0, 1.6, glow);
    cabin.glassMat.opacity = lerp(0.38, 0.85, glow * (1 - inside));
    shaftMat.opacity = 0.09 * day * smooth(0.5, 1.2, t) * (1 - smooth(1.9, 2.3, t));

    interior.group.visible = t > 2.8 && t < 5.25;
    cabin.door.rotation.y = smooth(2.93, 3.12, t) * (1 - smooth(5.2, 5.4, t)) * 1.66;
    interior.update(now, { reduced });

    // tree springs
    const dirty = new Set();
    for (const tr of forest.trees) {
      if (tr.vel === 0 && tr.shake === 0) continue;
      const steps = Math.ceil(dt * 120);
      for (let s = 0; s < steps; s++) { const h = 1 / 120; tr.vel += (-70 * tr.shake - 5.5 * tr.vel) * h; tr.shake += tr.vel * h; }
      if (Math.abs(tr.shake) < 1e-4 && Math.abs(tr.vel) < 1e-3) { tr.shake = 0; tr.vel = 0; }
      tr.ref.shake.setX(tr.ref.i, tr.shake * 0.09);
      dirty.add(tr.ref.shake);
    }
    dirty.forEach((a) => { a.needsUpdate = true; });

    // pinecones
    for (let i = 0; i < CONE_MAX; i++) {
      const c = cones[i];
      if (!c || now < c.born) { pinecones.setMatrixAt(i, hideM); continue; }
      const age = now - c.born;
      if (!c.resting) {
        const steps = Math.ceil(dt * 120);
        for (let s = 0; s < steps; s++) {
          const h = 1 / 120;
          c.v.y -= 9.8 * h; c.p.addScaledVector(c.v, h);
          c.rot.x += c.spin * h; c.rot.z += c.spin * 0.7 * h;
          const gy = groundHeight(c.p.x, c.p.z) + 0.03;
          if (c.p.y < gy) {
            c.p.y = gy;
            if (!c.bounced && Math.abs(c.v.y) > 0.5) { c.v.y = -c.v.y * 0.3; c.v.x *= 0.5; c.v.z *= 0.5; c.bounced = true; c.spin *= 0.4; }
            else { c.resting = true; c.rot.set(Math.PI / 2, c.rot.y, 0); break; }
          }
        }
      }
      const fade = 1 - smooth(8, 8.8, age);
      if (fade <= 0) { cones[i] = null; pinecones.setMatrixAt(i, hideM); continue; }
      q.setFromEuler(c.rot);
      m4.compose(c.p, q, one.set(fade, fade, fade));
      pinecones.setMatrixAt(i, m4);
    }
    pinecones.instanceMatrix.needsUpdate = true;

    // mug
    if (!state.dragging) mugVel *= Math.pow(0.92, dt * 60);
    mugSpin += mugVel * dt;
    hero.group.rotation.y = 2.4 + mugSpin;
    hero.update(now);

    // steam, back-lit by the fire
    const sp = steam.geometry.attributes;
    const steamVis = smooth(3.9, 4.2, t) * (1 - smooth(4.98, 5.05, t));
    const mp = hero.group.position;
    for (let i = 0; i < STEAM; i++) {
      const [a, b, c2, d] = steamSeed[i];
      const life = reduced ? a : ((now * (0.16 + b * 0.1) + a) % 1);
      const sw = Math.sin(life * 6 + d * 6.28 + now * 0.8) * 0.012 * (0.3 + life);
      sp.position.setXYZ(i, mp.x + (c2 - 0.5) * 0.04 + sw, mp.y + 0.1 + life * 0.24, mp.z + (d - 0.5) * 0.04 + sw * 0.5);
      sp.aSize.setX(i, 0.018 + life * 0.06);
      sp.aAlpha.setX(i, Math.sin(life * Math.PI) * 0.2 * steamVis);
    }
    for (let k = 0; k < PUFF; k++) {
      const i = STEAM + k, age = now - puffs[k];
      const [a, b, c2] = steamSeed[i];
      if (age < 0 || age > 1.6) { sp.aAlpha.setX(i, 0); continue; }
      const l = age / 1.6;
      sp.position.setXYZ(i, mp.x + (a - 0.5) * 0.08 * (0.3 + l), mp.y + 0.1 + l * 0.3 * (0.7 + b * 0.5), mp.z + (c2 - 0.5) * 0.08 * (0.3 + l));
      sp.aSize.setX(i, 0.03 + l * 0.08);
      sp.aAlpha.setX(i, Math.sin(l * Math.PI) * 0.32 * steamVis);
    }
    sp.position.needsUpdate = sp.aSize.needsUpdate = sp.aAlpha.needsUpdate = true;

    // dust in the sun
    const dp = dust.geometry.attributes;
    for (let i = 0; i < DUST; i++) {
      const [x, y, z, s] = dustSeed[i];
      const tt = reduced ? 0 : now;
      dp.position.setXYZ(i, x + Math.sin(tt * 0.15 + s * 20) * 1.2, y + ((tt * 0.12 * (0.5 + s)) % 3) - 1.5, z + Math.cos(tt * 0.12 + s * 9) * 1.2);
      dp.aSize.setX(i, 0.025 + s * 0.03);
      dp.aAlpha.setX(i, 0.45 * day * (1 - inside) * (0.4 + 0.6 * Math.sin(now * 0.7 + s * 30) ** 2));
    }
    dp.position.needsUpdate = dp.aSize.needsUpdate = dp.aAlpha.needsUpdate = true;

    // fireflies
    const fp = ff.geometry.attributes;
    const ffVis = smooth(0.35, 0.9, night) * (1 - inside);
    const attract = ffVis > 0.1 && pointerActive && !reduced;
    for (let i = 0; i < FF; i++) {
      const f = ffState[i], s = f.seed;
      if (!reduced) {
        f.v.x += (Math.sin(now * 0.6 + s) * 0.35 - f.v.x) * 0.02; f.v.y += (Math.sin(now * 0.9 + s * 2) * 0.25 - f.v.y) * 0.02; f.v.z += (Math.cos(now * 0.5 + s * 3) * 0.35 - f.v.z) * 0.02;
        if (attract) {
          const dx = pointerGround.x - f.p.x, dz = pointerGround.z - f.p.z, d = Math.hypot(dx, dz);
          if (d < 3 && d > 0.15) { f.v.x += (dx / d) * 2.4 * dt; f.v.z += (dz / d) * 2.4 * dt; f.v.y += (1.2 - f.p.y) * dt; }
        }
        f.v.x += (f.home.x - f.p.x) * 0.02 * dt; f.v.y += (f.home.y - f.p.y) * 0.08 * dt; f.v.z += (f.home.z - f.p.z) * 0.02 * dt;
        f.v.multiplyScalar(now - f.burst < 1 ? 0.985 : 0.995);
        const spd = f.v.length(); if (spd > 3) f.v.multiplyScalar(3 / spd);
        f.p.addScaledVector(f.v, dt);
        const gy = groundHeight(f.p.x, f.p.z) + 0.15; if (f.p.y < gy) { f.p.y = gy; f.v.y = Math.abs(f.v.y); }
      }
      const flick = reduced ? 0.8 : Math.max(0, Math.sin(now * (1.3 + (s % 1.7)) + s * 5)) ** 2;
      fp.position.setXYZ(i, f.p.x, f.p.y, f.p.z);
      fp.aSize.setX(i, 0.045 + (now - f.burst < 1.5 ? 0.035 : 0));
      fp.aAlpha.setX(i, ffVis * (0.25 + 0.75 * flick));
    }
    fp.position.needsUpdate = fp.aSize.needsUpdate = fp.aAlpha.needsUpdate = true;

    const scale = (H * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (const pts of [steam, dust, ff, sparks]) pts.material.uniforms.uScale.value = scale;

    // post toggles
    if (gtao) gtao.enabled = tierNow === 'high' && inside > 0.5;
    if (bokeh) {
      bokeh.enabled = tierNow === 'high' && brewSide > 0.5;
      bokeh.uniforms.focus.value = camera.position.distanceTo(hero.group.position);
    }
    if (bloom) bloom.threshold = lerp(lerp(2.6, 0.95, inside), 0.9, night);
    if (grain) grain.uniforms.uTime.value = reduced ? 0 : (now % 10);

    if (composer) composer.render(); else renderer.render(scene, camera);

    const isIn = t > INSIDE[0] && t < INSIDE[1];
    return isIn
      ? { value: camera.position.distanceTo(interior.firePos) / 0.75, unit: 'steps' }
      : { value: Math.max(0, camera.position.y - 3.1), unit: 'm' };
  }

  return {
    renderer, update, resize,
    setDrink(d, now, instant) { hero.setDrink(d, now, instant); if (!instant) puff(now, 10); },
    hitMug, hitTree, hitFire, shakeTree, burst, pointerMove, puff,
    stoke(now) { interior.stoke(now); },
    spinMug(v) { mugVel = v; }, nudgeMug(d) { mugSpin += d; },
    setTier(tn) { tierNow = tn; },
    info: () => ({ trees: forest.trees.length, cones: cones.filter(Boolean).length, revision: THREE.REVISION, tier: tierNow, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  };
}
