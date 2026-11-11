"use strict";

/* =====================================================================
   UTIL  (js/util.js)
   The message log (shown in the bottom bar), a few tiny helpers, and the
   check that planck loaded.
   ===================================================================== */

const logLines = [];                 // the newest few messages; render.js shows them in the bottom bar
const logAll = [];                   // every message of this flight, with its flight time and kind (the flight report lists them)
function flightClock() { return typeof sim !== "undefined" && sim ? sim.t : 0; }
function log(s, kind) {
  logLines.push(s); if (logLines.length > 6) logLines.shift();
  logAll.push({ t: flightClock(), kind: kind || "event", text: s }); if (logAll.length > 400) logAll.shift();
  console.log(s);
}

if (typeof planck === "undefined") {
  document.body.textContent = "planck was not found. Check that the file is at js/planck.min.js next to this page. Then reload.";
  throw new Error("planck missing");
}

const P = (x, y) => new planck.Vec2(x, y);
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function polyArea(v) {               // area of a polygon given as points with x and y
  let a = 0;
  for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

function fmtAlt(m) {                 // a distance: meters up to 10 km, then km
  if (!isFinite(m)) return "escape";
  return Math.abs(m) < 10000 ? m.toFixed(0) + " m" : (m / 1000).toFixed(1) + " km";
}
function fmtTime(s) {
  if (s === null) return "-";
  return s < 120 ? s.toFixed(0) + " s" : Math.floor(s / 60) + " min " + Math.round(s % 60) + " s";
}
