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
  let want = 0, flow = 0;                             // total thrust asked for this step, and fuel burned per second
  const lit = controls.throttle > 0 && sim.fuel > 0;
  for (const p of sim.parts) for (const f of p.forces) {
    if (f.kind !== "thrust") continue;
    f.level = lit ? f.minThrottle + (1 - f.minThrottle) * controls.throttle : 0;   // an engine cannot run below minThrottle
    f.now = f.level * (f.vac - (f.vac - f.sl) * pf);
    want += f.now;
    flow += f.level * f.mdot;
  }

  if (want > 0) {                                     // burn fuel, and make the tank lighter
    sim.fuel = Math.max(0, sim.fuel - flow * dt);
    const left = sim.fuel / sim.fuelFull;             // every tank drains evenly, so each one is the same fraction full
    for (const t of sim.tanks) {
      t.fixture.setDensity((t.dry + left * t.full) / t.area);
      t.part.body.resetMassData();
    }
    if (sim.fuel === 0 && !sim.emptyLogged) {
      sim.emptyLogged = true;
      log("T+" + sim.t.toFixed(1) + " s: out of fuel");
      want = 0;
      for (const p of sim.parts) for (const f of p.forces) if (f.kind === "thrust") f.now = 0;
    }
  }
  sim.thrust = want;

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
