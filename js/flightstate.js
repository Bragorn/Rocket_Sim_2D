"use strict";

/* =====================================================================
   FLIGHT STATE  (js/flightstate.js)
   The link between the flight page and the universe (universe.js). It does three things:
     captureVessel()      what the rocket you fly is right now, as a vessel status and a state (the shape is in universe.js)
     restoreVessel(state) put a freshly built rocket back exactly as that state says
     persistFlight() ...  keep the universe up to date as you fly, and take the vessel out of it when it is recovered
   The flight page loads the active vessel of the universe when it opens (flightLoadActive), so leaving for the builder and
   coming back finds the rocket where you left it.
   What is kept: the rocket you fly (the piece holding the highest part): where it is, how fast, which way it points and spins,
   the fuel in each tank, the staging step, which engines are lit, the throttle and the flight clock. Parts that broke off or
   were dropped are NOT kept: they are gone when the flight is reloaded (a later milestone turns them into vessels of their own).
   Not kept: the autopilot and landing program (they switch off), the flight recorder (the report starts again), the smoke.
   Time stands still while you are away: nothing flies on in the background yet (a later milestone).
   Leaving: a vessel can be left (back to the builder, or over to another vessel) only when it can be stored without simulating it:
   on the ground and calm, or in a permanent orbit, with the throttle off (flightCanLeave says what is wrong, in words).
   Leaving saves it for good and ends "Revert to launch" for it. A vessel in the air or burning cannot be left.
   Only a vessel the universe knows about is saved. A flight opened with a design in the address, or with no vessel active,
   is a free test flight and never touches the universe.
   ===================================================================== */

let flightVesselId = null;          // the universe vessel being flown, or null (a test flight that is not kept)
let flightSavedKey = "";            // what was last written, so nothing is written again if nothing changed
let flightPending = 0;              // seconds of physics since the universe clock was last moved on
let flightNextSave = 0;             // when (performance.now) the next automatic save is due
let flightCalm = 0;                 // seconds (physics time) the rocket has been calm: still, steady, throttle off, touching the ground
let flightRelaunch = false;         // true after a kept vessel was recovered: "Launch again" may put the same design back on the pad as a new vessel
const FLIGHT_SAVE_EVERY = 5000;     // ms between automatic saves while flying

/* ---- what is the rocket doing? ---- */
/* One of universe.js VESSEL_STATUS. "flying" means it could not be stored as it is: in the air, burning, turning, sliding, or on a path
   that comes back down into the air. Only pad, landed and orbit are safe states (the same rules as leaving; see flightLeaveProblems). */
function flightStatusNow() {
  const q = flightLeaveProblems();
  if (q.why.length > 0) return "flying";
  if (q.where === "orbit") return "orbit";
  const p = sim.hull.body.getPosition();
  const arc = R * Math.abs(Math.atan2(p.x, p.y));               // how far along the ground from the pad (the pad is at the top of the planet)
  return arc <= PAD_RADIUS ? "pad" : "landed";
}

function captureVessel() {          // { status, state }; state is null while the rocket is untouched on the pad
  const b = sim.hull.body, p = b.getPosition(), v = b.getLinearVelocity(), status = flightStatusNow();
  const fuel = {}, lit = [], gone = [];
  for (const t of sim.tanks) if (!t.part.debris) fuel[t.part.def.id] = t.fuel;
  for (const q of sim.parts) {
    if (q.debris) gone.push(q.def.id);
    else if (q.def.kind === "engine" && q.active) lit.push(q.def.id);
  }
  const untouched = !sim.airborne && !sim.started && !sim.flown && sim.stageNext === 0 && controls.throttle === 0 && gone.length === 0;
  if (untouched) return { status: "pad", state: null };
  return { status: status, state: {
    pos: { x: p.x, y: p.y }, vel: { x: v.x, y: v.y }, angle: b.getAngle(), angVel: b.getAngularVelocity(),
    fuel: fuel, stageNext: sim.stageNext, activeEngines: lit, detached: gone, throttle: controls.throttle, damping: controls.damping,
    clock: sim.t, started: sim.started, flown: sim.flown, airborne: sim.airborne } };
}

/* Put a freshly built rocket (buildWorld just ran, so it stands whole on the pad) back as `state` says.
   The parts that were gone are taken out of the world for good; the rest get their fuel, and the body its place and speed. */
