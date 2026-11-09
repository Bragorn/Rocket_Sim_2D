"use strict";

/* =====================================================================
   MAIN  (js/main.js)
   The game loop, the view keys (zoom, map, reset, time warp), and the
   start-up. Flight keys (W S A D Z X T) live in controls.js.
   Physics runs in fixed slices of DT. Time warp just runs more slices
   per frame; if the computer cannot keep up (more than ~12 ms of physics
   in a frame) the sim runs slower than asked instead of freezing, and
   the bar shows the speed it is really getting.
   ===================================================================== */

const WARPS = [1, 2, 5, 10, 25];     // < and > step through these
let warpI = 0, warp = 1, warpActual = 1;
const STEP_BUDGET_MS = 12;           // most time spent on physics in one frame

function setWarp(i) {
  warpI = clamp(i, 0, WARPS.length - 1);
  warp = WARPS[warpI];
}

function resetAll() {
  buildWorld();
  controlsReset();
  setWarp(0);
  warpActual = 1;
}

window.addEventListener("keydown", function (e) {
  if (e.code === "Equal" || e.code === "NumpadAdd") zoomBy(1.05);          // held keys repeat, so keep each press small
  if (e.code === "Minus" || e.code === "NumpadSubtract") zoomBy(1 / 1.05);
  if (e.repeat) return;
  if (e.code === "KeyR") resetAll();
  else if (e.code === "KeyM") toggleMap();
  else if (e.code === "Period") setWarp(warpI + 1);
  else if (e.code === "Comma") setWarp(warpI - 1);
});
window.addEventListener("wheel", function (e) {              // scaled by how far the wheel moved, so trackpads are smooth
  e.preventDefault();
  zoomBy(Math.exp(-clamp(e.deltaY, -100, 100) * 0.0015));
}, { passive: false });
window.addEventListener("resize", resize);

let last = performance.now(), acc = 0;
function frame(now) {
  const dtFrame = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dtFrame * warp;
  const t0 = performance.now();
  let n = 0;
  while (acc >= DT && n < 10 * warp && performance.now() - t0 < STEP_BUDGET_MS) { stepSim(); acc -= DT; n++; }
  if (acc >= DT) acc = 0;                                    // drop the backlog instead of spiralling
  if (dtFrame > 0) warpActual += (n * DT / dtFrame - warpActual) * 0.1;
  updateView(dtFrame);
  draw();
  requestAnimationFrame(frame);
}

const launched = designFromHash(location.hash);                 // the builder opens this page with the design in the address
for (const msg of launched.problems) log("DESIGN: " + msg);
if (launched.design) ROCKET = assemble(launched.design);
for (const msg of checkRules(ROCKET.parts)) log("RULE BROKEN: " + msg);   // the rocket must follow rules.js
resize();
resetAll();
requestAnimationFrame(frame);
