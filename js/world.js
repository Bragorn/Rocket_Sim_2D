"use strict";

/* =====================================================================
   WORLD  (js/world.js)
   Turns the data in parts.js into a planck world: the planet and the rocket.
   The rocket is ONE body with one shape per part, so it is rigid: nothing can flex
   or wobble between its parts. When a piece lets go (a decoupler fires, or a part
   breaks off), the parts of that piece are moved onto a body of their own. A part is a record of
   the shape it owns, and where that shape sits on its body (the body's frame is
   the hull's own: ox, oy is where the part's origin is in it, lx, ly its centre).
   The links between parts (sim.joints) are only data now: they say which parts hold
   each other, so the game knows which pieces there are after a split.
   Breaking: onPreSolve / onPostSolve below note how fast and how hard each part hits the ground
   (part.hitV, part.hitJ); sim.js (checkImpacts) turns that into energy and decides what breaks.
   `sim` is everything about the current flight; buildWorld() replaces it (that is what reset does).
   ===================================================================== */

let sim = null;

function addGravity(world) {         // pull every dynamic body toward the planet's center (0, 0)
  for (let b = world.getBodyList(); b; b = b.getNext()) {
    if (!b.isDynamic()) continue;
    const p = b.getPosition(), r = Math.hypot(p.x, p.y), k = -b.getMass() * MU / (r * r * r);
    b.applyForceToCenter(P(p.x * k, p.y * k), true);
  }
}

function vertCentroid(v) {           // centre of a polygon of {x, y} points
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length], c = p.x * q.y - q.x * p.y; a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; }
  a /= 2;
  return [cx / (6 * a), cy / (6 * a)];
}

/* ---- ground contacts: what each part felt this step ---- */
function groundTouch(ct) {           // the shape that is touching the ground in this contact (null if it is not the ground)
  const fA = ct.getFixtureA(), fB = ct.getFixtureB();
  if (fA.getBody() === sim.ground) return fB;
  if (fB.getBody() === sim.ground) return fA;
  return null;
}

/* Before the solver: how fast is this part's contact point closing on the ground? (the ground is a circle, so "down" is toward the planet's centre) */
function onPreSolve(ct) {
  const f = groundTouch(ct);
  if (!f) return;
  const part = sim.parts.find(function (q) { return q.fixture === f; });
  if (!part) return;
  const wm = ct.getWorldManifold(null);
  if (!wm || !wm.pointCount) return;
  let px = 0, py = 0;
  for (let i = 0; i < wm.pointCount; i++) { px += wm.points[i].x; py += wm.points[i].y; }
  px /= wm.pointCount; py /= wm.pointCount;
  const r = Math.hypot(px, py);
  if (r === 0) return;
  const v = part.body.getLinearVelocityFromWorldPoint(P(px, py));
  const closing = -(v.x * px + v.y * py) / r;
  if (closing > part.hitV) part.hitV = closing;
}

/* After the solver: how much push (impulse, N*s) did the ground give this part? */
function onPostSolve(ct, impulse) {
  const f = groundTouch(ct);
  if (!f) return;
  const part = sim.parts.find(function (q) { return q.fixture === f; });
  if (!part) return;
  const ns = impulse.normalImpulses;
  for (let i = 0; i < ns.length; i++) part.hitJ += ns[i];
}

