"use strict";

/* =====================================================================
   AERO  (js/aero.js)
   The air: density that thins with height, drag on every part that has a
   "drag" force, the sideways push of every "fin" force, and the numbers
   the HUD shows about them (dynamic pressure, angle of attack, stability).
   The air is still (no wind) and does not rotate with the planet.
   Every force is worked out from the part's own speed through the air and
   applied at the part's centre. The welded parts then turn the whole rocket
   by themselves: there is no special stability code anywhere.
   Each part's own axes: x across it, y along it (nose end is +y).
   ===================================================================== */

function airDensity(h) { return RHO0 * Math.exp(-Math.max(0, h) / SCALE_HEIGHT); }

/* Work out the areas once, when the rocket is built.
   drag: sideA = cdSide x (length x depth), axialA = cdAxial x (width x depth), both in m2.
   fin:  liftA = cn x (shape area x depth). */
function prepareAero(part, f) {
  if (f.kind !== "drag" && f.kind !== "fin") return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of part.verts) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
  if (f.kind === "drag") { f.sideA = (f.cdSide || 0) * (y1 - y0) * f.depth; f.axialA = (f.cdAxial || 0) * (x1 - x0) * f.depth; }
  else f.liftA = f.cn * polyArea(part.verts) * f.depth;
}

function applyAeroForce(part, f) {
  const b = part.body, a = b.getAngle(), cs = Math.cos(a), sn = Math.sin(a);
  const wp = b.getWorldCenter();
  const rho = airDensity(Math.hypot(wp.x, wp.y) - R);
  const v = b.getLinearVelocityFromWorldPoint(wp);          // includes the push of the part's own spin
  const V = Math.hypot(v.x, v.y);
  if (V < 1e-6 || rho < 1e-12) return;
  const vx = v.x * cs + v.y * sn;                           // air speed across the part (its x axis is (cs, sn))
  const vy = -v.x * sn + v.y * cs;                          // and along it (its y axis is (-sn, cs))
  let fx, fy = 0;
  if (f.kind === "drag") {
    const k = 0.5 * rho * V;
    fx = -k * f.sideA * vx;
    fy = -k * f.axialA * vy;
  } else {                                                  // fin: push against the sideways air, up to the stall angle
    fx = -0.5 * rho * V * V * f.liftA * clamp(vx / V, -FIN_STALL, FIN_STALL);
  }
  b.applyForce(P(fx * cs - fy * sn, fx * sn + fy * cs), wp, true);
  if (f.kind === "drag") sim.dragN += Math.hypot(fx, fy);        // for the flight recorder
}

function applyAero() {
  sim.dragN = 0;
  for (const p of sim.parts) for (const f of p.forces) {
    if (f.kind === "drag" || f.kind === "fin") applyAeroForce(p, f);
  }
}

/* Numbers for the HUD, worked out after each step from the tank (the hull). */
function updateFlightStats() {
  const b = sim.hull.body, p = b.getPosition(), v = b.getLinearVelocity();
  sim.rho = airDensity(Math.hypot(p.x, p.y) - R);
  const V = Math.hypot(v.x, v.y);
  sim.q = 0.5 * sim.rho * V * V;                            // dynamic pressure, Pa
  const r = Math.hypot(p.x, p.y), g = MU / (r * r);          // acceleration you would feel: the change in speed, with gravity taken out
  const px = (v.x - sim.pvx) / DT + g * p.x / r, py = (v.y - sim.pvy) / DT + g * p.y / r;
  sim.accG += (Math.hypot(px, py) / G0 - sim.accG) * 0.2;    // smoothed, in g
  sim.pvx = v.x; sim.pvy = v.y;
  if (sim.q > sim.maxQ) sim.maxQ = sim.q;
  if (V > 1) {                                              // angle between the rocket's axis and the air's direction, 0 to 90
    const a = b.getAngle();
    const along = (-Math.sin(a) * v.x + Math.cos(a) * v.y) / V;
    sim.aoa = Math.acos(Math.min(1, Math.abs(along))) * 180 / Math.PI;
  } else sim.aoa = 0;
}

/* Stability in calibers: how far the centre of gravity sits ahead of the centre of pressure, in body
   widths. Below 0 the rocket wants to flip, about 1 or more is comfortable. The centre of pressure is
   where the sideways air force acts for a small angle: every drag and fin force counts, weighted by its
   sideways area. null = nothing to push against the air. */
function stabilityCal() {
  const h = sim.hull.body, a = h.getAngle(), ax = -Math.sin(a), ay = Math.cos(a), o = h.getWorldCenter();
  let m = 0, ms = 0, w = 0, ws = 0;
  for (const p of sim.parts) {
    const c = p.body.getWorldCenter(), s = (c.x - o.x) * ax + (c.y - o.y) * ay, pm = p.body.getMass();
    m += pm; ms += pm * s;
    for (const f of p.forces) {
      const wt = f.kind === "fin" ? f.liftA : f.kind === "drag" ? f.sideA : 0;
      w += wt; ws += wt * s;
    }
  }
  return w > 0 ? (ms / m - ws / w) / sim.hullWidth : null;
}
