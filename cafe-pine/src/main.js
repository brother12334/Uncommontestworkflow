import Lenis from 'lenis';
import { SITE, LIQUIDS } from './site.js';
import { createScene } from './scene.js';
import { createAudio } from './audio.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `$${n.toFixed(2)}`;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// ---------- render DOM from SITE ----------
const S = SITE;
const today = new Date().getDay();
$('#main').innerHTML = `
<section id="canopy" aria-labelledby="h-canopy">
  <div class="fx hero" data-win="-1,0.42" data-pose="0">
    <h1 id="h-canopy" class="hero-title">Cafe <span class="pine">Pine</span></h1>
    <div class="hero-sub">
      <p>${esc(S.tagline)} ${esc(S.canopy.intro)}</p>
      <div class="ctas">
        <a class="btn" href="${S.canopy.ctaPrimary.href}">${esc(S.canopy.ctaPrimary.label)}</a>
        <a class="btn ghost" href="${S.canopy.ctaSecondary.href}">${esc(S.canopy.ctaSecondary.label)}</a>
      </div>
    </div>
    <p class="hint">${esc(S.canopy.hint)}</p>
  </div>
</section>

<section id="descent" aria-label="How we make it">
  ${S.descent.map((b, i) => `
  <div class="fx panel d${i + 1}" data-win="${(1 + i * 0.34).toFixed(2)},${(1.36 + i * 0.34).toFixed(2)}" data-pose="${(1.18 + i * 0.34).toFixed(2)}">
    <span class="label">${esc(b.label)}</span>
    <h2>${esc(b.title)}</h2>
    <p>${esc(b.body)}</p>
    ${b.tip ? `<p class="tip">${esc(b.tip)}</p>` : ''}
  </div>`).join('')}
</section>

<section id="clearing" aria-labelledby="h-blend">
  <div class="fx panel left" data-win="2.28,3.02" data-pose="2.7">
    <span class="label">${esc(S.blend.label)}</span>
    <h2 id="h-blend">${esc(S.blend.title)}</h2>
    <p>${esc(S.blend.body)}</p>
    <ul class="notes" aria-label="Tasting notes">${S.blend.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <dl class="spec">${S.blend.spec.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <p class="tip">${esc(S.blend.hint)}</p>
  </div>
</section>

<section id="menu" aria-labelledby="h-menu">
  <div class="fx panel left brew" data-win="3.1,4.02" data-pose="3.6">
    <span class="label">${esc(S.menu.label)}</span>
    <h2 id="h-menu">${esc(S.menu.title)}</h2>
    <ul class="drinks" role="radiogroup" aria-labelledby="h-menu">
      ${S.menu.drinks.map((d) => `
      <li><button class="drink" role="radio" aria-checked="false" data-id="${d.id}" tabindex="-1">
        <span>${esc(d.name)}<small>${esc(d.notes)}</small></span>
        <span class="price">${money(d.price)}</span>
      </button></li>`).join('')}
    </ul>
    <div class="brew-foot">
      <div class="layers" id="layers" aria-hidden="true"></div>
      <button class="btn" id="addTray">Add to tray</button>
    </div>
  </div>
</section>

<section id="visit" aria-labelledby="h-visit">
  <div class="fx panel right" data-win="4.25,4.9" data-pose="4.6">
    <span class="label">${esc(S.visit.label)}</span>
    <h2 id="h-visit">${esc(S.visit.title)}</h2>
    <p>${esc(S.visit.body)}</p>
    <p class="open-now" id="openNow"></p>
    <ul class="hours">
      ${S.visit.hours.map((h) => `<li class="${h.d === today ? 'today' : ''}"><span>${esc(h.day)}</span><span>${h.open}–${h.close}</span></li>`).join('')}
    </ul>
    <p>${esc(S.address)}<br><span class="dim">${esc(S.visit.perk)}</span></p>
    <p class="tip">${esc(S.visit.hint)}</p>
  </div>
</section>`;

document.body.insertAdjacentHTML('beforeend', `
<footer class="foot" id="trailhead">
  <p class="foot-big">${S.footer.big.join('<br>')}</p>
  <div class="foot-row">
    <div class="ctas">
      <a class="btn" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(S.mapsQuery)}" target="_blank" rel="noopener">${esc(S.footer.directions)}</a>
      <a class="btn ghost" href="mailto:${esc(S.email)}">${esc(S.email)}</a>
    </div>
    <div class="toggles">
      <button class="toggle" data-sound aria-pressed="false">Sound off</button>
      <button class="toggle" id="motionToggle" aria-pressed="true">Motion on</button>
    </div>
  </div>
  <p class="small">${esc(S.footer.credit)} · ${esc(S.address)} · ${esc(S.phone)}</p>
</footer>`);
$('.top').insertAdjacentHTML('beforeend', '<button class="toggle sound-top" data-sound aria-pressed="false">Sound off</button>');