function buildWorld() {
  const world = new planck.World({ gravity: P(0, 0) });
  const ground = world.createBody({ type: "static", position: P(0, 0) });
  ground.createFixture({ shape: new planck.Circle(R), friction: 0.8 });

  const base = R + PAD_GAP;           // the rocket's lowest point sits this far above the ground
  const hx = ROCKET.hull.at[0], hy = ROCKET.hull.at[1];
  const body = world.createBody({ type: "dynamic", position: P(hx, base + hy) });   // the one body: its frame starts at the hull's centre
  const parts = [], byId = {}, joints = [], tanks = [];

  for (const def of ROCKET.parts) {   // one shape per part
    const ox = def.at[0] - hx, oy = def.at[1] - hy;
    const verts = def.verts.map(function (v) { return P(v[0], v[1]); });             // the shape round the part's own origin
    const local = def.verts.map(function (v) { return P(ox + v[0], oy + v[1]); });   // and the same shape in the body's frame
    // filterGroupIndex -1: the parts of one rocket never collide with each other (only with the ground)
    const fixture = body.createFixture({ shape: new planck.Polygon(local), density: def.mass / polyArea(verts), friction: 0.8, restitution: 0, filterGroupIndex: -1 });
    const c = vertCentroid(verts);
    const part = { def: def, name: def.name, color: def.color, body: body, fixture: fixture, verts: verts, local: local, ox: ox, oy: oy, lx: ox + c[0], ly: oy + c[1],
                   idx: parts.length, active: false, debris: false, group: 0, zone: null, joint: null, tank: null,
                   hitV: 0, hitJ: 0, stress: 0,                                       // ground contact this step: closing speed (m/s) and impulse (N*s), see onPreSolve
                   forces: (def.forces || []).map(function (f) { return Object.assign({ now: 0, angle: 0 }, f); }) };   // now = force this step, angle = gimbal
    for (const f of part.forces) prepareAero(part, f);
    if (def.fuel) { const t = { part: part, area: polyArea(verts), dry: def.fuel.dry, full: def.fuel.full, fuel: def.fuel.full }; tanks.push(t); part.tank = t; }
    parts.push(part);
    byId[def.id] = part;
  }

  for (const part of parts) {         // link the parts that hold each other (no joint in the engine: they share a body)
    const jd = part.def.joint;
    if (!jd) continue;
    const entry = { name: part.name, force: 0, peak: 0, part: part, parent: byId[jd.to] };
    joints.push(entry); part.joint = entry;
  }

  let topPart = parts[0], topY = -Infinity;           // the part that stays with the rocket when it splits: the highest one
  for (const q of parts) for (const v of q.verts) if (q.def.at[1] + v.y > topY) { topY = q.def.at[1] + v.y; topPart = q; }
  const hull = byId[ROCKET.hull.id];
  let hx0 = Infinity, hx1 = -Infinity;
  for (const v of hull.verts) { hx0 = Math.min(hx0, v.x); hx1 = Math.max(hx1, v.x); }
  const fuelFull = tanks.reduce(function (s, t) { return s + t.full; }, 0);
  sim = { world: world, ground: ground, parts: parts, joints: joints, hull: hull, hullWidth: hx1 - hx0,
          rootHull: hull, vessel: parts, zones: [], topPart: topPart, labels: ROCKET.labels || {},
          stages: (ROCKET.stages || []).map(function (r) { return r.slice(); }), stageNext: 0,   // the staging list and the row that fires next
          tanks: tanks, fuelFull: fuelFull, fuel: fuelFull,             // all tanks share one pool of fuel, drained evenly
          wheelMax: 0,                                                  // the turning push (N*m) of the reaction wheels on the rocket you fly
          refOffset: ROCKET.hull.at[1] + PAD_GAP,                       // height of the hull's centre on the pad: altitudes are shown minus this
          thrust: 0, airborne: false, t: 0, emptyLogged: false,
          started: false, flown: false, touchdownSpeed: null,           // started = engine lit once (the flight clock runs); flown = has been in the air
          dragN: 0, accG: 1, pvx: 0, pvy: 0, p0: { x: hull.body.getPosition().x, y: hull.body.getPosition().y },
          rho: RHO0, q: 0, maxQ: 0, aoa: 0 };
  updateVessels();
  teleReset();

  world.on("pre-solve", onPreSolve);                 // breaking: what each part felt when it touched the ground
  world.on("post-solve", onPostSolve);
  world.on("begin-contact", function (ct) {          // the first touch after being in the air gets reported
    const fA = ct.getFixtureA(), fB = ct.getFixtureB();
    if (fA.getBody() !== ground && fB.getBody() !== ground) return;
    const touching = fA.getBody() === ground ? fB : fA;               // the shape that touched the ground
    const hit = parts.find(function (q) { return q.fixture === touching; });
    if (hit && hit.debris) return;                   // a dropped stage landing is not the rocket landing
    if (!sim.airborne) return;
    sim.airborne = false;
    const body = touching.getBody(), p = body.getPosition(), r = Math.hypot(p.x, p.y);
    const ux = p.x / r, uy = p.y / r, v = body.getLinearVelocity();
    const vert = v.x * ux + v.y * uy, side = v.x * uy - v.y * ux;
    sim.touchdownSpeed = Math.abs(vert);
    const mass = totalMass(), fuelPct = sim.fuelFull > 0 ? Math.round(100 * sim.fuel / sim.fuelFull) : 0;     // a heavy, full rocket lands much harder than a light one
    log("T+" + sim.t.toFixed(1) + " s: touchdown, " + (hit ? hit.name : "?") + " first, " + Math.abs(vert).toFixed(1) + " m/s down, " + Math.abs(side).toFixed(1) + " m/s sideways, rocket " + mass.toFixed(0) + " kg with " + sim.fuel.toFixed(0) + " kg of fuel (" + fuelPct + "%)");
  });
  log("new rocket on the pad. Press Space to fire stage 1, then W to raise the throttle.");
}

/* Move some parts (a piece that has just let go) onto a new body. The new body sits exactly where the old one is, so every shape
   keeps its place; it starts with the speed and spin the piece already had, at its own centre of mass. */
function moveToNewBody(list, old) {
  const nb = sim.world.createBody({ type: "dynamic", position: old.getPosition(), angle: old.getAngle() });
  const fresh = list.map(function (q) {
    return nb.createFixture({ shape: new planck.Polygon(q.local), density: q.fixture.getDensity(), friction: 0.8, restitution: 0, filterGroupIndex: -1 });
  });
  nb.setLinearVelocity(old.getLinearVelocityFromWorldPoint(nb.getWorldCenter()));
  nb.setAngularVelocity(old.getAngularVelocity());
  list.forEach(function (q, i) { old.destroyFixture(q.fixture); q.fixture = fresh[i]; q.body = nb; });
}

