# Cafe Pine

A scroll-driven 3D site for Cafe Pine, a forest coffee shop. You scroll down from the pine canopy to a mug on a stump, and the page ends in the woods at night.

- `PROMPT.md` is the build prompt this was made from (written with the 3D Prompt Forge skill, High tier).
- `index.html` is the built page. It's self-contained: three.js 0.160.0 and Lenis 1.1.13 are bundled inline. Fonts come from Google Fonts, with system fallbacks.
- `src/` holds the source. `site.js` has all the copy, menu, prices and hours. The address, phone, hours and prices are placeholders.

## Build

```sh
npm install
node build.mjs   # writes index.html
```

## Interactions

| Where | Do | Result |
|---|---|---|
| Canopy and descent | Click a pine | The tree sways on a spring and 2–4 pinecones drop and bounce |
| Clearing | Drag the mug / tap it | It spins with momentum / it puffs steam |
| Brew bar | Pick a drink (click or arrow keys) | The liquid layers in the mug pour to that recipe |
| Brew bar | Add to tray | The tray tracks quantities and a total, and *Copy order* puts it on the clipboard. There's no online payment. |
| After dark | Move the pointer / click | Fireflies drift toward it / a burst of fireflies |
| Header, footer | Sound | Synthesized wind, birds by day and crickets at night. Off by default. |
| Footer | Motion | Turns off smoothing, sway and parallax. The setting is remembered. |

Scrolling back up runs every moment in reverse. The page also respects `prefers-reduced-motion`.
