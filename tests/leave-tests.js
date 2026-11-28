/* =====================================================================
   LEAVE TESTS  (tests/leave-tests.js)
   Runs the real game files and the real physics engine without a browser. A rocket is put in each situation
   a player could be in, and the game is asked whether it can be left, and why not. Needs Node.js.
   From the project folder:   node tests/leave-tests.js

   1. The vessel list's words: distances, and where each kind of vessel is.
   2. Can the rocket be left? On the pad, in the air, in orbit, burning, turning, still moving...
   3. Leaving: what is saved, and what happens to "Revert to launch".
   4. Reverting.
   5. Switching to another vessel.
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const planck = require(path.join(root, "js", "planck.min.js"));

let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
function fakeStore() { const data = {}; return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } }; }

function loadGame(store) {
  const ctx = { console, Math, Object, Array, Number, JSON, Date, Error, isFinite, parseInt, String, encodeURIComponent, decodeURIComponent, document: { body: {} }, window: { addEventListener() {} }, planck, localStorage: store };
  vm.createContext(ctx);
  for (const f of ["util", "settings", "rules", "parts", "design", "universe", "controls", "aero", "telemetry", "world", "sim", "orbit", "vessellist", "flightstate"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  ctx.log = () => {};
  const g = { ctx, run: (e) => vm.runInContext(e, ctx) };
  g.fn = (name) => g.run(name);
  g.step = (n) => { const s = g.fn("stepSim"); for (let i = 0; i < n; i++) s(); };
  g.tick = (sec) => g.fn("flightTick")(sec);
  g.place = (x, y, vx, vy, w) => { const b = g.run("sim.hull.body"); b.setTransform(new planck.Vec2(x, y), 0); b.setLinearVelocity(new planck.Vec2(vx, vy)); b.setAngularVelocity(w || 0); };
  return g;
}

/* a game with one vessel of the default rocket on the pad, kept by the flight (as the flight page does after the builder's Launch) */
function startFlight(status, touched, steps) {
  const store = fakeStore(), g = loadGame(store);
  const add = g.fn("universeAddVessel")(g.fn("universeNew")(), g.run("DESIGN"), "Test");
  g.fn("universeSave")(add.universe);
  g.run("ROCKET = assemble(DESIGN)"); g.run("buildWorld()");
  g.fn("flightAttach")(add.id, status === undefined ? "pad" : status);
  if (touched !== false) g.run("fireStage()");                 // an untouched rocket can always be left, so most tests use one that has had its stage fired (throttle still off)
  g.step(steps === undefined ? 60 : steps); if (steps !== 0) g.tick(1);   // it settles on the pad
  return g;
}
const reasons = (g) => g.fn("flightCanLeave")().reasons.join(" | ");
const R = 600000, MU = loadGame(fakeStore()).run("MU"), SPACE = loadGame(fakeStore()).run("SPACE_ALT"), MARGIN = loadGame(fakeStore()).run("LEAVE_ORBIT_MARGIN");
const circ = (alt) => Math.sqrt(MU / (R + alt));

/* ---- 1. the vessel list's words ---- */
console.log("\n1. The vessel list's words");
const W = loadGame(fakeStore());
check(W.fn("vlKm")(842) === "842 m" && W.fn("vlKm")(12300) === "12.3 km" && W.fn("vlKm")(480000) === "480 km" && W.fn("vlKm")(999.6) === "1000 m", "distances read as 842 m, 12.3 km, 480 km");
const state = (x, y, vx, vy) => ({ pos: { x, y }, vel: { x: vx, y: vy }, angle: 0, angVel: 0, fuel: {}, stageNext: 0 });
const where = (status, st) => W.fn("vesselWhere")({ status, state: st });
check(where("pad", null) === "On the launch pad", "on the pad");
check(where("landed", state(R * Math.sin(500 / R), R * Math.cos(500 / R), 0, 0)) === "Landed, 500 m from the pad", "landed, with how far from the pad");
check(where("orbit", state(0, R + 120000, circ(120000), 0)) === "In orbit, 120 km by 120 km", "in orbit, lowest by highest point");
check(where("flying", state(0, R + 5040, 0, 90)) === "Mid-flight, 5.0 km up", "mid-flight, with the height");
const rows = W.fn("vesselRows")({ activeId: "v2", vessels: [{ id: "v1", name: "One", status: "landed", state: state(0, R, 0, 0) }, { id: "v2", name: "Two", status: "flying", state: state(0, R + 1000, 0, 5) }] });
check(rows[0].id === "v2" && rows[0].active && rows[0].unsafe && rows[1].id === "v1" && !rows[1].unsafe, "rows come newest first, with the active one and any left mid-flight marked");