// open-now
(() => {
  const now = new Date();
  const h = S.visit.hours.find((x) => x.d === now.getDay());
  const mins = now.getHours() * 60 + now.getMinutes();
  const toM = (s) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
  const open = h && mins >= toM(h.open) && mins < toM(h.close);
  const el = $('#openNow');
  el.textContent = open ? `Open now · until ${h.close}` : `Closed now · ${h ? `${h.day} ${h.open}–${h.close}` : ''}`;
  el.classList.toggle('is-open', !!open);
})();

// ---------- motion preference ----------
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced = store.get('pine-motion') ? store.get('pine-motion') === 'reduced' : mq.matches;
const motionBtn = $('#motionToggle');
function applyMotion() {
  motionBtn.setAttribute('aria-pressed', String(!reduced));
  motionBtn.textContent = reduced ? 'Motion off' : 'Motion on';
  document.documentElement.classList.toggle('reduced', reduced);
  if (reduced && lenis) { lenis.destroy(); lenis = null; }
  if (!reduced && !lenis) lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.9 });
}
let lenis = null;
motionBtn.addEventListener('click', () => { reduced = !reduced; store.set('pine-motion', reduced ? 'reduced' : 'full'); applyMotion(); });

// ---------- scroll model ----------
const sectionEls = ['#canopy', '#descent', '#clearing', '#menu', '#visit'].map((s) => $(s));
let tops = [], heights = [], maxScroll = 1, rawMax = 5, vh = innerHeight;
function measure() {
  vh = innerHeight;
  tops = sectionEls.map((el) => el.offsetTop);
  heights = sectionEls.map((el) => el.offsetHeight);
  maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  rawMax = rawT(maxScroll);
}
function rawT(y) {
  for (let i = sectionEls.length - 1; i >= 0; i--) {
    if (y >= tops[i]) return i + (y - tops[i]) / heights[i];
  }
  return 0;
}
function tFromScroll(y) {
  const r = rawT(y);
  if (r <= 4) return r;
  return Math.min(5, 4 + (r - 4) / Math.max(0.01, rawMax - 4));
}
function scrollForT(t) {
  if (t > 4) t = 4 + (t - 4) * (rawMax - 4);
  const i = Math.min(4, Math.floor(t));
  return Math.min(maxScroll, tops[i] + (t - i) * heights[i]);
}
function scrollToT(t) {
  const y = scrollForT(t);
  if (lenis) lenis.scrollTo(y, { duration: 1.6 });
  else window.scrollTo(0, y);
}
const anchorT = { '#canopy': 0, '#descent': 1.2, '#clearing': 2.68, '#menu': 3.6, '#visit': 4.6, '#trailhead': 5 };
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const h = a.getAttribute('href');
  if (h in anchorT) { e.preventDefault(); scrollToT(anchorT[h]); if (h === '#menu') setTimeout(() => focusDrink(), 900); }
});

// fixed copy panels
const panels = [...document.querySelectorAll('.fx')].map((el) => {
  const [a, b] = el.dataset.win.split(',').map(Number);
  return { el, a, b, pose: Number(el.dataset.pose), r: -1 };
});
panels.forEach((p) => p.el.addEventListener('focusin', () => {
  if (p.r < 0.6) scrollToT(p.pose);
}));

