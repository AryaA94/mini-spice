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
  placeholder: true marks a sample entry with a "Sample" badge. Delete the
               sample entries (or remove the flag) once you add your own.
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

  // ---- Sample entries below: replace with your own projects ----

  {
    slug: "bench-psu",
    title: "Dual-rail bench supply",
    tagline: "Linear ±15 V lab supply with current limiting and a digital readout.",
    type: "hardware",
    year: 2025,
    status: "Shipped",
    role: "Design, layout, assembly",
    tags: ["KiCad", "Analog", "Power", "STM32"],
    summary:
      "A two-channel linear bench supply with adjustable current limit, low ripple and an STM32-driven display that reads back voltage and current on each rail.",
    specs: [
      ["Output", "0 – ±15 V, 1 A per rail"],
      ["Ripple", "< 2 mVpp at full load"],
      ["Board", "4-layer, 120 × 90 mm"],
      ["MCU", "STM32G0"],
      ["Tools", "KiCad · LTspice"],
    ],
    sections: [
      { heading: "Goal", body: "Describe the problem the project solves and why you built it." },
      { heading: "Design", body: "Walk through the key design decisions: topology, part choices, layout constraints." },
      { heading: "Results", body: "Measurements, scope captures, what you would change in rev B." },
    ],
    links: [{ label: "Schematic (PDF)", href: "#" }],
    accent: "#4fb3a9",
    placeholder: true,
  },
  {
    slug: "sensor-node",
    title: "LoRa sensor node",
    tagline: "Coin-cell environmental sensor that runs for a year on one battery.",
    type: "hardware",
    year: 2025,
    status: "Prototype",
    role: "Hardware + firmware",
    tags: ["ESP32", "LoRa", "Low power", "Firmware"],
    summary:
      "A small wireless sensor board that wakes, samples temperature and humidity, transmits over LoRa and goes back to sleep, averaging a few microamps.",
    specs: [
      ["Sleep current", "≈ 4 µA"],
      ["Radio", "SX1262, 868 MHz"],
      ["Sensors", "SHT40, BMP390"],
      ["Board", "2-layer, 35 × 35 mm"],
    ],
    sections: [
      { heading: "Goal", body: "Describe the problem the project solves and why you built it." },
      { heading: "Design", body: "Power budget, antenna matching, enclosure." },
      { heading: "Results", body: "Range tests, battery-life measurements, lessons learned." },
    ],
    links: [],
    accent: "#8fb85a",
    placeholder: true,
  },
  {
    slug: "macro-pad",
    title: "Hot-swap macro pad",
    tagline: "12-key USB-C macro pad with a rotary encoder and per-key RGB.",
    type: "hardware",
    year: 2024,
    status: "Shipped",
    role: "PCB + case design",
    tags: ["RP2040", "QMK", "USB-C", "3D printing"],
    summary:
      "A compact programmable keypad: RP2040 on a custom PCB, hot-swap sockets, a rotary encoder for volume and a 3D-printed case.",
    specs: [
      ["MCU", "RP2040"],
      ["Keys", "12 hot-swap + encoder"],
      ["Firmware", "QMK"],
      ["Case", "PETG, printed"],
    ],
    sections: [
      { heading: "Goal", body: "Describe the problem the project solves and why you built it." },
      { heading: "Build", body: "Layout, firmware, assembly." },
    ],
    links: [],
    accent: "#c76b9a",
    placeholder: true,
  },
  {
    slug: "scope-viewer",
    title: "Scope capture viewer",
    tagline: "Desktop app that pulls waveforms off a USB oscilloscope and annotates them.",
    type: "software",
    year: 2025,
    status: "In progress",
    role: "Solo build",
    tags: ["Python", "PyQt", "SCPI", "NumPy"],
    summary:
      "Talks SCPI to a bench oscilloscope over USB, grabs waveforms, measures rise time, frequency and overshoot, and exports annotated plots for lab reports.",
    specs: [
      ["Language", "Python 3.12"],
      ["UI", "PyQt6"],
      ["Protocol", "SCPI over USBTMC"],
    ],
    sections: [
      { heading: "Goal", body: "Describe the problem the project solves and why you built it." },
      { heading: "How it works", body: "Architecture, interesting problems, what you learned." },
    ],
    links: [],
    accent: "#6f8ef0",
    placeholder: true,
  },
  {
    slug: "pcb-bom-tool",
    title: "BOM cost checker",
    tagline: "CLI that turns a KiCad BOM into a priced, stock-checked order list.",
    type: "software",
    year: 2024,
    status: "Shipped",
    role: "Solo build",
    tags: ["TypeScript", "Node", "REST APIs"],
    summary:
      "Reads a KiCad BOM export, looks up each part with distributor APIs, flags out-of-stock or end-of-life parts and prints the cheapest order for a given build quantity.",
    specs: [
      ["Language", "TypeScript"],
      ["Runtime", "Node 20"],
      ["Input", "KiCad CSV BOM"],
    ],
    sections: [
      { heading: "Goal", body: "Describe the problem the project solves and why you built it." },
      { heading: "How it works", body: "Architecture, interesting problems, what you learned." },
    ],
    links: [],
    accent: "#d6b04a",
    placeholder: true,
  },
];

// About / contact details shown at the top and bottom of the page.
window.PROFILE = {
  name: "Your Name",
  role: "Electrical engineer & software builder",
  location: "City, Country",
  intro:
    "I design circuit boards, write the firmware that runs on them, and build the software tools around them. This is a running log of what I've made.",
  email: "you@example.com",
  links: [
    { label: "GitHub", href: "https://github.com/AryaA94" },
    { label: "LinkedIn", href: "#" },
    { label: "Résumé", href: "#" },
  ],
};