function restoreVessel(state) {
  const gone = {};
  for (const id of state.detached || []) gone[id] = true;

  // the rocket you fly is the piece holding the highest part that is left (the same rule as buildWorld and breakPart)
  let top = null, topY = -Infinity;
  for (const q of sim.parts) if (!gone[q.def.id]) for (const v of q.verts) if (q.def.at[1] + v.y > topY) { topY = q.def.at[1] + v.y; top = q; }
  if (!top) return { ok: false, problem: "every part of this vessel is gone" };
  sim.topPart = top;

  for (const j of sim.joints.slice()) {                       // cut every link that touched a missing part
    if (gone[j.part.def.id] || gone[j.parent.def.id]) { sim.joints.splice(sim.joints.indexOf(j), 1); j.part.joint = null; }
  }
  updateVessels();                                            // sorts the parts into the rocket and the pieces that are gone (and gives each piece a body)

  const dead = sim.parts.filter(function (q) { return q.debris; }), bodies = [];
  for (const q of dead) if (bodies.indexOf(q.body) < 0) bodies.push(q.body);
  for (const b of bodies) sim.world.destroyBody(b);           // nothing of them stays in the world
  sim.parts = sim.parts.filter(function (q) { return !q.debris; });
  sim.parts.forEach(function (q, i) { q.idx = i; });
  sim.tanks = sim.tanks.filter(function (t) { return !t.part.debris; });

  for (const t of sim.tanks) {                                // the fuel each tank had, and the weight that goes with it
    const kg = state.fuel && state.fuel[t.part.def.id];
    t.fuel = kg === undefined ? t.full : Math.max(0, Math.min(t.full, kg));
    t.part.fixture.setDensity((t.dry + t.fuel) / t.area);
  }
  for (const q of sim.parts) if (q.def.kind === "engine") q.active = (state.activeEngines || []).indexOf(q.def.id) >= 0;
  sim.stageNext = Math.max(0, Math.min(sim.stages.length, state.stageNext || 0));
  updateVessels();                                            // fuel groups (zones), steering power and the hull, now that the parts and fuel are final

  const body = sim.hull.body;
  body.resetMassData();
  body.setTransform(P(state.pos.x, state.pos.y), state.angle);
  body.setLinearVelocity(P(state.vel.x, state.vel.y));
  body.setAngularVelocity(state.angVel);
  body.setAwake(true);
  sim.pvx = state.vel.x; sim.pvy = state.vel.y;               // so the acceleration readout does not jump on the first step
  sim.rho = airDensity(Math.hypot(state.pos.x, state.pos.y) - R);   // the engines read the air of the step before: without this the first step runs on sea-level air

  controls.throttle = state.throttle || 0;
  controls.damping = state.damping !== false;
  sim.t = state.clock || 0;
  const high = Math.hypot(state.pos.x, state.pos.y) - R > 100;     // a state without the flight flags: judge them from the height
  sim.airborne = state.airborne !== undefined ? !!state.airborne : high;
  sim.flown = state.flown !== undefined ? !!state.flown : sim.airborne;
  sim.started = state.started !== undefined ? !!state.started : sim.flown;
  return { ok: true, problem: null };
}

/* ---- opening the flight page: which vessel to fly ---- */
/* Returns { id, design, state, status, notes }. id is null when there is nothing to load (then the page flies the free test rocket).
   notes are things to tell the player, as lines for the message log. */
function flightLoadActive() {
  const out = { id: null, design: null, state: null, status: null, notes: [] };
  if (typeof universeLoad !== "function") return out;
  const r = universeLoad();
  if (r.status === "none") return out;
  if (r.status === "unreadable") { out.notes.push("The saved universe could not be read (" + r.problems[0] + "). Nothing was changed. This is a free test flight."); return out; }
  if (r.status === "recovered") out.notes.push("The saved universe was recovered from a backup (" + (r.problems[0] || "an interrupted save was finished") + ").");
  const u = r.universe, v = u.activeId ? universeVessel(u, u.activeId) : null;
  if (!v) return out;
  const bad = validateDesign(v.design);
  if (bad.length) { out.notes.push(v.name + " cannot be loaded: " + bad[0] + ". Nothing was changed. This is a free test flight."); return out; }
  out.id = v.id; out.design = v.design; out.state = v.state; out.status = v.status;
  return out;
}

/* Start keeping vessel `id`. `status` is what it was when it was loaded: one that was safe (pad, landed, orbit) starts out counted as calm,
   so a vessel you have only just resumed can be left again straight away. */