// ---------- brew bar ----------
const drinkBtns = [...document.querySelectorAll('.drink')];
let current = S.menu.drinks.find((d) => d.id === 'latte') || S.menu.drinks[0];
function selectDrink(d, instant = false) {
  current = d;
  drinkBtns.forEach((b) => {
    const on = b.dataset.id === d.id;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('#layers').innerHTML = d.layers.map(([k]) => `<i style="background:${LIQUIDS[k].color}"></i>`).join('') + `<span>${d.layers.map(([k]) => k).join(' · ')}</span>`;
  $('#addTray').textContent = `Add to tray · ${money(d.price)}`;
  scene?.setDrink(d, performance.now() / 1000, instant);
}
function focusDrink() { drinkBtns.find((b) => b.tabIndex === 0)?.focus({ preventScroll: true }); }
drinkBtns.forEach((b, i) => {
  b.addEventListener('click', () => selectDrink(S.menu.drinks[i]));
  b.addEventListener('keydown', (e) => {
    const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const n = (i + dir + drinkBtns.length) % drinkBtns.length;
    selectDrink(S.menu.drinks[n]);
    drinkBtns[n].focus({ preventScroll: true });
  });
});

// ---------- tray ----------
const tray = $('#tray'), trayBtn = $('#trayOpen');
let order = {};
try { order = JSON.parse(store.get('pine-tray') || '{}') || {}; } catch { order = {}; }
function renderTray() {
  const ids = Object.keys(order).filter((id) => order[id] > 0 && S.menu.drinks.some((d) => d.id === id));
  let total = 0, count = 0;
  $('#trayList').innerHTML = ids.map((id) => {
    const d = S.menu.drinks.find((x) => x.id === id);
    const q = order[id]; total += q * d.price; count += q;
    return `<li><span class="name">${esc(d.name)}</span><span class="line-price">${money(q * d.price)}</span>
      <span class="qty"><button data-dec="${id}" aria-label="One less ${esc(d.name)}">−</button><output aria-live="polite">${q}</output><button data-inc="${id}" aria-label="One more ${esc(d.name)}">+</button></span></li>`;
  }).join('');
  $('#trayEmpty').hidden = ids.length > 0;
  $('#trayTotal').textContent = money(total);
  $('#trayCount').textContent = count;
  $('#copyOrder').disabled = count === 0;
  store.set('pine-tray', JSON.stringify(order));
  return { total, count, ids };
}
function openTray() {
  tray.hidden = false;
  requestAnimationFrame(() => tray.classList.add('open'));
  trayBtn.setAttribute('aria-expanded', 'true');
  setTimeout(() => $('#trayClose').focus(), 50);
}
function closeTray() {
  tray.classList.remove('open');
  trayBtn.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!tray.classList.contains('open')) tray.hidden = true; }, reduced ? 0 : 400);
  trayBtn.focus({ preventScroll: true });
}
trayBtn.addEventListener('click', () => (tray.classList.contains('open') ? closeTray() : openTray()));
$('#trayClose').addEventListener('click', closeTray);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tray.classList.contains('open')) closeTray(); });
$('#trayList').addEventListener('click', (e) => {
  const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
  if (inc) order[inc.dataset.inc] = (order[inc.dataset.inc] || 0) + 1;
  if (dec) order[dec.dataset.dec] = Math.max(0, (order[dec.dataset.dec] || 0) - 1);
  if (inc || dec) {
    const left = renderTray();
    if (left.count === 0) $('#trayClose').focus();
  }
});
$('#addTray').addEventListener('click', () => {
  order[current.id] = (order[current.id] || 0) + 1;
  renderTray();
  trayBtn.classList.add('bump'); setTimeout(() => trayBtn.classList.remove('bump'), 250);
  toast(`${current.name} added to your tray.`);
  scene?.puff(performance.now() / 1000, 14);
});
$('#copyOrder').addEventListener('click', async () => {
  const { total, ids } = renderTray();
  const lines = ids.map((id) => { const d = S.menu.drinks.find((x) => x.id === id); return `${order[id]} × ${d.name}  ${money(order[id] * d.price)}`; });
  const text = `Cafe Pine order\n${lines.join('\n')}\nTotal ${money(total)}`;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    } catch { ok = false; }
  }
  toast(ok ? 'Order copied. Paste it in a message or show it at the counter.' : 'Your browser blocked copying. The order is listed in the tray.');
});

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- sound ----------
const audio = createAudio();
const soundBtns = [...document.querySelectorAll('[data-sound]')];
soundBtns.forEach((b) => b.addEventListener('click', () => {
  const on = audio.toggle();
  soundBtns.forEach((x) => { x.setAttribute('aria-pressed', String(on)); x.textContent = on ? 'Sound on' : 'Sound off'; });
}));

// ---------- 3D ----------
const canvas = $('#scene');
const mobile = innerWidth < 768;
let scene = null;
try {
  scene = createScene(canvas, { mobile });
} catch (err) {
  document.documentElement.classList.add('no-webgl');
  console.info('WebGL unavailable, showing the static poster.', err?.message || '');
}

