# Blue Physics Playground

Static GitHub Pages playground for browser-based simulations.

## Structure

- `index.html`: landing page for the simulation library
- `simulations/<name>/`: one folder per simulation
- `simulations/epicycles/index.html`: first simulation page
- `simulations/epicycles/app.js`: epicycle animation logic
- `simulations/trebuchet/index.html`: trebuchet simulation page
- `simulations/trebuchet/app.js`: trebuchet physics logic
- `assets/css/site.css`: shared site styling
- `assets/js/site.js`: shared site bootstrap

## Simulations

The first simulation is called `Epicycles`, which is the standard name for a
chain of rotating circles and nested arms whose endpoint traces a path.

The first physics simulation is `Trebuchet`, now set up as a grid-based
force builder where you draw support members from point A to point B and test
wood versus steel under different launch loads.
