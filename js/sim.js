"use strict";

/* =====================================================================
   SIM  (js/sim.js)
   One physics step. Order: gravity, controls, forces from the parts
   (fuel burn included), steering torque, planck's step, then
   bookkeeping. Nothing here knows about pixels.
   ===================================================================== */

/* Every part can carry a list of forces (see parts.js). Here: "thrust". The aero kinds are in aero.js.
   An engine's thrust falls as the air gets thicker: F = vacuum thrust - (vacuum - sea level) x pressure,
   where pressure is 1 at the ground and thins exactly like the air density. Fuel use does not change,
   so the efficiency (Isp) is lower at sea level than in space. */
function applyPartForces(dt) {
  const pf = sim.rho / RHO0;                          // air pressure compared with the ground
  for (const z of sim.zones) z.flow = 0;
  for (const p of sim.parts) for (const f of p.forces) {
    if (f.kind !== "thrust") continue;
    // an engine burns only when its stage has fired, it is on the rocket you fly, and the tanks that feed it still hold fuel
    const z = p.zone, lit = controls.throttle > 0 && p.active && !p.debris && z !== null && z.fuel > 0;
    f.level = lit ? f.minThrottle + (1 - f.minThrottle) * controls.throttle : 0;   // an engine cannot run below minThrottle
    f.now = f.level * (f.vac - (f.vac - f.sl) * pf);
    if (lit) z.flow += f.level * f.mdot;
  }

  for (const z of sim.zones) {                        // burn fuel, and make the tanks lighter
    if (z.flow <= 0) continue;
    const used = z.flow * dt;
    if (used >= z.fuel) {                             // this group of tanks runs dry during this step
      z.fuel = 0;
      for (const t of z.tanks) t.fuel = 0;
      for (const p of sim.parts) if (p.zone === z) for (const f of p.forces) if (f.kind === "thrust") { f.now = 0; f.level = 0; }
      sim.emptyLogged = true;
      log("T+" + sim.t.toFixed(1) + " s: out of fuel");
    } else {
      const keep = 1 - used / z.fuel;                 // every tank in the group gives the same share, so they drain evenly
      for (const t of z.tanks) t.fuel *= keep;
      z.fuel -= used;
    }
    for (const t of z.tanks) { t.part.fixture.setDensity((t.dry + t.fuel) / t.area); t.part.body.resetMassData(); }
  }

  let want = 0, left = 0;
  for (const p of sim.parts) for (const f of p.forces) if (f.kind === "thrust") want += f.now;
  for (const t of sim.tanks) if (!t.part.debris) left += t.fuel;   // the fuel readout is the rocket you fly
  sim.thrust = want;
  sim.fuel = left;

  for (const p of sim.parts) for (const f of p.forces) {
    if (f.kind !== "thrust") continue;
    const target = -controls.steer * f.gimbalMax;     // swivel so the thrust turns the rocket the way you steer
    f.angle += clamp(target - f.angle, -f.gimbalRate * dt, f.gimbalRate * dt);
    if (f.now > 0) {                                  // a force at the nozzle, along the part's axis tilted by the gimbal
      const a = p.body.getAngle() + f.angle;
      p.body.applyForce(P(-Math.sin(a) * f.now, Math.cos(a) * f.now), p.body.getWorldPoint(P(p.ox + f.at[0], p.oy + f.at[1])), true);   // f.at is relative to the part, ox, oy is where the part sits on its body
    }
  }
}

/* ---- staging (Space). sim.stages is the list of rows from the design; sim.stageNext is the row that fires next. ---- */
function stageName(id) { const L = sim.labels && sim.labels[id]; return L ? L.label : id; }
function stagesLeft() { return sim && sim.stages ? sim.stages.length - sim.stageNext : 0; }

/* Let go of the link between a decoupler and the part it hangs from: the piece that was holding on moves to a body of its own
   (updateVessels does that), and the decoupler's charge pushes the two pieces apart: the same impulse on both, in opposite directions. */
function decouple(dp) {
  const jt = dp.joint;
  if (!jt) return false;
  const parent = jt.parent;
  sim.joints.splice(sim.joints.indexOf(jt), 1);
  dp.joint = null;
  updateVessels();
  const a = dp.body.getAngle(), ux = -Math.sin(a), uy = Math.cos(a);        // the rocket's own axis
  const c1 = partCenter(parent), c2 = partCenter(dp);
  const s = ((c2.x - c1.x) * ux + (c2.y - c1.y) * uy) >= 0 ? 1 : -1;        // +1: the decoupler is above the part it let go of
  const J = dp.def.kick, up = dp.body, down = parent.body;
  up.applyLinearImpulse(P(s * ux * J, s * uy * J), up.getWorldCenter(), true);
  down.applyLinearImpulse(P(-s * ux * J, -s * uy * J), down.getWorldCenter(), true);
  return true;
}

