# Portfolio site

Arya Ananda's portfolio. Plain HTML/CSS/JS, no build step.

- `index.html`: the 3D landing page. A block of aluminium is machined by
  real G-code (`intro.nc`), then a circuit board drops into the pocket.
  Every part on the board is a project; click one to open it. It also has
  an X-ray view and a schematic view.
- `work.html`: the same projects as a plain list (also where the 3D page
  sends browsers without WebGL).

Both pages read everything from `projects.js`.

## Editing

All content is in `projects.js`:

- `PROJECTS`: one object per project (`type` is `"hardware"` or
  `"software"`); the fields are documented at the top of the file.
- `PROFILE`: name, intro, About text, email and links.

On the 3D board, featured projects have hand-placed parts (`SPECIAL` in
`js/fixture.js`). Any other project goes in a free slot on the main board,
then onto expansion boards (4 projects each) that sit in their own pockets
below it, daisy-chained by ribbon cable. Empty spots are marked "DNP". Add
enough projects and the plate, its pockets and the machining all grow:
the G-code is generated from the project list.

After adding projects, re-run `tools/gen-intro.mjs` with gcode-sim so the
page can show the checked result again; until then it shows the program
without the check.

## The machining intro

`js/fixture.js` builds the program from the project list.
`tools/gen-intro.mjs` writes it to `intro.nc` and `js/intro-gcode.js`. Given a
[gcode-sim](https://github.com/AryaA94/G-Code) binary, it also lints and
times the program against `tools/machine.json`, and the page shows the
result:

```sh
node tools/gen-intro.mjs path/to/gcode-sim
```

## Running locally

The 3D page uses ES modules, so it needs to be served over HTTP (opening
the file directly won't work):

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Notes

- Three.js r170 is vendored in `js/` (MIT, see `js/THREE-LICENSE`), so the
  Content-Security-Policy can stay `script-src 'self'`.
- Phones get a lighter version (coarser height map, smaller shadow map).
  With `prefers-reduced-motion`, or after the first visit, the intro is
  skipped; "Machine it again" replays it.
