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
    for (const t of z.tanks) { t.fixture.setDensity((t.dry + t.fuel) / t.area); t.part.body.resetMassData(); }
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
      p.body.applyForce(P(-Math.sin(a) * f.now, Math.cos(a) * f.now), p.body.getWorldPoint(P(f.at[0], f.at[1])), true);
    }
  }
}

/* ---- staging (Space). sim.stages is the list of rows from the design; sim.stageNext is the row that fires next. ---- */
function stageName(id) { const L = sim.labels && sim.labels[id]; return L ? L.label : id; }
function stagesLeft() { return sim && sim.stages ? sim.stages.length - sim.stageNext : 0; }

/* Let go of the weld between a decoupler and the part it hangs from, and push the two pieces apart with the decoupler's charge:
   the same impulse on both, in opposite directions, shared out by mass so no part is jerked against its neighbours. */
function decouple(dp) {
  const jt = dp.joint;
  if (!jt) return false;
  const parent = jt.parent;
  sim.world.destroyJoint(jt.j);
  sim.joints.splice(sim.joints.indexOf(jt), 1);
  dp.joint = null;
  updateVessels();
  const a = dp.body.getAngle(), ux = -Math.sin(a), uy = Math.cos(a);        // the rocket's own axis
  const c1 = parent.body.getWorldCenter(), c2 = dp.body.getWorldCenter();
  const s = ((c2.x - c1.x) * ux + (c2.y - c1.y) * uy) >= 0 ? 1 : -1;        // +1: the decoupler is above the part it let go of
  let mA = 0, mB = 0;
  for (const p of sim.parts) { if (p.group === dp.group) mB += p.body.getMass(); else if (p.group === parent.group) mA += p.body.getMass(); }
  const J = dp.def.kick;
  for (const p of sim.parts) {
    const m = p.body.getMass();
    if (p.group === dp.group) p.body.applyLinearImpulse(P(s * ux * J * m / mB, s * uy * J * m / mB), p.body.getWorldCenter(), true);
    else if (p.group === parent.group) p.body.applyLinearImpulse(P(-s * ux * J * m / mA, -s * uy * J * m / mA), p.body.getWorldCenter(), true);
  }
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

function stepSim() {
  const w = sim.world;
  addGravity(w);
  updateControls(DT);
  applyPartForces(DT);
  applyAero();

  // reaction wheel, with optional damping of any spin
  let tq = controls.steer * WHEEL_MAX;
  if (controls.damping) tq -= DAMP_K * sim.hull.body.getAngularVelocity();
  sim.hull.body.applyTorque(clamp(tq, -WHEEL_MAX, WHEEL_MAX), true);

  w.step(DT, VEL_IT, POS_IT);
  if (sim.thrust > 0) sim.started = true;                     // the flight clock starts at ignition
  if (sim.started) sim.t += DT;
  updateFlightStats();

  const inv = 1 / DT;                                 // joint loads are tracked for later (not shown right now)
  for (const j of sim.joints) {
    const f = j.j.getReactionForce(inv);
    j.force = Math.hypot(f.x, f.y);
    if (j.force > j.peak) j.peak = j.force;
  }
  const p = sim.hull.body.getPosition();
  if (Math.hypot(p.x, p.y) - R > 5.5) { sim.airborne = true; sim.flown = true; }
  telemetryStep();
}