function flightAttach(id, status) {
  flightVesselId = id; flightSavedKey = ""; flightPending = 0; flightNextSave = 0;
  flightCalm = status && status !== "flying" ? LEAVE_SETTLE : 0;
}
function flightDetach() { flightVesselId = null; flightSavedKey = ""; flightPending = 0; }   // stop keeping it (after it has been left for good)
function flightTracked() { return flightVesselId !== null; }

function flightTouchingGround() {   // is any part of the rocket touching the planet? (all its parts are on the one body)
  for (let ce = sim.hull.body.getContactList(); ce; ce = ce.next) if (ce.other === sim.ground && ce.contact.isTouching()) return true;
  return false;
}
function flightIsCalm() {           // on the ground, still, turning slowly, engines off
  const b = sim.hull.body, v = b.getLinearVelocity();
  return controls.throttle === 0 && sim.thrust === 0 && Math.hypot(v.x, v.y) < LEAVE_SPEED && Math.abs(b.getAngularVelocity()) < LEAVE_SPIN && flightTouchingGround();
}
function flightTick(seconds) {      // main.js: physics time that has just passed
  if (!flightVesselId) return;
  flightPending += seconds;
  flightCalm = flightIsCalm() ? flightCalm + seconds : 0;
}

/* ---- leaving, and reverting ---- */
/* What stops the rocket being stored as it is right now, not counting how long it has been calm: { why, where }.
   why is a list of plain sentences (empty = it could be stored); where is "ground" or "orbit" when it could. */
function flightLeaveProblems() {
  const why = [], b = sim.hull.body, p = b.getPosition(), v = b.getLinearVelocity();
  const speed = Math.hypot(v.x, v.y), spin = Math.abs(b.getAngularVelocity()), alt = Math.hypot(p.x, p.y) - R, deg = 180 / Math.PI;
  let where = null;
  if (controls.throttle > 0) why.push("the throttle is on");
  else if (sim.thrust > 0) why.push("an engine is still producing thrust");
  if (spin >= LEAVE_SPIN) why.push("it is still turning (" + (spin * deg).toFixed(1) + " degrees a second; it needs to be under " + (LEAVE_SPIN * deg).toFixed(0) + ")");
  if (sim.airborne) {
    if (alt <= SPACE_ALT) why.push("it is in the air, " + vlKm(alt) + " up (it can only be left on the ground or in orbit above " + vlKm(SPACE_ALT + LEAVE_ORBIT_MARGIN) + ")");
    else {
      const o = orbitInfo(p, v), floor = R + SPACE_ALT + LEAVE_ORBIT_MARGIN;
      if (!o.bound) why.push("it is not in orbit: its path leaves the planet");
      else if (o.rp < floor) why.push("the lowest point of its orbit is " + vlKm(o.rp - R) + " up; it needs to be above " + vlKm(floor - R) + " to stay clear of the air");
      else where = "orbit";
    }
  } else {
    if (!flightTouchingGround()) why.push("it is not touching the ground");
    if (speed >= LEAVE_SPEED) why.push("it is still moving (" + speed.toFixed(1) + " m/s)");
    if (why.length === 0) where = "ground";
  }
  return { why: why, where: why.length === 0 ? where : null };
}

/* Can the rocket be left now? { ok, reasons, where }: reasons are plain sentences (empty when ok), where is "ground" or "orbit" when ok.
   On the ground it must also have been calm for LEAVE_SETTLE seconds. A free test flight is never kept, so nothing stops you
   leaving it (the menu asks first). */
function flightCanLeave() {
  if (!flightVesselId) return { ok: true, reasons: [], where: null };
  const q = flightLeaveProblems(), why = q.why.slice();
  let where = q.where;
  if (why.length === 0 && where === "ground" && flightCalm < LEAVE_SETTLE) { why.push("it is still settling (keep it still for " + (LEAVE_SETTLE - flightCalm).toFixed(1) + " more seconds)"); where = null; }
  return { ok: why.length === 0, reasons: why, where: where };
}

/* Leave the rocket: save it for good (it can no longer be reverted) if it is being kept. Returns { ok, problem, reasons }. */
function flightLeave() {
  const c = flightCanLeave();
  if (!c.ok) return { ok: false, problem: c.reasons[0], reasons: c.reasons };
  if (!flightVesselId) return { ok: true, problem: null, reasons: [] };
  const s = persistFlight(true, { revert: false });
  return s.ok ? { ok: true, problem: null, reasons: [] } : { ok: false, problem: s.problem, reasons: [s.problem] };
}

