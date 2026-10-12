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

  {
    slug: "cnc-tool-wear",
    title: "CNC tool-wear monitor",
    tagline: "An ESP32 vibration sensor that predicts when a CNC cutting tool is wearing out.",
    type: "hardware",
    year: 2026,
    status: "In progress · Phase 2",
    role: "Hardware + firmware",
    tags: ["ESP32", "FreeRTOS", "Accelerometer", "Embedded C++"],
    summary:
      "A small sensor package that clamps to a mill, listens to its vibration and flags a dull tool before it ruins a part. It samples an accelerometer at 800 Hz, extracts wear features in real time, shows tool health on an OLED and logs every session to an SD card.",
    specs: [
      ["MCU", "ESP32 DevKit (dual-core, FreeRTOS)"],
      ["Sensor", "ADXL345 3-axis accelerometer, I²C"],
      ["Sampling", "800 Hz, 512-sample windows"],
      ["Features", "RMS (X/Y/Z), peak, crest factor, variance"],
      ["Output", "SSD1306 OLED · green / red LEDs · SD card CSV log"],
      ["Next", "On-device TFLite Micro classifier (Phase 4)"],
    ],
    sections: [
      {
        heading: "Why",
        body: "Worn tools cut badly, chatter and break. Most small shops replace them on a schedule or by ear. I wanted something cheap that could tell from vibration alone when a tool is going.",
      },
      {
        heading: "How it works",
        body: "One FreeRTOS task samples the accelerometer and computes six statistical features per window; another drives the display. Crest factor turned out to be the most telling one: a worn edge makes sharp impulses that spike it even when overall vibration (RMS) stays low. Right now a threshold model sorts the tool into healthy / caution / worn.",
      },
      {
        heading: "What's next",
        body: "The SD logs are the training data. Phase 4 swaps the thresholds for a small neural network running on the ESP32 itself with TensorFlow Lite Micro.",
      },
    ],
    links: [{ label: "Firmware on GitHub", href: "https://github.com/AryaA94/CNC-MACHINE-CODE" }],
    accent: "#4fb3a9",
  },
  {
    slug: "gcode-sim",
    title: "gcode-sim",
    tagline: "Check, time, cost and plan CNC milling programs in the browser.",
    type: "software",
    year: 2026,
    status: "Shipped",
    role: "Solo build",
    tags: ["C++20", "WebAssembly", "CNC / G-code", "3D visualization"],
    summary:
      "Reads a G-code program before it goes to the machine and tells you what's wrong, how long it will take, what it will cost and what the finished part will weigh. Built for people who machine parts but don't have time to fight their software: Formula SAE teams, makerspaces and small shops.",
    specs: [
      ["Engine", "C++20, compiled to WebAssembly"],
      ["Checks", "11 lint rules with line numbers"],
      ["Timing", "Per-axis accel limits + look-ahead"],
      ["Extras", "Drilling-program generator, setup sheets, job quotes"],
      ["Tests", "132 test cases · 2,824 checks"],
      ["Runs", "In the browser, offline, nothing to install"],
    ],
    sections: [
      {
        heading: "Why I built it",
        body: "On co-op I worked as a CAD/CAM programmer, writing and checking G-code for CNC mills every day. I wanted to understand what happens between \"export from CAM\" and \"the machine starts cutting\": how a controller catches a mistake, how it decides how long a job takes, how fast it can take a corner.",
      },
      {
        heading: "What it does",
        body: "Flags mistakes like a rapid move into the stock or a spindle speed too fast for the material, plays the toolpath back in 3D, breaks cycle time down by operation, and prints a setup sheet for the machinist. It can also write a full drilling-and-tapping program from a list of hole positions.",
      },
    ],
    links: [
      { label: "Open it", href: "https://aryaa94.github.io/G-Code/" },
      { label: "Source on GitHub", href: "https://github.com/AryaA94/G-Code" },
    ],
    accent: "#d6b04a",
  },
  {
    slug: "purple-plow",
    title: "Purple Plow",
    tagline: "An autonomous snow-clearing and salting robot for Western's campus walkways.",
    type: "software",
    year: 2026,
    status: "Design project",
    role: "ES1050 · Team 14",
    tags: ["Java", "Simulation", "Dashboard UI", "Robotics"],
    summary:
      "Our first-year design team's concept for a robot that plows and salts campus paths on its own. I built the software side: a coverage simulator for the robot's sweep pattern, a battery and thermal model, and the operator dashboard for running it.",
    specs: [
      ["Course", "ES1050, Western Engineering"],
      ["Coverage sim", "Java / Swing grid with pedestrians and obstacles"],
      ["Battery model", "Peukert's law + cold-weather heater logic"],
      ["Dashboard", "HTML/CSS/JS operator console"],
    ],
    sections: [
      {
        heading: "Salting simulator",
        body: "A grid model of a campus sidewalk where the robot sweeps back and forth, salting snow tiles while avoiding pedestrians and obstacles, and tracks battery and salt-hopper levels as it goes.",
      },
      {
        heading: "Battery manager",
        body: "Lead-acid batteries lose capacity in the cold. The model drains the battery with Peukert's law and decides when it's worth spending current on a heater to win capacity back.",
      },
      {
        heading: "Operator dashboard",
        body: "A live console with routes across campus (UC → SEB, Alumni Hall, Middlesex), telemetry, a system log and a manual override when the robot gets boxed in.",
      },
    ],
    links: [
      { label: "Dashboard code", href: "https://github.com/AryaA94/Purple-Plow-Website-Draft-" },
      { label: "Salting simulator", href: "https://github.com/AryaA94/Salting-Simulator" },
      { label: "Battery manager", href: "https://github.com/AryaA94/Battery-Manager" },
    ],
    accent: "#8a5cd0",
  },
];

// About / contact details shown at the top and bottom of the page.
window.PROFILE = {
  name: "Arya Ananda",
  role: "Electrical Engineering · Western University",
  location: "London, Ontario",
  intro:
    "Electrical engineering student at Western. I build hardware that senses things and software that makes sense of it. This is everything I've made so far.",
  about: {
    lead: "Hey, I'm Arya. I study <em>Electrical Engineering</em> at Western, and I can't leave a machine alone until I know how it works.",
    paragraphs: [
      "On co-op I wrote G-code for CNC mills every day. That turned into gcode-sim, then a sensor that listens to a mill to tell when its tool is wearing out. Most of my projects start like that: I use something, get curious about what's going on inside, and end up building my own version.",
      "I like work that sits right between hardware and code: wiring up a microcontroller, then writing the firmware, the simulator and the dashboard around it.",
    ],
    now: [
      "Studying Electrical Engineering at Western",
      "Training an on-device model for the tool-wear monitor",
      "Open to co-op and internship roles",
    ],
  },
  email: "vj7386071@gmail.com",
  links: [
    { label: "Email", href: "mailto:vj7386071@gmail.com" },
    { label: "GitHub", href: "https://github.com/AryaA94" },
    // { label: "LinkedIn", href: "https://www.linkedin.com/in/YOUR-HANDLE" },
  ],
};