/* ---- 2. can the rocket be left? ---- */
console.log("\n2. Can the rocket be left?");
let g = loadGame(fakeStore()); g.run("ROCKET = assemble(DESIGN)"); g.run("buildWorld()");
check(g.fn("flightCanLeave")().ok, "a free test flight (not kept) is never stopped from leaving");
g = startFlight("pad", false, 0);
check(g.fn("flightCanLeave")().ok && g.fn("flightIsUntouched")() && g.fn("flightCanLeave")().where === "pad", "a rocket nothing has happened to can be left at once, even before it has touched the ground");
g = startFlight();
let c = g.fn("flightCanLeave")();
check(c.ok && c.where === "ground" && c.reasons.length === 0 && !g.fn("flightIsUntouched")(), "a rocket that has fired its stage and sits still on the pad can be left (" + c.where + ")");
check(g.fn("flightTouchingGround")(), "the real contact check sees it touching the ground");
g.run("controls.throttle = 0.5");
check(!g.fn("flightCanLeave")().ok && /throttle is on/.test(reasons(g)), "throttle on: refused, and it says so");
g.step(10); g.tick(0.2);
check(g.run("flightCalm") === 0, "and a burning rocket is no longer counted as calm");
g.run("controls.throttle = 0");
g.place(g.run("sim.hull.body.getPosition().x"), g.run("sim.hull.body.getPosition().y"), 0, 0, 0.3);
check(/still turning \(17\.2 degrees a second/.test(reasons(g)), "spinning at 0.3 rad/s: refused, with the spin in degrees a second");
g = startFlight(); g.run("flightCalm = 0"); g.tick(1);
check(/still settling \(keep it still for 1\.0 more seconds\)/.test(reasons(g)), "only just still: it says how much longer to wait (1.0 s)");
g.tick(1.1);
check(g.fn("flightCanLeave")().ok, "after the 2 seconds it can be left");
g = startFlight(); g.place(g.run("sim.hull.body.getPosition().x"), g.run("sim.hull.body.getPosition().y"), 1.5, 0, 0);
check(/still moving \(1\.5 m\/s\)/.test(reasons(g)), "sliding at 1.5 m/s on the ground: refused");
g = startFlight(); { const p = g.run("sim.hull.body.getPosition()"); g.place(p.x, p.y + 1.5, 0, 0, 0); g.step(2); }
check(/not touching the ground/.test(reasons(g)) && g.run("sim.airborne") === false, "hovering 1.5 m up (not yet counted as flying): refused, it is not touching the ground");
g = startFlight(); { const p = g.run("sim.hull.body.getPosition()"); g.place(p.x, p.y + 100, 0, 0, 0); g.step(2); }
check(/in the air/.test(reasons(g)), "100 m up it counts as in the air: refused");
g = startFlight(); g.run("sim.airborne = true"); g.place(0, R + 5000, 0, 0, 0);
check(/in the air, 5\.0 km up/.test(reasons(g)) && !g.fn("flightCanLeave")().ok, "in the air at 5 km: refused");
g = startFlight(); g.run("sim.airborne = true"); g.place(0, R + 120000, circ(120000), 0, 0);
c = g.fn("flightCanLeave")();
check(c.ok && c.where === "orbit", "a circular orbit at 120 km can be left (" + c.where + ")");
g.run("controls.throttle = 0.1");
check(!g.fn("flightCanLeave")().ok, "but not with the throttle on");
g.run("controls.throttle = 0");
g.place(0, R + 120000, circ(120000), 0, 0.2);
check(/still turning/.test(reasons(g)), "and not while it is turning");
g = startFlight(); g.run("sim.airborne = true"); g.place(0, R + 80000, circ(80000) * 0.9, 0, 0);
check(/lowest point of its orbit is .* up; it needs to be above 75\.0 km/.test(reasons(g)), "above the air but with the lowest point of its orbit down in it: refused");
g = startFlight(); g.run("sim.airborne = true");
{ const ra = R + 120000, rp = R + SPACE + 2000, vApo = Math.sqrt(2 * MU * rp / (ra * (ra + rp))); g.place(0, ra, vApo, 0, 0); }
check(/it needs to be above 75\.0 km/.test(reasons(g)), "a lowest point 2 km above the air line is still too close: the 5 km margin applies");
g = startFlight(); g.run("sim.airborne = true");
{ const ra = R + 120000, rp = R + SPACE + MARGIN + 3000, vApo = Math.sqrt(2 * MU * rp / (ra * (ra + rp))); g.place(0, ra, vApo, 0, 0); }
check(g.fn("flightCanLeave")().ok, "and 3 km past the margin is fine");
g = startFlight(); g.run("sim.airborne = true"); g.place(0, R + 120000, circ(120000) * 1.6, 0, 0);
check(/not in orbit: its path leaves the planet/.test(reasons(g)), "faster than escape speed: refused, not in orbit");

/* ---- 3. leaving ---- */
console.log("\n3. Leaving");
g = startFlight();
let u = g.fn("universeLoad")().universe;
check(u.vessels[0].revert === true && g.fn("flightCanRevert")().ok, "before leaving: the vessel can be reverted");
let out = g.fn("flightLeave")();
u = g.fn("universeLoad")().universe;
check(out.ok && u.vessels[0].status === "pad" && u.vessels[0].state !== null && u.vessels[0].state.stageNext === 1 && u.vessels[0].revert === false, "leaving a rocket that has fired its stage, on the pad, saves it as on the pad with its state, and revert switched off");
g = startFlight("pad", false);
out = g.fn("flightLeave")(); u = g.fn("universeLoad")().universe;
check(out.ok && u.vessels[0].status === "pad" && u.vessels[0].state === null && u.vessels[0].revert === false, "leaving (switching away from) an untouched rocket keeps it on the pad, with no state and revert off");
g = startFlight("pad", false);
out = g.fn("flightUnload")(); u = g.fn("universeLoad")().universe;
check(out.ok && u.vessels.length === 0 && u.activeId === null && !g.fn("flightTracked")() && g.fn("padIsClear")(u), "going back to the builder with an untouched rocket takes it out of the universe and clears the pad");
g = startFlight(); out = g.fn("flightUnload")();
check(out.ok && g.fn("universeLoad")().universe.vessels.length === 0, "(the unload itself works on any kept vessel; the menu only offers it for an untouched one)");
g = startFlight(); g.run("sim.airborne = true"); g.run("sim.flown = true"); g.run("sim.started = true"); g.place(0, R + 120000, circ(120000), 0, 0);
out = g.fn("flightLeave")(); u = g.fn("universeLoad")().universe;
check(out.ok && u.vessels[0].status === "orbit" && u.vessels[0].revert === false && Math.abs(u.vessels[0].state.pos.y - (R + 120000)) < 1e-6 && Math.abs(u.vessels[0].state.vel.x - circ(120000)) < 1e-6, "leaving in orbit saves it as in orbit, where it is, with revert off");
g = startFlight(); g.run("sim.airborne = true"); g.place(0, R + 5000, 0, 0, 0);
u = g.fn("universeLoad")().universe; const before = JSON.stringify(u.vessels[0]);
out = g.fn("flightLeave")();
check(!out.ok && out.reasons.length >= 1 && JSON.stringify(g.fn("universeLoad")().universe.vessels[0]) === before, "trying to leave in the air is refused and changes nothing in the universe");

/* ---- 4. reverting ---- */
console.log("\n4. Reverting");
g = startFlight(); g.fn("flightLeave")();
let rv = g.fn("flightCanRevert")();
check(!rv.ok && /has been left since/.test(rv.reason), "once it has been left, revert is refused, with the reason");
g = startFlight();
{ const raw = g.fn("universeLoad")().universe; raw.vessels[0].status = "flying"; raw.vessels[0].state = state(0, R + 50, 0, 3);          // this one is off the pad ...
  raw.vessels.push({ id: "v2", name: "Other", design: raw.vessels[0].design, status: "pad", state: null, revert: true }); raw.nextId = 3;     // ... and another has taken it
  check(g.fn("universeSave")(raw).ok, "(a universe with one vessel flying and another on the pad is valid)"); }
rv = g.fn("flightCanRevert")();
check(!rv.ok && /pad is not clear: Other is on it/.test(rv.reason), "revert is refused if another vessel is on the pad");
g = loadGame(fakeStore()); g.run("ROCKET = assemble(DESIGN)"); g.run("buildWorld()");
check(g.fn("flightCanRevert")().ok, "a free test flight can always revert");
g = startFlight(); g.fn("universeSave")(g.fn("universeRemoveVessel")(g.fn("universeLoad")().universe, "v1").universe);
check(!g.fn("flightCanRevert")().ok, "a vessel that is no longer in the universe cannot revert");

/* ---- 5. switching to another vessel ---- */
console.log("\n5. Switching to another vessel");
function twoVessels() {
  const store = fakeStore(), g = loadGame(store);
  let uu = g.fn("universeNew")();
  const a = g.fn("universeAddVessel")(uu, g.run("DESIGN"), "Parked"); uu = g.fn("universeUpdateVessel")(a.universe, a.id, { status: "orbit", state: state(0, R + 120000, circ(120000), 0), revert: false }).universe;
  const b = g.fn("universeAddVessel")(uu, g.run("DESIGN"), "Flown");
  g.fn("universeSave")(b.universe);
  g.run("ROCKET = assemble(DESIGN)"); g.run("buildWorld()");
  g.fn("flightAttach")(b.id, "pad"); g.step(60); g.tick(1);
  return { g, a: a.id, b: b.id };
}
let t = twoVessels();
out = t.g.fn("flightSwitchTo")(t.a);
u = t.g.fn("universeLoad")().universe;
check(out.ok && u.activeId === t.a && u.vessels.find((v) => v.id === t.b).revert === false && !t.g.fn("flightTracked")(), "switching leaves this vessel (revert off), makes the other active, and stops keeping this one");
t = twoVessels(); t.g.run("controls.throttle = 0.4");
out = t.g.fn("flightSwitchTo")(t.a); u = t.g.fn("universeLoad")().universe;
check(!out.ok && /throttle/.test(out.problem) && u.activeId === t.b && u.vessels.find((v) => v.id === t.b).revert === true && t.g.fn("flightTracked")(), "with the throttle on the switch is refused and nothing changes");
t = twoVessels(); out = t.g.fn("flightSwitchTo")("v9"); u = t.g.fn("universeLoad")().universe;
check(!out.ok && /no vessel v9/.test(out.problem) && u.vessels.find((v) => v.id === t.b).revert === true && t.g.fn("flightTracked")(), "switching to a vessel that is not there is refused before anything is left or saved");
t = twoVessels(); const free = loadGame(fakeStore()); free.run("ROCKET = assemble(DESIGN)"); free.run("buildWorld()");
check(free.fn("flightSwitchTo")("v1").ok === false, "a free test flight has no universe to switch within");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
