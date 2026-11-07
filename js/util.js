"use strict";

/* =====================================================================
   UTIL  (js/util.js)
   The message log (shown in the bottom bar), a few tiny helpers, and the
   check that planck loaded.
   ===================================================================== */

const logLines = [];                 // the newest few messages; render.js shows them in the bottom bar
function log(s) { logLines.push(s); if (logLines.length > 6) logLines.shift(); console.log(s); }

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
