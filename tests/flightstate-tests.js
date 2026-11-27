/* =====================================================================
   FLIGHT STATE TESTS  (tests/flightstate-tests.js)
   Runs the real game files without a browser, and, unlike most of the other tests, the REAL physics engine
   (js/planck.min.js), because saving and restoring a flight is only worth anything if the restored rocket
   flies on exactly as the original would have. The browser's storage is a small stand-in.
   Needs Node.js. From the project folder:   node tests/flightstate-tests.js

   1. Capturing: what status the rocket has, and what is written down.
   2. Restoring a two-stage rocket: the parts that were dropped stay gone, the fuel and stage come back.
   3. The restored flight flies on the same as the one it came from (two worlds side by side), for two different rockets.
   4. Keeping the universe up to date: saves, the clock, recovery, "Launch again", free test flights.
   5. Opening the flight page: which vessel is loaded, and what happens when it cannot be.
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const planck = require(path.join(root, "js", "planck.min.js"));

let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);
const clone = (o) => JSON.parse(JSON.stringify(o));

/* a stand-in for localStorage that several game worlds can share, like several page loads in one browser */
function fakeStore() { const data = {}; return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } }; }

/* one page load: all the files of the flight page, in the order index.html loads them, minus the screen */
function loadGame(store) {
  const ctx = { console, Math, Object, Array, Number, JSON, Date, Error, isFinite, parseInt, String, encodeURIComponent, decodeURIComponent, document: { body: {} }, window: { addEventListener() {} }, planck, localStorage: store };
  vm.createContext(ctx);
  for (const f of ["util", "settings", "rules", "parts", "design", "universe", "controls", "aero", "telemetry", "world", "sim", "orbit", "vessellist", "flightstate"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  ctx.log = () => {};
  const g = { ctx, run: (e) => vm.runInContext(e, ctx) };
  g.fn = (name) => g.run(name);
  g.open = (design) => { g.run("ROCKET = assemble(" + JSON.stringify(design) + ")"); g.run("buildWorld()"); };   // a rocket on the pad, as main.js does it
  g.step = (n) => { const s = g.fn("stepSim"); for (let i = 0; i < n; i++) s(); };
  return g;
}

/* a two-stage rocket: upper tank with its engine and a nose, a decoupler under that engine, then the lower stage */
const TWO = { version: 1, name: "two", parts: [
  { id: "tank2", type: "tank", width: 2, length: 2 },
  { id: "eng2", type: "engine", thrust: 100000, parent: "tank2", anchor: "bottom", dx: 0 },
  { id: "dec", type: "decoupler", width: 2, parent: "eng2", anchor: "bottom", dx: 0 },
  { id: "tank1", type: "tank", width: 2, length: 4, parent: "dec", anchor: "bottom", dx: 0 },
  { id: "eng1", type: "engine", thrust: 250000, parent: "tank1", anchor: "bottom", dx: 0 },
  { id: "nose", type: "nose", width: 2, length: 1.5, parent: "tank2", anchor: "top", dx: 0 }
], stages: [["eng1"], ["dec", "eng2"]] };

/* ---- 1. capturing ---- */
console.log("\n1. Capturing");
let A = loadGame(fakeStore());
A.open(TWO);
let cap = A.fn("captureVessel")();
check(cap.status === "pad" && cap.state === null, "a rocket untouched on the pad is the status pad with no state");
A.run("fireStage()");
A.step(60);                                                    // it settles on the pad, engine lit but throttle off
cap = A.fn("captureVessel")();
check(cap.status === "pad" && cap.state && cap.state.activeEngines.join() === "eng1" && cap.state.stageNext === 1, "once a stage has fired it has a state (engine eng1 lit, stage 1 done), though it is still on the pad");
check(Object.keys(cap.state.fuel).sort().join() === "tank1,tank2" && cap.state.detached.length === 0, "the fuel of each tank is written down, and nothing is detached yet");
const rest = A.run("({ x: sim.hull.body.getPosition().x, y: sim.hull.body.getPosition().y })");
const bodyAt = (x, y, vx, vy, angle) => { const b = A.run("sim.hull.body"); b.setTransform(new planck.Vec2(x, y), angle || 0); b.setLinearVelocity(new planck.Vec2(vx, vy)); b.setAngularVelocity(0); };
/* put the rocket on the ground `m` metres from the pad, upright, and let the contact settle */
const onGround = (m) => { const t = m / R; bodyAt(rest.x * Math.cos(t) + rest.y * Math.sin(t), -rest.x * Math.sin(t) + rest.y * Math.cos(t), 0, 0, -t); A.step(2); };
const R = A.run("R"), SPACE = A.run("SPACE_ALT"), MU = A.run("MU");
const circular = Math.sqrt(MU / (R + 120000));
A.run("sim.airborne = true; sim.flown = true");
bodyAt(0, R + 5000, 0, 100);
check(A.fn("captureVessel")().status === "flying", "in the air low down: flying");
bodyAt(0, R + 120000, circular, 0);
check(A.fn("captureVessel")().status === "orbit", "above the air and going round fast enough to stay up: orbit");
bodyAt(0, R + 120000, 500, 0);
check(A.fn("captureVessel")().status === "flying", "above the air but about to fall back in: still flying (not an orbit)");
bodyAt(0, R + 120000, circular, 0);
A.run("controls.throttle = 0.5");
check(A.fn("captureVessel")().status === "flying", "in a good orbit but with the throttle on: flying (it is not stored as safe while it burns)");
A.run("controls.throttle = 0; sim.airborne = false");
onGround(0);
check(A.fn("captureVessel")().status === "pad", "back down on the ground beside where it started: it is on the pad again");
onGround(500);
check(A.fn("captureVessel")().status === "landed", "down on the ground 500 m from the pad: landed");
onGround(15);
check(A.fn("captureVessel")().status === "pad", "15 m from the pad counts as on it");
bodyAt(rest.x, rest.y + 1.5, 0, 0); A.step(1);
check(A.fn("captureVessel")().status === "flying", "hovering 1.5 m up, not touching: not a safe state, so flying");

/* ---- 2. restoring a two-stage rocket ---- */
console.log("\n2. Restoring a two-stage rocket");
A = loadGame(fakeStore());
A.open(TWO);
A.run("fireStage()"); A.run("controls.throttle = 1");
A.step(600);                                                   // 10 s of burn
A.run("fireStage()");                                          // the decoupler lets go; the upper engine lights
A.step(120);
A.run("controls.throttle = 0.6");
A.step(60);
const state = A.fn("captureVessel")();
const S = state.state;
check(state.status === "flying" && S.detached.slice().sort().join() === "dec,eng1,tank1", "after separation the lower stage (decoupler, tank1, eng1) is written down as gone");
check(S.activeEngines.join() === "eng1,eng2" || S.activeEngines.join() === "eng2", "the lit engines are written down: " + S.activeEngines.join());
check(S.stageNext === 2 && near(S.throttle, 0.6) && S.started === true && S.clock > 10, "stage number, throttle and the flight clock too");
const massA = A.fn("totalMass")(), fuelA = A.run("sim.fuel");
const B = loadGame(fakeStore());
B.open(TWO);
const res = B.fn("restoreVessel")(clone(S));
check(res.ok, "restoring works on a rocket that has just been built on the pad");
check(B.run("sim.parts.length") === 3 && B.run("sim.parts.map(p => p.def.id).sort().join()") === "eng2,nose,tank2", "only the three parts of the rocket you fly are left in the world");
check(B.run("sim.parts.every(p => !p.debris)") && B.run("sim.tanks.length") === 1 && B.run("sim.vessel.length") === 3, "nothing is marked as a dropped piece, one tank, three parts in the vessel");
check(B.run("sim.world.getBodyList().getNext()") === null || B.run("sim.world.getBodyList().getNext().getNext()") === null, "the world holds only the planet and the rocket: the bodies of the dropped parts are destroyed");
check(near(B.fn("totalMass")(), massA, 1e-6) && near(B.run("sim.fuel"), fuelA, 1e-6), "the rocket weighs the same and has the same fuel (" + massA.toFixed(1) + " kg, " + fuelA.toFixed(1) + " kg of it fuel)");
check(B.fn("stagesLeft")() === 0 && B.run("sim.stageNext") === 2, "the staging list is where it was: nothing left to fire");
check(B.run("sim.parts.find(p => p.def.id === 'eng2').active") === true && near(B.run("controls.throttle"), 0.6), "the upper engine is lit and the throttle is where it was");
check(B.run("sim.hull.def.id") === "tank2" && B.run("sim.wheelMax") > 0, "the hull and the reaction wheel (the nose cone's) are found again");
const pa = A.run("sim.hull.body.getPosition()"), pb = B.run("sim.hull.body.getPosition()");
check(near(pa.x, pb.x, 1e-9) && near(pa.y, pb.y, 1e-9) && near(A.run("sim.hull.body.getAngle()"), B.run("sim.hull.body.getAngle()"), 1e-12), "it is where it was, pointing the way it was");
const bad = loadGame(fakeStore()); bad.open(TWO);
const lost = bad.fn("restoreVessel")(Object.assign(clone(S), { detached: ["tank2", "eng2", "dec", "tank1", "eng1", "nose"] }));
check(!lost.ok && /gone/.test(lost.problem) && bad.run("sim.parts.length") === 6, "a state with every part gone is refused and leaves the rocket on the pad untouched");
const unk = loadGame(fakeStore()); unk.open(TWO);
check(unk.fn("restoreVessel")(Object.assign(clone(S), { fuel: { tank2: 1e12 } })).ok && unk.run("sim.tanks[0].fuel") === unk.run("sim.tanks[0].full"), "more fuel than the tank holds is cut down to what it holds");

/* ---- 3. the restored flight flies on the same ---- */
console.log("\n3. The restored flight flies on the same as the one it came from");
A.run("controls.throttle = 1"); B.run("controls.throttle = 1");
A.step(300); B.step(300);
const qa = A.run("sim.hull.body.getPosition()"), qb = B.run("sim.hull.body.getPosition()");
const va = A.run("sim.hull.body.getLinearVelocity()"), vb = B.run("sim.hull.body.getLinearVelocity()");
check(near(qa.x, qb.x, 1e-4) && near(qa.y, qb.y, 1e-4), "5 seconds on, the two rockets are in the same place (" + Math.hypot(qa.x - qb.x, qa.y - qb.y).toExponential(1) + " m apart, at " + (A.run("Math.hypot(sim.hull.body.getPosition().x, sim.hull.body.getPosition().y)") - R).toFixed(0) + " m up)");
check(near(va.x, vb.x, 1e-6) && near(va.y, vb.y, 1e-6) && near(A.run("sim.hull.body.getAngle()"), B.run("sim.hull.body.getAngle()"), 1e-8), "and moving the same way at the same speed, at the same angle");
check(near(A.run("sim.fuel"), B.run("sim.fuel"), 1e-6) && near(A.run("sim.t"), B.run("sim.t"), 1e-9), "with the same fuel left and the same flight clock");
A.step(2400); B.step(2400);
const ra = A.run("sim.hull.body.getPosition()"), rb = B.run("sim.hull.body.getPosition()");
check(near(ra.x, rb.x, 1e-2) && near(ra.y, rb.y, 1e-2) && near(A.run("sim.fuel"), B.run("sim.fuel"), 1e-3), "40 seconds later, still burning and 5 km up, they still agree to within a centimetre and a gram of fuel (" + Math.hypot(ra.x - rb.x, ra.y - rb.y).toExponential(1) + " m apart)");

/* the other way round: the lower tank is the first part, so when the stages part the rocket you fly ends up on a new body */
const LOWHULL = { version: 1, name: "low", parts: [
  { id: "tankA", type: "tank", width: 2, length: 4 },
  { id: "engA", type: "engine", thrust: 250000, parent: "tankA", anchor: "bottom", dx: 0 },
  { id: "dec", type: "decoupler", width: 2, parent: "tankA", anchor: "top", dx: 0 },
  { id: "tankB", type: "tank", width: 2, length: 2, parent: "dec", anchor: "top", dx: 0 },
  { id: "nose", type: "nose", width: 2, length: 1.5, parent: "tankB", anchor: "top", dx: 0 }
], stages: [["engA"], ["dec"]] };
const L1 = loadGame(fakeStore()); L1.open(LOWHULL);
L1.run("fireStage()"); L1.run("controls.throttle = 1"); L1.step(300); L1.run("fireStage()"); L1.run("controls.throttle = 0"); L1.step(120);
const lowState = L1.fn("captureVessel")();
check(lowState.state.detached.slice().sort().join() === "engA,tankA", "(lower tank first) the lower stage is written down as gone: " + lowState.state.detached.slice().sort().join());
const L2 = loadGame(fakeStore()); L2.open(LOWHULL);
check(L2.fn("restoreVessel")(clone(lowState.state)).ok && L2.run("sim.parts.map(p => p.def.id).sort().join()") === "dec,nose,tankB" && near(L2.fn("totalMass")(), L1.fn("totalMass")(), 1e-6), "(lower tank first) the upper stage is restored without the original hull part, with the same mass");
L1.step(400); L2.step(400);
const la = L1.run("sim.hull.body.getPosition()"), lb = L2.run("sim.hull.body.getPosition()");
check(near(la.x, lb.x, 1e-6) && near(la.y, lb.y, 1e-6) && near(L1.run("sim.hull.body.getAngle()"), L2.run("sim.hull.body.getAngle()"), 1e-8), "(lower tank first) and it falls the same way as the original does (" + Math.hypot(la.x - lb.x, la.y - lb.y).toExponential(1) + " m apart after 6.7 s)");

/* ---- 4. keeping the universe up to date ---- */
console.log("\n4. Keeping the universe up to date");
const store = fakeStore();
let G = loadGame(store);
let u = G.fn("universeNew")();
const added = G.fn("universeAddVessel")(u, TWO, "Two");
G.fn("universeSave")(added.universe);
let load = G.fn("flightLoadActive")();
check(load.id === "v1" && load.state === null && load.design.name === "two", "the flight page finds the vessel the builder put on the pad");
G.run("ROCKET = assemble(" + JSON.stringify(load.design) + ")"); G.run("buildWorld()"); G.fn("flightAttach")(load.id);
check(G.fn("persistFlight")(false).ok && G.fn("universeLoad")().universe.vessels[0].state === null, "an untouched rocket is saved as it is: on the pad, no state");
G.run("fireStage()"); G.run("controls.throttle = 1"); G.fn("flightTick")(0.5); G.step(300); G.fn("flightTick")(2);     // 5 s: well off the pad
check(G.fn("persistFlight")(false).ok, "saving a rocket that has started to fly works");
let U = G.fn("universeLoad")().universe, v = U.vessels[0];
check(v.status === "flying" && v.state && v.state.pos.y > R && v.state.activeEngines.join() === "eng1", "the universe now holds it flying, with its place and its lit engine");
check(near(U.clock, 2.5), "and the universe clock moved on by the physics time that passed (2.5 s)");
const before = store.data["rocketsim.universe"];
check(G.fn("persistFlight")(false).ok && store.data["rocketsim.universe"] === before, "saving again with nothing changed writes nothing");
G.run("flightNextSave = 0"); G.fn("flightAutosave")(1000); const afterFirst = store.data["rocketsim.universe"];
G.step(60); G.fn("flightAutosave")(2000);
check(store.data["rocketsim.universe"] === afterFirst, "the automatic save waits its 5 seconds between writes");
G.fn("flightAutosave")(6500);
check(store.data["rocketsim.universe"] !== afterFirst, "and writes again once they are up");

/* a new page load (the player went to the builder and came back) */
const H = loadGame(store);
load = H.fn("flightLoadActive")();
H.run("ROCKET = assemble(" + JSON.stringify(load.design) + ")"); H.run("buildWorld()"); H.fn("flightAttach")(load.id);
const back = H.fn("restoreVessel")(load.state);
check(back.ok && H.fn("captureVessel")().state.activeEngines.join() === "eng1", "reloading the page puts the saved rocket back, engine still lit");
const hp = H.run("sim.hull.body.getPosition()");
const savedPos = H.fn("universeLoad")().universe.vessels[0].state.pos;
check(near(hp.x, savedPos.x, 1e-9) && near(hp.y, savedPos.y, 1e-9), "it is exactly where the last save said");

/* free test flights */
const store2 = fakeStore(), T = loadGame(store2);
T.open(TWO);
check(!T.fn("persistFlight")(true).ok && !T.fn("flightTracked")() && Object.keys(store2.data).length === 0, "a test flight (no vessel from the universe) never writes to the universe");
check(T.fn("flightRetrack")(TWO).ok && Object.keys(store2.data).length === 0, "and 'Launch again' on it does not put it into the universe either");

/* recovery */
G = H;
G.run("sim.flown = true; sim.airborne = false");
const rec = G.fn("flightRecovered")();
U = G.fn("universeLoad")().universe;
check(rec.ok && U.vessels.length === 0 && U.activeId === null && G.fn("padIsClear")(U) && !G.fn("flightTracked")(), "recovering takes the vessel out of the universe and leaves the pad clear");
const again = G.fn("flightRetrack")(TWO);
U = G.fn("universeLoad")().universe;
check(again.ok && U.vessels.length === 1 && U.vessels[0].id === "v2" && U.vessels[0].status === "pad" && G.fn("flightTracked")(), "'Launch again' after a recovery puts the design back on the pad as a new vessel (v2)");
check(G.fn("flightRetrack")(TWO).ok && G.fn("universeLoad")().universe.vessels.length === 1, "asking twice does not add it twice");

/* ---- 5. opening the flight page ---- */
console.log("\n5. Opening the flight page");
const e1 = loadGame(fakeStore()).fn("flightLoadActive")();
check(e1.id === null && e1.notes.length === 0, "with nothing saved the page flies the free test rocket, with nothing to report");
const s3 = fakeStore(), g3 = loadGame(s3);
let uu = g3.fn("universeAddVessel")(g3.fn("universeNew")(), TWO, "Two").universe; uu = g3.fn("universeSetActive")(uu, null).universe;
g3.fn("universeSave")(uu);
check(g3.fn("flightLoadActive")().id === null, "a universe with no active vessel also gives the test rocket");
const s4 = fakeStore(), g4 = loadGame(s4);
s4.data["rocketsim.universe"] = "garbage";
const e4 = g4.fn("flightLoadActive")();
check(e4.id === null && e4.notes.length === 1 && /could not be read/.test(e4.notes[0]) && s4.data["rocketsim.universe"] === "garbage", "an unreadable save is reported, the test rocket is flown, and the save is not touched");
const s5 = fakeStore(), g5 = loadGame(s5);
let u5 = g5.fn("universeAddVessel")(g5.fn("universeNew")(), TWO, "Two").universe;
u5.vessels[0].design.parts[0].width = 3;                         // a width that is not allowed any more
g5.fn("universeSave")(u5);
const e5 = g5.fn("flightLoadActive")();
check(e5.id === null && e5.notes.length === 1 && /Two cannot be loaded/.test(e5.notes[0]) && g5.fn("universeLoad")().universe.vessels.length === 1, "a vessel whose design no longer passes the rules is reported by name and kept in the universe");
const s6 = fakeStore(), g6 = loadGame(s6);
g6.fn("universeSave")(g6.fn("universeAddVessel")(g6.fn("universeNew")(), TWO, "Two").universe);
s6.data["rocketsim.universe"] = s6.data["rocketsim.universe"].slice(0, 60);      // cut short, and there is no older save to fall back on
const e6 = g6.fn("flightLoadActive")();
check(e6.id === null && e6.notes.length === 1 && /could not be read/.test(e6.notes[0]), "a damaged save with no backup is reported, not mistaken for a good one");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