function fireStage() {               // the next row of the staging list: engines in it are activated, decouplers let go
  if (stagesLeft() <= 0) return false;
  const n = sim.stageNext + 1, row = sim.stages[sim.stageNext++], did = [];
  for (const id of row) for (const p of sim.parts) {
    if (p.def.id !== id) continue;
    if (p.def.kind === "engine") { if (!p.debris) { p.active = true; did.push("activated " + stageName(id)); } }
    else if (p.def.kind === "decoupler" && decouple(p)) did.push("decoupled " + stageName(id));
  }
  log("Stage " + n + ": " + (did.length ? did.join(", ") : "nothing left to fire"), "flight");
  return true;
}

/* ---- breaking: a part that hits the ground too hard breaks off ----
   Each step the world (onPreSolve / onPostSolve in world.js) noted, for every part touching the ground, how fast its contact point was
   closing on the ground (part.hitV) and how much push the ground gave it (part.hitJ). The work the ground did on that part is about
   half of push x closing speed. That is the impact energy the part had to soak up, and it already shares the landing among the legs
   by itself (the leg that touches first, or that is pushed harder, takes more) and counts the rocket's whole weight and spin.
   If it is more than the part's own capacity (rules.js, impactCapacity) the part breaks off, and only that part: its link is cut, so it
   (and anything that hung only from it) becomes a separate piece. Nothing else is checked, so one break never sets off another.
   The first part, the hull, has no link and cannot break off. Dropped pieces do not break. */
function breakPart(p) {
  const jt = p.joint;
  if (!jt) return false;
  sim.joints.splice(sim.joints.indexOf(jt), 1);
  p.joint = null;
  // The rocket you fly stays the piece the hull is in, whichever piece holds the highest part (a nose that breaks off must not
  // become "the rocket" and leave the tanks behind as wreckage). So the reference part becomes the highest one still linked to the hull.
  const keep = {}, queue = [sim.hull];
  keep[sim.hull.idx] = true;
  while (queue.length) {
    const q = queue.pop();
    for (const j of sim.joints) {
      const other = j.part === q ? j.parent : j.parent === q ? j.part : null;
      if (other && !keep[other.idx]) { keep[other.idx] = true; queue.push(other); }
    }
  }
  let top = sim.hull, topY = -Infinity;
  for (const q of sim.parts) if (keep[q.idx]) for (const v of q.verts) if (q.def.at[1] + v.y > topY) { topY = q.def.at[1] + v.y; top = q; }
  sim.topPart = top;
  updateVessels();
  return true;
}

function checkImpacts() {
  const hits = [];
  for (const p of sim.parts) {
    const J = p.hitJ, vc = p.hitV;
    p.hitJ = 0; p.hitV = 0;
    if (J <= 0 || p.debris || !p.joint || vc < MIN_IMPACT_SPEED) continue;
    const E = 0.5 * J * vc, cap = impactCapacity(p.def);
    if (E > cap) hits.push({ part: p, E: E, cap: cap, v: vc });
  }
  if (hits.length === 0) return;
  const mass = totalMass(), fuel = sim.fuel;          // the rocket as it was when it hit
  for (const h of hits) {
    log("T+" + sim.t.toFixed(1) + " s: " + h.part.name + " broke off. It took " + (h.E / 1000).toFixed(1) + " kJ and can take " + (h.cap / 1000).toFixed(1) + " kJ (closing at " + h.v.toFixed(1) + " m/s, rocket " + mass.toFixed(0) + " kg with " + fuel.toFixed(0) + " kg of fuel)", "warning");
    breakPart(h.part);
  }
}

function stepSim() {
  const w = sim.world;
  addGravity(w);
  updateControls(DT);
  applyPartForces(DT);
  applyAero();

  // the reaction wheels (the turning push is whatever the rocket's wheels add up to), with optional damping of any spin
  const wheelMax = sim.wheelMax;
  let tq = controls.steer * wheelMax;
  if (controls.damping) tq -= DAMP_PER_TORQUE * wheelMax * sim.hull.body.getAngularVelocity();
  sim.hull.body.applyTorque(clamp(tq, -wheelMax, wheelMax), true);

  w.step(DT, VEL_IT, POS_IT);
  checkImpacts();                                             // parts that hit the ground too hard break off
  if (sim.thrust > 0) sim.started = true;                     // the flight clock starts at ignition
  if (sim.started) sim.t += DT;
  updateFlightStats();

  const p = sim.hull.body.getPosition();
  if (Math.hypot(p.x, p.y) - R > 5.5) { sim.airborne = true; sim.flown = true; }
  telemetryStep();
}
