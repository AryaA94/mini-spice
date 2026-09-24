# web/ — the interactive browser simulator

This directory is the source for the published web tool (a single HTML
page with the real C++ engine compiled to WebAssembly inside it, plus a
hand-written UI on top).

- `head_and_ui_start.html` -- everything before the big inline `<script>`
  tag: CSS, page structure, the component-builder form's HTML.
- `ui_logic.js` -- everything after the compiled WASM blob: engine
  bootstrap, netlist-text generation from the UI's row data, WASM result
  parsing, chart rendering, all the `addComponentFromForm()`/
  `updateAddFormFields()` UI logic.
- `build_web.sh` -- compiles `../src`+`../include` to WASM (Emscripten)
  and concatenates `head_and_ui_start.html` + the compiled WASM/JS +
  `ui_logic.js` into one self-contained file: `dist/mini-spice-web.html`.
- `dist/mini-spice-web.html` -- a working reference build, current with
  the engine's full feature set, including PULSE/SIN waveforms on `V`/`I`
  sources (see `../docs/DESIGN_DECISIONS.md` #18 for how the form maps
  onto the netlist syntax).
- `tests/ui_test.mjs` -- end-to-end test of the built page (see below).

To rebuild after any change to `../src`, `../include`, or the two files
above: `./build_web.sh` (needs Emscripten's `em++` on `PATH` -- see the
comment at the top of that script for how to get it if you don't have it).

**Publishing:** `../.github/workflows/pages.yml` deploys
`dist/mini-spice-web.html` to <https://aryaa94.github.io/mini-spice/> on
every push to `main`, after running the end-to-end test below against it
(a failing test blocks the deploy). It deploys the committed file as is,
so rebuild with `./build_web.sh` and commit `dist/` whenever the engine or
UI changes. One-time repo setup: Settings -> Pages -> Source: "GitHub
Actions".

To test the built page end to end (needs Node.js, and the native CLI
built at `../build/default/minispice` as the reference to compare with):

```sh
cd tests && npm install && node ui_test.mjs
```

It loads `dist/mini-spice-web.html` in jsdom, so it runs the real
compiled engine. It clicks through presets and the add-component form
and checks the results three independent ways: the generated netlist
text, the WASM output against the native CLI, and waveform outputs against
the PULSE/SIN definitions. Set `MINISPICE_WEB_HTML_BASELINE` to an older
build of the page to also check that no pre-existing preset's netlist
changed.

There's no build system tying `web/` into the main CMake project on
purpose: it's a separate concern (a browser artifact, not something `ctest`
runs), and Emscripten is a different toolchain from the regular C++20
compiler the rest of the repo builds with.
