/*
  Your projects. This is the only file you need to edit to add, remove or
  change what the site shows.

  type:        "hardware" or "software"
  status:      shown as a small badge, e.g. "Shipped", "In progress", "Prototype"
  cover:       optional path to an image (e.g. "img/psu.jpg"). Leave it out and
               the site draws a generated schematic / code-style cover instead.
  gallery:     optional list of { src, caption } images for the detail page
  specs:       key/value rows for the "datasheet" table on the detail page
  sections:    the write-up, as { heading, body } blocks (body may use <b>, <a>, <code>)
  links:       { label, href } buttons on the detail page
  placeholder: true marks a slot with a "Coming soon" badge. Replace the
               slots with your real projects (or remove the flag).
*/
window.PROJECTS = [
  {
    slug: "mini-spice",
    title: "mini-spice",
    tagline: "A SPICE-style circuit simulator, written from scratch in C++20.",
    type: "software",
    year: 2026,
    status: "Shipped",
    role: "Solo build",
    tags: ["C++20", "WebAssembly", "Numerical methods", "CMake"],
    summary:
      "Builds a Modified Nodal Analysis system from a netlist and solves it with a hand-written Gaussian elimination routine. Supports DC operating point, transient and AC sweep, and runs in the browser as WebAssembly.",
    specs: [
      ["Language", "C++20"],
      ["Analyses", "DC · Transient (backward Euler) · AC sweep"],
      ["Elements", "R, L, C, independent V / I sources"],
      ["Validation", "Closed-form solutions + ngspice"],
      ["Tests", "112 test cases"],
      ["Targets", "CLI · WebAssembly"],
    ],
    sections: [
      {
        heading: "What it does",
        body:
          "Reads a SPICE-style netlist, stamps every element into an MNA matrix and solves it. No Eigen or other linear-algebra library: the solver is a hand-written Gaussian elimination with partial pivoting.",
      },
      {
        heading: "How it was validated",
        body:
          "Every reference circuit is checked three ways: against an independently derived analytic formula, against ngspice running the identical netlist, and against a set of edge-case and convergence tests.",
      },
      {
        heading: "In the browser",
        body:
          "The same C++ engine is compiled to WebAssembly, so the web version is not a JavaScript rewrite. Build a circuit or load a preset, pick an analysis, and the results are plotted live.",
      },
    ],
    links: [
      { label: "Try it live", href: "https://aryaa94.github.io/mini-spice/" },
      { label: "Source on GitHub", href: "https://github.com/AryaA94/mini-spice" },
    ],
    accent: "#e8894a",
  },

  // ---- Placeholder slots: replace these with your real projects ----

  {
    slug: "hardware-project-1",
    title: "Hardware project",
    tagline: "Coming soon — details for this build are on the way.",
    type: "hardware",
    year: 2026,
    status: "Coming soon",
    tags: ["PCB", "Electronics"],
    summary: "Write-up coming soon.",
    specs: [["Status", "Write-up in progress"]],
    sections: [
      { heading: "Goal", body: "What problem this solves and why you built it." },
      { heading: "Design", body: "Key design decisions: parts, layout, constraints." },
      { heading: "Results", body: "Measurements, photos, what you'd change next time." },
    ],
    links: [],
    accent: "#4fb3a9",
    placeholder: true,
  },
  {
    slug: "software-project-1",
    title: "Software project",
    tagline: "Coming soon — details for this project are on the way.",
    type: "software",
    year: 2026,
    status: "Coming soon",
    tags: ["Code"],
    summary: "Write-up coming soon.",
    specs: [["Status", "Write-up in progress"]],
    sections: [
      { heading: "Goal", body: "What problem this solves and why you built it." },
      { heading: "How it works", body: "Architecture, interesting problems, what you learned." },
    ],
    links: [],
    accent: "#6f8ef0",
    placeholder: true,
  },
];

// About / contact details shown at the top and bottom of the page.
window.PROFILE = {
  name: "Arya Ananda",
  role: "Electrical hardware & software projects",
  location: "", // e.g. "Austin, TX"
  intro:
    "I design circuit boards and build the software tools around them, like a circuit simulator written from scratch in C++. This is a running log of what I've made.",
  email: "", // add the address you want public, e.g. "arya@example.com"
  links: [
    { label: "GitHub", href: "https://github.com/AryaA94" },
    // { label: "LinkedIn", href: "https://www.linkedin.com/in/..." },
    // { label: "Résumé", href: "resume.pdf" },
  ],
};
