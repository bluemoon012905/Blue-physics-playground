# Blue Physics Playground

Static GitHub Pages playground for browser-based simulations.

## Running

No build step. Open `index.html` directly in a browser, or serve the folder
with any static file server (e.g. `npx serve .`).

## Structure

- `index.html`: landing page for the simulation library
- `simulations/<name>/`: one folder per simulation
- `simulations/epicycles/index.html`: epicycles simulation page
- `simulations/epicycles/app.js`: epicycle animation logic
- `simulations/trebuchet/index.html`: trebuchet force builder page
- `simulations/trebuchet/app.js`: trebuchet physics logic
- `assets/css/site.css`: shared site styling
- `assets/js/site.js`: shared site bootstrap

## Simulations

### Epicycles

A chain of 1–8 nested rotating circles whose endpoint traces a trail.
Controls: segment count, base speed (0.2–2.5×), trail length, Randomize,
Pause, and Clear Trail.

### Trebuchet Force Builder

A snap-grid structural editor. Draw wood beams (break at 85 kN) or steel
beams (break at 170 kN) between grid points, and place pivot joints at
connection points. Pressing **Start Physics** drops unsupported members under
fixed gravity and resolves ground collisions. The force readout shows the
gravity load, peak member force, and broken member count in real time.
**Reset Damage** restores broken members without clearing the layout;
**Clear Members** wipes everything.