// pointer
const parallax = { x: 0, y: 0 }, ptr = { x: 0, y: 0 };
let t = 0, night = 0, drag = null, lastHover = 0;
canvas.addEventListener('pointermove', (e) => {
  ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = (e.clientY / innerHeight) * 2 - 1;
  if (!scene) return;
  scene.pointerMove(e.clientX, e.clientY);
  if (drag) {
    const dx = e.clientX - drag.x;
    const dtm = Math.max(1, e.timeStamp - drag.time) / 1000;
    drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y);
    if (drag.mug) { scene.nudgeMug(dx * 0.012); drag.vel = (dx * 0.012) / dtm; }
    drag.x = e.clientX; drag.y = e.clientY; drag.time = e.timeStamp;
    return;
  }
  if (e.timeStamp - lastHover > 90) {
    lastHover = e.timeStamp;
    let hot = false;
    if (t > 2.2 && t < 4.1) hot = scene.hitMug(e.clientX, e.clientY);
    else if (t < 2.1 && e.pointerType === 'mouse') hot = !!scene.hitTree(e.clientX, e.clientY);
    canvas.style.cursor = hot ? (t > 2.2 ? 'grab' : 'pointer') : night > 0.5 ? 'crosshair' : '';
  }
});
canvas.addEventListener('pointerdown', (e) => {
  if (!scene) return;
  const mug = t > 2.2 && t < 4.1 && scene.hitMug(e.clientX, e.clientY);
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, time: e.timeStamp, moved: 0, mug, vel: 0 };
  if (mug) { canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; }
});
function endDrag(e, cancelled) {
  if (!drag || !scene) { drag = null; return; }
  const d = drag; drag = null;
  const now = performance.now() / 1000;
  if (d.mug) { scene.spinMug(clamp(d.vel, -14, 14)); canvas.style.cursor = 'grab'; }
  if (cancelled || d.moved > 8) return;
  if (d.mug) { scene.puff(now, 12); return; }
  if (t < 2.1) {
    const hit = scene.hitTree(e.clientX, e.clientY);
    if (hit) scene.shakeTree(hit, now);
  } else if (night > 0.5) scene.burst(e.clientX, e.clientY, now);
}
canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));

// ---------- frame loop ----------
const altEl = $('#alt'), fillEl = $('#trailFill'), nameEl = $('#trailName');
const names = ['Canopy', 'Descent', 'Clearing', 'Brew bar', 'After dark', 'Trailhead'];
let lastName = '', lastAlt = '', running = true, rafId = 0;
let snapT = null, fadeUntil = 0;
const perf = { frames: 0, since: performance.now(), fps: 0, samples: [] };
window.__pine = { perf, get t() { return t; }, scrollForT, scrollToT, info: () => scene?.info() };

function frame(ms) {
  rafId = requestAnimationFrame(frame);
  if (lenis) lenis.raf(ms);
  const now = ms / 1000;
  t = tFromScroll(window.scrollY);
  night = smooth(3.92, 4.45, t);

  // panels: opacity is a pure function of t
  let best = null;
  for (const p of panels) {
    const r = smooth(p.a, p.a + 0.09, t) * (1 - smooth(p.b - 0.09, p.b, t));
    if (Math.abs(r - p.r) > 0.002) {
      p.r = r;
      p.el.style.setProperty('--r', r.toFixed(3));
      p.el.style.pointerEvents = r > 0.6 ? 'auto' : 'none';
      p.el.classList.toggle('off', r < 0.01);
    }
    if (!best || r > best.r) best = p;
  }

  // reduced motion: hold each section's pose, crossfade between them
  let poseT = t;
  if (reduced) {
    const target = best && best.r > 0.05 ? best.pose : Math.round(t * 2) / 2;
    if (snapT === null) snapT = target;
    if (target !== snapT && now > fadeUntil) {
      canvas.style.opacity = '0'; fadeUntil = now + 0.4;
      setTimeout(() => { snapT = target; canvas.style.opacity = '1'; }, 200);
    }
    poseT = snapT;
  } else { snapT = null; canvas.style.opacity = '1'; }

  parallax.x += (ptr.x - parallax.x) * 0.06;
  parallax.y += (ptr.y - parallax.y) * 0.06;

  let alt = 34 - t * 7;
  if (scene) {
    const out = scene.update({ t: poseT, now, night: reduced ? smooth(3.92, 4.45, poseT) : night, parallax, reduced, dragging: !!drag?.mug });
    alt = out.alt;
  }
  const a = alt.toFixed(1);
  if (a !== lastAlt) { altEl.textContent = a; lastAlt = a; }
  fillEl.style.height = `${(t / 5) * 100}%`;
  const nm = names[Math.min(5, Math.floor(t + 0.001))];
  if (nm !== lastName) { nameEl.textContent = nm; lastName = nm; }
  audio.setNight(night);

  perf.frames++;
  if (ms - perf.since > 500) {
    perf.fps = (perf.frames * 1000) / (ms - perf.since);
    perf.samples.push(perf.fps); if (perf.samples.length > 240) perf.samples.shift();
    perf.frames = 0; perf.since = ms;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { running = false; cancelAnimationFrame(rafId); audio.suspend(); }
  else if (!running) { running = true; perf.since = performance.now(); perf.frames = 0; rafId = requestAnimationFrame(frame); audio.resume(); }
});
addEventListener('resize', () => { measure(); scene?.resize(); });
document.fonts?.ready.then(measure);

applyMotion();
measure();
renderTray();
selectDrink(current, true);
rafId = requestAnimationFrame(frame);
