# Cafe Pine — generated build prompt

Decisions: High tier ("extremely interactive and awesome"); scroll website with an interactive-toy brew bar borrowed into section 4; the scroll is a descent from the canopy to the cup with a live trail-marker altitude readout; procedural three.js forest (no model files); dawn-to-night lighting tied to scroll; esbuild bundles three.js + Lenis into one inline script instead of a data-URL import map, so the page also runs inside sandboxed hosts; address, hours and prices are placeholders in `SITE`.

```text
Build a single-page scroll website for Cafe Pine, a small coffee shop and roastery at the edge of a pine forest. It should feel like walking down a trail at dawn and arriving at a warm cup: quiet, resinous, hand-made, then lit up at night.

BRAND
BRAND NAME: Cafe Pine — "Coffee at the edge of the woods."
HERO:       a ceramic mug, 0.11 m tall, 0.045 m radius, lathe-turned, glaze #2F4A3A with a 6 mm unglazed rim band #D9C7A8; sits on a pine stump 0.5 m tall, 0.42 m radius
PALETTE:    background #0F1A14, surface #1B2A21, ink #F1E9D8, muted ink #A9B5A3, accent (ember) #E8873A, accent-2 (lichen) #C7D36F, dawn sky #F3B98A → #3E5A5C, night sky #070B10
TYPE:       headings "Bricolage Grotesque" 800, tracking -0.03em, line-height 0.9; body "Instrument Sans" 400 17 px/1.6; labels "JetBrains Mono" 500 12 px, tracking 0.12em, uppercase
SET:        a forest of 240 instanced pines (6–19 m, 3–5 stacked jittered cones, trunks #3A2A1E), a 160 m ground disc with vertex-noise color, exp2 fog density 0.011 above the canopy → 0.022 on the floor, a clearing of radius 6 m at the origin
PROPS:      pinecones (0.08 m, scaled-cone scales), two lantern posts 1.9 m with ember point lights, a small cabin silhouette 18 m behind the clearing
ACCENTS:    light shafts (additive planes, opacity 0.12), drifting needles/dust (600 points), mug steam (40 sprites), fireflies (180 additive points, night only)
VOICE:      plain, warm, outdoorsy; "We roast twice a week, in small batches, with the door open to the trees."

CONCEPT
The page is a trail. Scrolling lowers the camera from 34 m above the canopy to cup height, while a fixed trail-marker readout counts the altitude down. The arrival point is the HERO on its stump; the end of the trail is the forest at night with fireflies and the cabin lit.

SECTIONS (heights in vh)
1. Canopy — 100. Display headline "Cafe Pine" at clamp(4.5rem, 15vw, 15rem), tagline, CTAs "See the menu" and "Find us". 3D: camera at (0, 34, 22) looking at (0, 18, 0), FOV 45°, dawn sky; pointer parallax ±1.2 m, eased 0.06.
2. The descent — 220. Three short copy blocks (roasting, beans, water) alternating left/right. 3D: camera drops to (3, 2.2, 9), passing through foliage; light shafts fade in 0.2–0.7.
3. The clearing — 160. House blend "Ridgeline" with tasting notes and origin. 3D: camera orbits the HERO 15° → 70° at radius 0.47 → 0.41 m, height 0.7 m, FOV 40°, so the HERO fills ~45% of viewport height beside the copy; steam rises.
4. Brew bar — 180. Menu of 6 drinks as real buttons. 3D: camera at a 3/4 top-down view 0.36 m from the HERO, height 0.8 m, looking into the liquid.
5. After dark — 160. Hours, address, "Bring your own cup, save $0.50". 3D: sky and lights crossfade to night over sectionProgress 0–0.6; cabin windows and lanterns turn on; fireflies appear.
6. Footer — 70 (the last section's progress is remapped so the final scroll position lands exactly on the night vista). Directions link, copy-order button, credits, sound and motion toggles.

INTERACTIONS
SHAKE A TREE (click/tap a pine in sections 1–2): raycast the instance; it sways ±6° for 1.2 s (damped spring, stiffness 90, damping 7); 2–4 pinecones drop with gravity 9.8 m/s², bounce once (restitution 0.3), fade after 6 s. Max 30 cones.
SPIN THE MUG (drag in section 3): horizontal drag rotates the HERO; release keeps angular velocity with 0.92 decay per 1/60 s. Tap puffs 12 extra steam sprites.
BREW (section 4): selecting a drink animates the HERO's liquid layers (espresso #3B2416, milk #E9DCC6, foam #F5EEE2, matcha #8AA14B, chai #B9773F) to that recipe over 0.7 s, cubic-bezier(0.22,1,0.36,1); price and notes update. "Add to tray" adds to a visible tray with quantity steppers and a total. "Copy order" copies a plain-text order to the clipboard and says so. No fake checkout.
FIREFLY TRAIL (pointer in section 5): fireflies within 3 m of the pointer's ground projection drift toward it at 0.8 m/s; click releases a burst of 24.
SOUND (toggle, off by default): synthesized forest bed with Web Audio — filtered pink noise wind at -28 dB, randomized two-note bird chirps every 3–9 s by day, crickets by night. Never autoplays.
Idle: trees sway ±0.8° at 0.18 Hz with per-instance phase; dust drifts at 0.15 m/s; steam loops.

SCROLL SYSTEM
- Lenis 1.1.13 produces one smoothed scroll value; `progress` 0→1 and `sectionProgress[i]` 0→1 are derived from it each frame. DOM reveals and the WebGL scene both read it. No ScrollTrigger, no IntersectionObserver tweens.
- Canvas fixed full-viewport behind the DOM. Sections are scroll spacers; each copy panel is fixed and its opacity is a pure function of scroll inside its own window, so the panel and its 3D pose always arrive together. Focusing a hidden panel scrolls to it.
- Scrolling backward reverses every moment. Wheel, trackpad, touch and keyboard all feed the same value.
- Trail readout (fixed, right edge): altitude in m from camera height, section name, and a vertical progress line in accent-2.

LOOK
Renderer WebGL2, SRGBColorSpace, ACES Filmic, exposure 1.0 dawn → 0.85 night. Hemisphere light sky/ground from PALETTE, dawn sun #FFC58A at intensity 2.2 from 35° elevation, 2048 shadow map on the clearing only; MeshStandardMaterial with roughness 0.85 on wood and foliage, 0.35 on glaze. UnrealBloomPass strength 0.6, threshold 0.85 so only lanterns, fireflies and windows bloom. DOM text panels sit on surface at 72% opacity with 14 px backdrop blur.

CONFIG
All copy, menu items, prices, hours, address and links live in `const SITE = {...}` at the top of the app; the DOM renders from it.

RESPONSIVE AND ACCESSIBILITY
- Breakpoints ≥1200, 768–1199, <768. Below 768: single column, copy panels full width at the bottom 45% of the viewport, camera pulled back 20%, tree count 140, bloom off.
- Semantic header/main/section/footer; all copy is DOM text; contrast ≥ 4.5:1 on every panel.
- Every control focusable with a 2 px accent focus ring; brew bar works with arrow keys.
- prefers-reduced-motion (and the footer Motion toggle, persisted): no parallax, no sway, no smoothing, camera jumps to each section's pose with a 0.4 s crossfade.
- If WebGL fails, a static gradient from PALETTE sits behind the text and everything else still works.

PERFORMANCE
- One self-contained index.html, three.js 0.160.0, Lenis 1.1.13. No CDN: `npm install three@0.160.0 lenis@1.1.13 esbuild@0.24.0`; build.mjs bundles src/main.js with esbuild (format iife, minify) and writes it into an inline <script> in index.html, escaping `</script`. Deliver index.html, build.mjs and src/. Fonts via Google Fonts with display=swap and system fallbacks.
- DPR cap 2 (1.5 below 768 px). Pause the loop when the tab is hidden. Instanced meshes for trees and cones.
- 60 fps while scrolling; if under, cut in order: bloom, shadow map to 1024, tree count, dust count.

AVOID
- Two scroll systems fighting. One Lenis value drives DOM and WebGL.
- One-shot reveals. Every moment is a function of progress and reverses.
- A spinning-object hero. The HERO is discovered at the end of a descent and changes per section (steam, orbit, liquid, night glow).
- Low-poly-template trees in one green. Jitter cone radius ±15%, hue ±4%, lean ±3°, and fade them into fog.
- Fog or bloom washing out text. Copy lives on surface panels; bloom threshold stays at 0.85.
- Dead or pretend controls. The tray, copy order, sound and motion toggles all work; no fake payment.
- Scroll-jacking or snapping. Native scroll with smoothing only.
- Math.random in visible placement. Use a seeded mulberry32 (seed 1127) so the forest is the same every load.

POLISH CHECKLIST
- Altitude readout reaches 0.0 m exactly when the HERO fills 35–45% of viewport height.
- Trunks fade to fog color by 45 m; no hard far-plane edge.
- Mug rim band catches the sun as a visible highlight at 30–50° of the orbit.
- Liquid surface sits 8 mm below the rim and never clips through the glaze.
- Night windows glow ember with bloom; sky reaches night sky by section 5 at 0.6.
- Pinecones rest on the ground with contact, never floating.

DEFINITION OF DONE
1. At 1440×900 and 390×844: screenshot each section at sectionProgress 0.5.
2. Scroll to the end and back; screenshot section 2 at 0.5 both ways; they match.
3. Shake a tree, spin the mug, brew three drinks, add two to the tray, change a quantity, copy the order, trigger fireflies, toggle sound and motion; confirm each visible result.
4. Console: zero errors or warnings. Network blocked: zero requests other than fonts; the page still renders with fallback fonts.
5. fps averaged over a full scroll ≥ 55, and ≥ 30 under 4× CPU throttle.
6. Every polish item passes. Fix, repeat, then deliver with screenshots and a one-line result per check.
```

## Follow-up revisions

```text
If the forest reads as flat green cones: add a second foliage tint #24402F on lower tiers, raise cone jitter to ±22%, and add a 0.35 rim light #F3B98A from behind the camera's look direction.
```

```text
If text panels are hard to read over bright dawn fog: raise panel opacity to 0.86 and darken fog color by 18% while a panel is in view.
```

```text
If scrolling stutters on laptops: drop trees to 160, shadow map to 1024, and render bloom at half resolution.
```

Best run in: the most capable model (Opus-class) in an agent with a browser and screenshots — the build has many coupled 3D moments that need visual checks.
