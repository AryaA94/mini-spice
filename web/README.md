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
- `dist/mini-spice-web.html` -- a working reference build, current as of
  the PNP/VCVS/VCCS/AC-for-nonlinear-devices feature set. **Does not yet
  have PULSE/SIN waveform support in the UI** -- see `../HANDOFF.md`.

To rebuild after any change to `../src`, `../include`, or the two files
above: `./build_web.sh` (needs `emcc` on `PATH` -- see the comment at the
top of that script for how to get Emscripten if you don't have it).

There's no build system tying `web/` into the main CMake project on
purpose: it's a separate concern (a browser artifact, not something `ctest`
runs), and Emscripten is a different toolchain from the regular C++20
compiler the rest of the repo builds with.
