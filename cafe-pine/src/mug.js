import * as THREE from 'three';
import { LIQUIDS } from './site.js';
import { clamp, lerp } from './util.js';

const RIM = 0.104;
const LIQ_BOTTOM = 0.0125, LIQ_TOP = 0.102; // surface ~8 mm below the rim top (0.110)

export function makeMug() {
  const mug = new THREE.Group();
  const pts = [
    [0.0, 0.0], [0.036, 0.0], [0.041, 0.002], [0.043, 0.008], [0.0445, 0.03], [0.0455, 0.07],
    [0.046, 0.0985], [0.046, RIM - 0.0001], [0.046, RIM], [0.0462, 0.109], [0.0445, 0.1105], [0.0412, 0.1095],
    [0.0402, 0.104], [0.0399, 0.1], [0.0394, 0.06], [0.0385, 0.02], [0.034, 0.0125], [0.0, 0.012],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 72);
  const cols = new Float32Array(g.attributes.position.count * 3);
  const glaze = new THREE.Color('#284232'), clay = new THREE.Color('#D9C7A8'), inner = new THREE.Color('#E6DCCB');
  for (let i = 0; i < g.attributes.position.count; i++) {
    const j = i % pts.length;
    const c = j >= 8 && j <= 12 ? clay : j > 12 ? inner : glaze;
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const glazeMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.12, envMapIntensity: 0.6 });
  const body = new THREE.Mesh(g, glazeMat);
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.025, 0.0065, 16, 32, Math.PI),
    new THREE.MeshPhysicalMaterial({ color: '#2F4A3A', roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
  );
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0.044, 0.058, 0);
  body.castShadow = handle.castShadow = true;
  body.receiveShadow = true;
  mug.add(body, handle);

  const layerGeo = new THREE.CylinderGeometry(0.0386, 0.0384, 1, 48).translate(0, 0.5, 0);
  const layers = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(layerGeo, new THREE.MeshPhysicalMaterial({ color: '#3B2416', roughness: 0.3, clearcoat: 0.3 }));
    m.userData = { frac: 0, fromFrac: 0, target: 0, from: new THREE.Color(), to: new THREE.Color() };
    m.scale.y = 0.0001;
    mug.add(m);
    return m;
  });
  let brew = { start: -10, dur: 0.7 };

  function setDrink(drink, now, instant = false) {
    for (let i = 0; i < 3; i++) {
      const L = layers[i], spec = drink.layers[i];
      L.userData.fromFrac = L.userData.frac;
      L.userData.from.copy(L.material.color);
      if (spec) {
        const liq = LIQUIDS[spec[0]];
        L.userData.target = spec[1];
        L.userData.to.set(liq.color);
        if (spec[0] === 'foam' && i > 0) L.userData.to.lerp(new THREE.Color(LIQUIDS[drink.layers[i - 1][0]].color), 0.3);
        L.material.roughness = liq.rough;
      } else {
        L.userData.target = 0;
        L.userData.to.copy(L.material.color);
      }
    }
    brew = { start: now, dur: instant ? 0.0001 : 0.7 };
  }

  function update(now) {
    const k = clamp((now - brew.start) / brew.dur);
    const e = 1 - Math.pow(1 - k, 3);
    let y = LIQ_BOTTOM;
    const total = LIQ_TOP - LIQ_BOTTOM;
    for (const L of layers) {
      const d = L.userData;
      d.frac = lerp(d.fromFrac, d.target, e);
      L.material.color.copy(d.from).lerp(d.to, e);
      L.scale.y = Math.max(0.0001, d.frac * total);
      L.position.y = y;
      L.visible = d.frac > 0.002;
      y += d.frac * total;
    }
    const s = Math.sin(k * Math.PI) * 0.04;
    layers.forEach((L) => { L.rotation.z = s * Math.sin(now * 9); });
  }

  return { group: mug, setDrink, update, materials: [glazeMat, handle.material, ...layers.map((l) => l.material)] };
}