function splitBodies() {             // every connected piece on a body of its own (pieces only ever come apart, they never join)
  const bodies = [];
  for (const p of sim.parts) if (bodies.indexOf(p.body) < 0) bodies.push(p.body);
  for (const body of bodies) {
    const here = sim.parts.filter(function (q) { return q.body === body; }), keep = here[0].group, others = {};
    for (const q of here) if (q.group !== keep) (others[q.group] = others[q.group] || []).push(q);
    for (const g in others) moveToNewBody(others[g], body);
  }
}

/* Works out which parts are the rocket you fly (the piece holding the highest part), which are dropped pieces, which tanks feed which
   engines (fuel does not cross a decoupler), and which body the camera and the steering follow. Runs at the start and after every split. */
function updateVessels() {
  const n = sim.parts.length;
  function sets(barrier) {           // pieces joined by live links. barrier: fuel does not cross a decoupler
    const root = [];
    for (let i = 0; i < n; i++) root.push(i);
    const find = function (x) { while (root[x] !== x) { root[x] = root[root[x]]; x = root[x]; } return x; };
    for (const j of sim.joints) {
      if (barrier && (j.part.def.kind === "decoupler" || j.parent.def.kind === "decoupler")) continue;
      root[find(j.part.idx)] = find(j.parent.idx);
    }
    return find;
  }
  const whole = sets(false), feed = sets(true), mine = whole(sim.topPart.idx);
  for (const p of sim.parts) { p.group = whole(p.idx); p.debris = p.group !== mine; }
  sim.vessel = sim.parts.filter(function (p) { return !p.debris; });
  splitBodies();

  sim.wheelMax = 0;                  // the reaction wheels still on the rocket you fly add up to its turning push
  for (const p of sim.vessel) for (const f of p.forces) if (f.kind === "wheel") sim.wheelMax += f.torque;

  const zones = {};
  for (const t of sim.tanks) {
    const k = feed(t.part.idx), z = zones[k] || (zones[k] = { tanks: [], fuel: 0, flow: 0 });
    z.tanks.push(t); z.fuel += t.fuel;
  }
  sim.zones = Object.keys(zones).map(function (k) { return zones[k]; });
  for (const p of sim.parts) p.zone = zones[feed(p.idx)] || null;

  sim.hull = sim.vessel.indexOf(sim.rootHull) >= 0 ? sim.rootHull : (sim.vessel.find(function (p) { return p.def.fuel; }) || sim.vessel[0]);
  let hx0 = Infinity, hx1 = -Infinity;
  for (const v of sim.hull.verts) { hx0 = Math.min(hx0, v.x); hx1 = Math.max(hx1, v.x); }
  sim.hullWidth = hx1 - hx0;
  sim.fuelFull = 0; sim.fuel = 0;
  for (const t of sim.tanks) if (!t.part.debris) { sim.fuelFull += t.full; sim.fuel += t.fuel; }
  const v = sim.hull.body.getLinearVelocity();       // the acceleration readout starts again from the new body's speed
  sim.pvx = v.x; sim.pvy = v.y;
}

function totalMass() {               // the rocket you fly
  return (sim.vessel || sim.parts).reduce(function (m, q) { return m + partMass(q); }, 0);
}

function maxThrust() {               // thrust of all engines at full throttle, in the air pressure right now, N
  const pf = sim.rho / RHO0;
  let t = 0;
  for (const p of sim.vessel) for (const f of p.forces) if (f.kind === "thrust" && p.active) t += f.vac - (f.vac - f.sl) * pf;   // engines that are on, on the rocket you fly
  return t;
}

function vacIsp() {                  // efficiency of the engines together in vacuum, s (0 = no engines)
  let thrust = 0, flow = 0;
  for (const p of sim.vessel) for (const f of p.forces) if (f.kind === "thrust") { thrust += f.vac; flow += f.mdot; }
  return flow > 0 ? thrust / (flow * G0) : 0;
}

/* How high the lowest point of the rocket you fly is above the ground, m (the feet, not the middle of the hull). */
function groundHeight() {
  let low = Infinity;
  for (const p of sim.vessel) for (const q of p.verts) {
    const w = p.body.getWorldPoint(P(p.ox + q.x, p.oy + q.y)), h = Math.hypot(w.x, w.y) - R;
    if (h < low) low = h;
  }
  return low;
}

/* Seconds until the lowest point reaches the ground if nothing changes (the engines as they are now, air ignored), or null when it is not
   coming down, or would stop before it gets there. */
function groundCountdown() {
  const b = sim.hull.body, p = b.getPosition(), v = b.getLinearVelocity(), r = Math.hypot(p.x, p.y);
  const vd = -(v.x * p.x + v.y * p.y) / r, h = groundHeight();
  if (!(vd > 1) || !(h > 0)) return null;
  const ang = b.getAngle(), up = (-Math.sin(ang) * p.x + Math.cos(ang) * p.y) / r;       // how much of the thrust points up
  const a = MU / (r * r) - sim.thrust / totalMass() * up;                                // net acceleration downward
  if (Math.abs(a) < 1e-6) return h / vd;
  const disc = vd * vd + 2 * a * h;
  return disc < 0 ? null : (-vd + Math.sqrt(disc)) / a;
}