/* Leave this rocket and make vessel `id` the active one. The page then reloads into it (it opens the active vessel). */
function flightSwitchTo(id) {
  const r0 = universeLoad();
  if (!r0.universe) return { ok: false, problem: "the saved universe is not there to update", reasons: [] };
  if (!universeVessel(r0.universe, id)) return { ok: false, problem: "there is no vessel " + id, reasons: [] };   // checked first: nothing is left or saved if it cannot be switched to
  const l = flightLeave();
  if (!l.ok) return l;
  const r = universeLoad();                                                                                          // (leaving just saved the universe, so read it again)
  const sw = universeSetActive(r.universe, id);
  if (sw.problem) return { ok: false, problem: sw.problem, reasons: [sw.problem] };
  const s = universeSave(sw.universe);
  if (s.ok) flightDetach();
  return s.ok ? { ok: true, problem: null, reasons: [] } : { ok: false, problem: s.problem, reasons: [s.problem] };
}

/* May the rocket be reverted to launch? Only during the flight it was launched in, and only if no other vessel has taken the pad. */
function flightCanRevert() {
  if (!flightVesselId || typeof universeLoad !== "function") return { ok: true, reason: null };
  const r = universeLoad();
  if (!r.universe) return { ok: false, reason: "the saved universe is not there" };
  const v = universeVessel(r.universe, flightVesselId);
  if (!v) return { ok: false, reason: "this vessel is no longer in the universe" };
  if (v.revert !== true) return { ok: false, reason: "reverting only works during the flight a rocket was launched in; this one has been left since" };
  const on = padOccupant(r.universe);
  if (on && on.id !== v.id) return { ok: false, reason: "the pad is not clear: " + on.name + " is on it" };
  return { ok: true, reason: null };
}

/* Write the rocket as it is now into the universe. Nothing is written if nothing changed since the last write
   (unless force is true, which also moves the universe clock on). `extra` adds to what is written (flightLeave turns revert off). Returns { ok, problem }. */
function persistFlight(force, extra) {
  if (!flightVesselId || typeof universeLoad !== "function") return { ok: false, problem: "this flight is not kept" };
  const cap = captureVessel(), key = JSON.stringify(cap);
  if (!force && key === flightSavedKey) return { ok: true, problem: null };
  const r = universeLoad();
  if (!r.universe) return { ok: false, problem: "the saved universe is not there to update" };
  if (!universeVessel(r.universe, flightVesselId)) return { ok: false, problem: "this vessel is no longer in the universe" };
  let u = universeUpdateVessel(r.universe, flightVesselId, Object.assign({ status: cap.status, state: cap.state }, extra)).universe;
  u = universeAdvance(u, flightPending);
  const s = universeSave(u);
  if (s.ok) { flightSavedKey = key; flightPending = 0; }
  return s;
}

function flightAutosave(nowMs) {    // called every frame; writes now and then while the rocket is being flown
  if (!flightVesselId || nowMs < flightNextSave) return;
  flightNextSave = nowMs + FLIGHT_SAVE_EVERY;
  persistFlight(false);
}

/* The vessel was recovered: it leaves the universe and the pad is clear again. */
function flightRecovered() {
  if (!flightVesselId || typeof universeLoad !== "function") return { ok: false, problem: "this flight is not kept" };
  const r = universeLoad();
  if (!r.universe) return { ok: false, problem: "the saved universe is not there to update" };
  let u = universeRemoveVessel(r.universe, flightVesselId).universe;
  u = universeAdvance(u, flightPending);
  const s = universeSave(u);
  if (s.ok) { flightVesselId = null; flightSavedKey = ""; flightPending = 0; flightRelaunch = true; }
  return s;
}

/* "Launch again" after a recovery: the same design goes back on the (clear) pad as a new vessel.
   Does nothing (and says ok) for any other flight: a free test flight never enters the universe. */
function flightRetrack(design) {
  if (flightVesselId || !flightRelaunch || typeof universeLoad !== "function") return { ok: true, problem: null };
  const r = universeLoad();
  if (r.status === "unreadable") return { ok: false, problem: "the saved universe could not be read, so it was left alone" };
  const a = universeAddVessel(r.universe || universeNew(), design);
  if (!a.id) return { ok: false, problem: a.problem };
  const s = universeSave(universeAdvance(a.universe, flightPending));
  if (s.ok) { flightAttach(a.id, "pad"); flightRelaunch = false; }
  return s;
}
