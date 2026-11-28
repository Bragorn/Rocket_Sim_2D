"use strict";

/* =====================================================================
   RAILS  (js/rails.js)
   A vessel left in a permanent orbit is not simulated. Its position at any later time is worked out from the orbit it was on
   (Kepler's equation), so it is exact however long it has been, and costs almost nothing.
   The universe clock (universe.js) says what time it is; a vessel saved in orbit also remembers the time it was saved at
   (its epoch). To find it later: take the saved position and velocity, work out the orbit, and move along it for the time that has passed.
   Only closed orbits (ellipses) can be put on rails. Everything is measured from the planet's centre, in metres and seconds.
   ===================================================================== */

/* The orbit a position and velocity are on, in the form needed to move along it, or null if it is not a closed orbit.
   { a, e, w, dir, M0, n, period }
     a        half the long axis
     e        how stretched it is (0 = circle)
     w        the direction of the lowest point, as an angle
     dir      1 if it goes round anticlockwise, -1 clockwise
     M0       "mean anomaly" now: how far round the lap it is, as an angle that grows evenly with time
     n        how fast M grows, rad/s */
function railsElements(p, v) {
  const o = orbitInfo(p, v);
  if (!o.bound || !(o.e < 1)) return null;
  const r = o.r, v2 = v.x * v.x + v.y * v.y, a = 1 / (2 / r - v2 / MU);
  const w = Math.atan2(o.ey, o.ex);
  const nu = o.dir * (Math.atan2(p.y, p.x) - w);                       // true anomaly: the angle from the lowest point, in the direction of travel
  const E = 2 * Math.atan2(Math.sqrt(1 - o.e) * Math.sin(nu / 2), Math.sqrt(1 + o.e) * Math.cos(nu / 2));
  const M0 = E - o.e * Math.sin(E);
  return { a: a, e: o.e, w: w, dir: o.dir, M0: M0, n: Math.sqrt(MU / (a * a * a)), period: o.period };
}

function railsSolveKepler(M, e) {   // E - e sin E = M, for an ellipse
  M = Math.atan2(Math.sin(M), Math.cos(M));                            // any number of laps back into -pi..pi
  let E = e < 0.8 ? M : Math.PI * (M < 0 ? -1 : 1);
  for (let i = 0; i < 60; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/* position and velocity on the orbit when the eccentric anomaly is E (the angle that sweeps round the ellipse) */
function railsPointAt(el, E, withVelocity) {
  const e = el.e, a = el.a, b = a * Math.sqrt(1 - e * e), cw = Math.cos(el.w), sw = Math.sin(el.w), dir = el.dir;
  const xo = a * (Math.cos(E) - e), yo = dir * b * Math.sin(E);       // in the orbit's own frame: the lowest point on the x axis, a clockwise orbit mirrored
  const out = { pos: { x: xo * cw - yo * sw, y: xo * sw + yo * cw } };
  if (withVelocity) {
    const k = el.n / (1 - e * Math.cos(E)), vx = -a * k * Math.sin(E), vy = dir * b * k * Math.cos(E);
    out.vel = { x: vx * cw - vy * sw, y: vx * sw + vy * cw };
  }
  return out;
}

/* Where a vessel on this orbit is `dt` seconds after the moment the orbit was worked out. { pos, vel }. */
function railsAt(el, dt) {
  const E = railsSolveKepler(el.M0 + el.n * dt, el.e);
  return railsPointAt(el, E, true);
}

/* A saved vessel state moved on by dt seconds along its orbit: same state, new position and velocity. If it is not on a closed orbit it is returned as it is. */
function railsStateAt(state, dt) {
  if (!(dt > 0)) return state;
  const el = railsElements(state.pos, state.vel);
  if (!el) return state;
  const at = railsAt(el, dt), s = JSON.parse(JSON.stringify(state));
  s.pos = at.pos; s.vel = at.vel;
  return s;
}

/* The whole orbit as a list of points for drawing: [{x, y}, ...], n + 1 of them, the last equal to the first. null if not a closed orbit. */
function railsOrbitPoints(state, n) {
  const el = railsElements(state.pos, state.vel);
  if (!el) return null;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(railsPointAt(el, -Math.PI + 2 * Math.PI * i / n, false).pos);   // evenly round the ellipse, so it is smooth
  return pts;
}

/* Where a vessel of the universe is at universe time `clock`, as { pos, vel } (vel is null for one that is not moving by itself):
   in orbit, moved along its orbit for the time since it was saved; anywhere else, where it was left (an untouched one is on the pad). */
function vesselStateAt(v, clock) {
  const s = v.state;
  if (!s) return { pos: { x: 0, y: R }, vel: null };
  if (v.status === "orbit" && isFinite(v.epoch) && clock > v.epoch) {
    const m = railsStateAt(s, clock - v.epoch);
    return { pos: m.pos, vel: m.vel };
  }
  return { pos: s.pos, vel: v.status === "orbit" ? s.vel : null };
}
