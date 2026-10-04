# Portfolio site

A single-page site for showing hardware and software projects. Plain
HTML/CSS/JS with no build step: open `index.html` in a browser.

## Editing

Everything you'd change lives in `projects.js`:

- `PROJECTS`: one object per project (`type` is `"hardware"` or `"software"`).
  The fields are documented at the top of the file.
- `PROFILE`: your name, role, intro, email and links.

Entries marked `placeholder: true` are samples and show a "Sample" badge.
Replace them with your own projects.

Projects without a `cover` image get a generated cover: a PCB layout for
hardware, a code window for software. To use a photo instead, drop it in an
`img/` folder and set `cover: "img/your-photo.jpg"`. Add more photos with
`gallery: [{ src, caption }]`.

## Features

- Interactive PCB-trace background in the hero: traces light up around the
  cursor and clicking sends a pulse across the board
- Hardware / Software / All filter (also via `?type=hardware` in the URL)
- Grid view with 3D tilt, or an index list with a cursor-following preview
- Project pages with a "datasheet" spec table, deep-linkable as `#/p/<slug>`;
  arrow keys move between projects and Esc closes the page
- Light and dark themes, a mobile layout, and reduced-motion support

## Hosting

Any static host works: GitHub Pages, Netlify, Vercel or Cloudflare Pages.
For GitHub Pages, put these files in a `<username>.github.io` repository
(or any repo with Pages enabled) and they'll be served as-is.
