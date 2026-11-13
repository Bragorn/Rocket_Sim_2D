"use strict";

/* =====================================================================
   MAIN  (js/main.js)
   The game loop, the view keys (zoom, map, time warp, menu) and the
   start-up. Flight keys (W S A D Z X T) are in controls.js; the pause
   menu (Esc) is in menu.js.
   Physics runs in fixed slices of DT. Time warp just runs more slices per
   frame; if the computer cannot keep up (more than ~12 ms of physics in a
   frame) the sim runs slower than asked instead of freezing, and the bar
   shows the speed it is really getting. While the menu is open nothing steps.
   ===================================================================== */

const WARPS = [1, 2, 5, 10, 25];     // < and > (and the - and + buttons) step through these
let warpI = 0, warp = 1, warpActual = 1;
const STEP_BUDGET_MS = 12;           // most time spent on physics in one frame

function setWarp(i) {
  warpI = clamp(i, 0, WARPS.length - 1);
  warp = WARPS[warpI];
}

function resetAll() {                // the rocket back on the pad, a fresh recorder and log
  logAll.length = 0; logLines.length = 0;
  buildWorld();
  controlsReset();
  setWarp(0);
  warpActual = 1;
  menuReset();
}

window.addEventListener("keydown", function (e) {
  if (e.code === "Escape") { if (!e.repeat) { if (menuIsOpen()) menuBack(); else openMenu(); } return; }
  if (e.code === "Equal" || e.code === "NumpadAdd") zoomBy(1.05);          // held keys repeat, so keep each press small
  if (e.code === "Minus" || e.code === "NumpadSubtract") zoomBy(1 / 1.05);
  if (e.repeat || paused) return;
  if (e.code === "Space") fireStage();
  else if (e.code === "KeyM") toggleMap();
  else if (e.code === "Period") setWarp(warpI + 1);
  else if (e.code === "Comma") setWarp(warpI - 1);
});
window.addEventListener("wheel", function (e) {              // scaled by how far the wheel moved, so trackpads are smooth
  if (menuIsOpen()) return;
  e.preventDefault();
  zoomBy(Math.exp(-clamp(e.deltaY, -100, 100) * 0.0015));
}, { passive: false });
window.addEventListener("resize", resize);
cv.addEventListener("mousedown", function (e) {                // the buttons in the bottom bar
  if (e.button !== 0 || paused) return;
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  for (const b of barButtons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return; }
});

let last = performance.now(), acc = 0;
function frame(now) {
  const dtFrame = Math.min(0.1, (now - last) / 1000);
  last = now;
  perf.frame += (dtFrame * 1000 - perf.frame) * 0.05;
  const t0 = performance.now();
  let n = 0;
  if (!paused) {
    acc += dtFrame * warp;
    while (acc >= DT && n < 10 * warp && performance.now() - t0 < STEP_BUDGET_MS) { stepSim(); acc -= DT; n++; }
    if (acc >= DT) acc = 0;                                  // drop the backlog instead of spiralling
    if (dtFrame > 0) warpActual += (n * DT / dtFrame - warpActual) * 0.1;
  } else acc = 0;
  const t1 = performance.now();
  updateView(dtFrame);
  draw();
  const t2 = performance.now();
  perf.sim += ((t1 - t0) - perf.sim) * 0.05; perf.draw += ((t2 - t1) - perf.draw) * 0.05; perf.steps = n;
  requestAnimationFrame(frame);
}

const launched = designFromHash(location.hash);                 // the builder opens this page with the design in the address
for (const msg of launched.problems) log("DESIGN: " + msg, "warning");
let currentDesign = launched.design || DESIGN;                      // what is on the pad now (the menu sends it back to the builder)
if (launched.design) ROCKET = assemble(launched.design);
for (const msg of checkRules(ROCKET.parts)) log("RULE BROKEN: " + msg, "warning");   // the rocket must follow rules.js
resize();
resetAll();
requestAnimationFrame(frame);
