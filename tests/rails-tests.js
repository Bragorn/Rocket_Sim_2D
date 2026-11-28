/* =====================================================================
   RAILS TESTS  (tests/rails-tests.js)
   A vessel left in orbit is moved along its orbit by calculation (js/rails.js) instead of being simulated. These tests check the
   calculation against itself (laps, energy), against the real physics engine (the same orbit flown for real), and the whole
   round trip: leave a vessel in orbit, fly another for a while, come back and find the first where it should be.
   Needs Node.js. From the project folder:   node tests/rails-tests.js
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
  for (const f of ["util", "settings", "rules", "parts", "design", "universe", "controls", "aero", "telemetry", "world", "sim", "orbit", "rails", "vessellist", "flightstate"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  ctx.log = () => {};
  const g = { ctx, run: (e) => vm.runInContext(e, ctx) };
  g.fn = (n) => g.run(n);
  g.step = (n) => { const s = g.fn("stepSim"); for (let i = 0; i < n; i++) s(); };
  return g;
}
const G0 = loadGame(fakeStore());
const R = G0.run("R"), MU = G0.run("MU");
const at = (p, v, dt) => G0.fn("railsStateAt")({ pos: p, vel: v, angle: 0, angVel: 0, fuel: {}, stageNext: 0 }, dt);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const energy = (p, v) => (v.x * v.x + v.y * v.y) / 2 - MU / Math.hypot(p.x, p.y), momentum = (p, v) => p.x * v.y - p.y * v.x;

console.log("\n1. The calculation");
const r0 = R + 120000, vc = Math.sqrt(MU / r0), T = 2 * Math.PI * Math.sqrt(r0 * r0 * r0 / MU);
let s = at({ x: 0, y: r0 }, { x: vc, y: 0 }, T);
check(dist(s.pos, { x: 0, y: r0 }) < 1e-3 && dist(s.vel, { x: vc, y: 0 }) < 1e-6, "a circular orbit: after one lap it is back where it started (within a millimetre)");
s = at({ x: 0, y: r0 }, { x: vc, y: 0 }, T / 2);
check(dist(s.pos, { x: 0, y: -r0 }) < 1e-3, "after half a lap it is on the opposite side");
s = at({ x: 0, y: r0 }, { x: vc, y: 0 }, T / 4);
check(dist(s.pos, { x: r0, y: 0 }) < 1e-3 && dist(s.vel, { x: 0, y: -vc }) < 1e-6, "after a quarter lap it has gone clockwise round to the right, moving down (it started moving right at the top)");
s = at({ x: 0, y: r0 }, { x: -vc, y: 0 }, T / 4);
check(dist(s.pos, { x: -r0, y: 0 }) < 1e-3, "the other way round (anticlockwise): a quarter lap takes it to the left");
const ell = { p: { x: 0, y: r0 }, v: { x: vc * 1.12, y: 0 } };                    // starts at its lowest point
const el = G0.fn("railsElements")(ell.p, ell.v);
check(el && Math.abs(el.a * (1 - el.e) - r0) < 1e-6 && Math.abs(el.period - 2 * Math.PI / el.n) < 1e-9, "an ellipse starting at its lowest point: the lowest point is where it started, and the lap time agrees with n");
s = at(ell.p, ell.v, el.period / 2);
check(Math.abs(Math.hypot(s.pos.x, s.pos.y) - el.a * (1 + el.e)) < 1e-3 && s.pos.y < 0, "half a lap later it is at the highest point, on the far side");
s = at(ell.p, ell.v, el.period * 7 + 123.4);
const s2 = at(ell.p, ell.v, 123.4);
check(dist(s.pos, s2.pos) < 1e-2, "seven laps and 123 seconds is the same place as 123 seconds (a long time away costs nothing and loses nothing)");
let worst = 0, worstL = 0;
for (let k = 1; k <= 40; k++) {
  const q = at({ x: 3e5, y: 6.4e5 }, { x: -4800, y: 2100 }, k * 977.7);
  worst = Math.max(worst, Math.abs(energy(q.pos, q.vel) - energy({ x: 3e5, y: 6.4e5 }, { x: -4800, y: 2100 })));
  worstL = Math.max(worstL, Math.abs(momentum(q.pos, q.vel) - momentum({ x: 3e5, y: 6.4e5 }, { x: -4800, y: 2100 })));
}
check(worst < 1e-3 && worstL < 1, "an ellipse that starts neither high nor low: energy and spin are the same at 40 different times (energy off by " + worst.toExponential(1) + " J/kg)");
const hyper = at({ x: 0, y: r0 }, { x: vc * 1.6, y: 0 }, 1000);
check(hyper.pos.x === 0 && hyper.pos.y === r0, "an orbit that leaves the planet cannot be put on rails: it is returned as it is");
check(at({ x: 0, y: r0 }, { x: vc, y: 0 }, 0).pos.y === r0 && at({ x: 0, y: r0 }, { x: vc, y: 0 }, -5).pos.y === r0, "no time, or time going backwards: nothing moves");
const pts = G0.fn("railsOrbitPoints")({ pos: ell.p, vel: ell.v }, 100);
check(pts.length === 101 && dist(pts[0], pts[100]) < 1e-6 && pts.every((q) => Math.abs(energy(q, { x: 0, y: 0 }) + MU / Math.hypot(q.x, q.y)) < 1e-9) && Math.min(...pts.map((q) => Math.hypot(q.x, q.y))) > r0 - 1, "the orbit drawn as points: a closed loop that never dips below the lowest point");

console.log("\n2. Against the real physics");
function physicsRun(p, v, seconds) {
  const g = loadGame(fakeStore());
  g.run("ROCKET = assemble(DESIGN)"); g.run("buildWorld()");
  g.run("sim.airborne = true; sim.flown = true");
  const b = g.run("sim.hull.body");
  b.setTransform(new planck.Vec2(p.x, p.y), 0); b.setLinearVelocity(new planck.Vec2(v.x, v.y)); b.setAngularVelocity(0);
  g.step(Math.round(seconds * 60));
  const q = g.run("sim.hull.body.getPosition()"), w = g.run("sim.hull.body.getLinearVelocity()");
  return { pos: { x: q.x, y: q.y }, vel: { x: w.x, y: w.y } };
}
for (const c of [{ name: "circular, 120 km", p: { x: 0, y: r0 }, v: { x: vc, y: 0 }, t: 600 }, { name: "elliptical (lowest point 120 km)", p: { x: 0, y: r0 }, v: { x: vc * 1.1, y: 0 }, t: 600 }, { name: "going the other way, from the side", p: { x: R + 150000, y: 0 }, v: { x: 0, y: -Math.sqrt(MU / (R + 150000)) * 1.05 }, t: 600 }]) {
  const real = physicsRun(c.p, c.v, c.t), calc = at(c.p, c.v, c.t);
  const err = dist(real.pos, calc.pos), verr = dist(real.vel, calc.vel);
  // the calculation is exact; what is left is the physics engine's own stepping error (it moves in 1/60 s steps): about 0.08 m a second along the orbit
  check(err < 100 && verr < 0.2, c.name + ": after " + c.t + " s the calculation and the real physics are " + err.toFixed(1) + " m and " + verr.toFixed(3) + " m/s apart (the physics' own stepping error)");
}

console.log("\n3. Where each vessel is at a given time");
const state = (p, v) => ({ pos: p, vel: v, angle: 0, angVel: 0, fuel: {}, stageNext: 0 });
const orbiting = { status: "orbit", state: state({ x: 0, y: r0 }, { x: vc, y: 0 }), epoch: 100 };
let w = G0.fn("vesselStateAt")(orbiting, 100 + T / 4);
check(dist(w.pos, { x: r0, y: 0 }) < 1e-3 && w.vel, "a vessel in orbit, a quarter lap after it was saved, is a quarter of the way round");
w = G0.fn("vesselStateAt")(orbiting, 100);
check(w.pos.y === r0, "at the moment it was saved it is where it was saved");
w = G0.fn("vesselStateAt")({ status: "orbit", state: orbiting.state }, 5000);
check(w.pos.y === r0, "a vessel with no epoch (an older save) is taken to be where it was left");
w = G0.fn("vesselStateAt")({ status: "landed", state: state({ x: 5, y: R + 7 }, { x: 0, y: 0 }), epoch: 0 }, 99999);
check(w.pos.x === 5 && w.pos.y === R + 7 && w.vel === null, "a landed vessel stays put however long it has been");
w = G0.fn("vesselStateAt")({ status: "pad", state: null }, 1000);
check(w.pos.x === 0 && w.pos.y === R, "an untouched vessel on the pad is at the pad");

console.log("\n4. The whole round trip");
const store = fakeStore();
{
  // a vessel left in orbit at universe time 0 ...
  const g = loadGame(store);
  const a = g.fn("universeAddVessel")(g.fn("universeNew")(), g.run("DESIGN"), "Parked");
  g.fn("universeSave")(g.fn("universeUpdateVessel")(a.universe, a.id, { status: "orbit", revert: false, epoch: 0, state: state({ x: 0, y: r0 }, { x: vc, y: 0 }) }).universe);
  // ... and another rocket is launched and flown for a while
  const b = g.fn("universeAddVessel")(g.fn("universeLoad")().universe, g.run("DESIGN"), "Second");
  g.fn("universeSave")(b.universe);
}
const F = loadGame(store);
let o = F.fn("flightLoadActive")();
F.run("ROCKET = assemble(DESIGN)"); F.run("buildWorld()"); F.fn("flightAttach")(o.id, o.status);
F.run("fireStage()"); F.run("controls.throttle = 1"); F.step(600); F.fn("flightTick")(10);
F.run("controls.throttle = 0");
check(Math.abs(F.fn("flightUniverseClock")() - 10) < 1e-9, "flying for 10 s moves the universe clock on by 10 s");
F.fn("persistFlight")(true);
let uu = F.fn("universeLoad")().universe;
check(Math.abs(uu.clock - 10) < 1e-9 && Math.abs(uu.vessels[1].epoch - 10) < 1e-9 && uu.vessels[0].epoch === 0, "saving writes the clock, and stamps the flown vessel with it; the parked one keeps its own time (0)");
const map = F.fn("flightMapVessels")();
const quarter = at({ x: 0, y: r0 }, { x: vc, y: 0 }, 10);
check(map.vessels.length === 1 && map.vessels[0].name === "Parked" && dist(map.vessels[0].pos, quarter.pos) < 1e-3 && map.vessels[0].orbit.length === 181 && /In orbit, 120 km by 120 km/.test(map.vessels[0].where), "the map data lists the other vessel where it is now (10 s round its orbit), with its orbit and a description; the one being flown is left out");
F.step(60); F.fn("flightTick")(1);
check(Math.abs(F.fn("flightMapVessels")().clock - 11) < 1e-9 && dist(F.fn("flightMapVessels")().vessels[0].pos, at({ x: 0, y: r0 }, { x: vc, y: 0 }, 11).pos) < 1e-3, "and the other vessel keeps moving as the flight goes on, before anything is saved");
// the flown rocket is left safe on the ground? it is still near the pad, so go back to the parked one by making it active
uu = F.fn("universeLoad")().universe;
const back = F.fn("universeSetActive")(uu, "v1").universe;
F.fn("universeSave")(F.fn("universeAdvance")(back, 20));          // 20 more seconds pass (as if another flight had run)
const H = loadGame(store);
o = H.fn("flightLoadActive")();
check(o.id === "v1" && o.status === "orbit" && dist(o.state.pos, at({ x: 0, y: r0 }, { x: vc, y: 0 }, 30).pos) < 1e-3, "opening the parked vessel 30 s after it was left puts it 30 s round its orbit (not where it was left)");
H.run("ROCKET = assemble(DESIGN)"); H.run("buildWorld()"); H.fn("flightAttach")(o.id, o.status);
check(H.fn("restoreVessel")(o.state).ok && Math.abs(H.fn("flightUniverseClock")() - 30) < 1e-9, "it is restored there, and the clock the flight carries on from is the universe's (30 s)");
const real = H.run("sim.hull.body.getPosition()");
check(dist(real, at({ x: 0, y: r0 }, { x: vc, y: 0 }, 30).pos) < 1e-6, "in the physics world it is exactly there");
H.step(600);
const later = H.run("sim.hull.body.getPosition()");
check(dist(later, at({ x: 0, y: r0 }, { x: vc, y: 0 }, 40).pos) < 1, "and 10 s of real physics later it is within a metre of where the calculation says it should be");
H.fn("flightLeave")();
check(H.fn("universeLoad")().universe.vessels.find((v) => v.id === "v1").epoch > 0, "leaving it again stamps a new epoch");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
