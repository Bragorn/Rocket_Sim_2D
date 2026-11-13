/* =====================================================================
   STAGING TESTS  (tests/staging-tests.js)
   Runs the real game files without a browser. planck is replaced by a tiny
   stand-in: bodies stay where they are, but it remembers pushes (impulses)
   and joints that were let go, so the staging can be checked.
   Needs Node.js. From the project folder:   node tests/staging-tests.js

   1. The decoupler part and the rules for it.
   2. Designs: what may join under an engine, the staging list.
   3. Moving things in the staging list (restage), and the numbers per stage.
   4. In the game: engines stay cold until their stage fires, fuel stays in
      its own stage, a decoupler lets go and pushes, the rocket you fly switches.
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");

function Vec2(x, y) { this.x = x; this.y = y; }
function Polygon(verts) { this.verts = verts; }
function Circle(r) { this.r = r; }
function area(v) { let a = 0; for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }
class Fixture { constructor(def) { this.shape = def.shape; this.density = def.density || 0; } setDensity(d) { this.density = d; } }
class Body {
  constructor(def) { this.type = def.type; this.pos = def.position; this.fix = null; this.next = null; this.vel = new Vec2(0, 0); }
  createFixture(def) { this.fix = new Fixture(def); return this.fix; }
  getFixtureList() { return this.fix; }
  getMass() { return this.type === "dynamic" && this.fix ? this.fix.density * area(this.fix.shape.verts) : 0; }
  resetMassData() {}
  isDynamic() { return this.type === "dynamic"; }
  getNext() { return this.next; }
  getPosition() { return this.pos; }
  getAngle() { return 0; }
  getWorldCenter() { return this.pos; }
  getWorldPoint(l) { return new Vec2(this.pos.x + l.x, this.pos.y + l.y); }
  getLinearVelocity() { return this.vel; }
  getLinearVelocityFromWorldPoint() { return this.vel; }
  getAngularVelocity() { return 0; }
  applyForce() {} applyForceToCenter() {} applyTorque() {}
  applyLinearImpulse(J) { const m = this.getMass(); this.vel = new Vec2(this.vel.x + J.x / m, this.vel.y + J.y / m); }
}
class World {
  constructor() { this.first = null; this.last = null; this.destroyed = 0; }
  createBody(def) { const b = new Body(def); if (this.last) this.last.next = b; else this.first = b; this.last = b; return b; }
  getBodyList() { return this.first; }
  createJoint(j) { return j; }
  destroyJoint() { this.destroyed++; }
  on() {} step() {}
}
const planck = { Settings: {}, Vec2, Polygon, Circle, World, WeldJoint: function () { this.getReactionForce = () => new Vec2(0, 0); } };
const ctx = { console, Math, Object, Array, Number, JSON, encodeURIComponent, decodeURIComponent, document: { body: {} }, window: { addEventListener() {} }, planck };
vm.createContext(ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "controls", "aero", "telemetry", "world", "sim", "orbit", "stats", "edit"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const logs = [];
ctx.log = function (s) { logs.push(s); };
const run = (e) => vm.runInContext(e, ctx);
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);
const clone = (o) => JSON.parse(JSON.stringify(o));
const bad = (d) => run("validateDesign")(d);
const G0 = run("G0"), RULES = run("RULES");

/* a two-stage rocket built from the top down: upper tank with its engine and a nose, a decoupler under that engine, then the lower stage */
const TWO = { version: 1, name: "two", parts: [
  { id: "tank2", type: "tank", width: 2, length: 2 },
  { id: "eng2", type: "engine", thrust: 100000, parent: "tank2", anchor: "bottom", dx: 0 },
  { id: "dec", type: "decoupler", width: 2, parent: "eng2", anchor: "bottom", dx: 0 },
  { id: "tank1", type: "tank", width: 2, length: 4, parent: "dec", anchor: "bottom", dx: 0 },
  { id: "eng1", type: "engine", thrust: 250000, parent: "tank1", anchor: "bottom", dx: 0 },
  { id: "nose", type: "nose", width: 2, length: 1.5, parent: "tank2", anchor: "top", dx: 0 }
], stages: [["eng1"], ["dec", "eng2"]] };

/* the other way round: the lower tank is the first part, the decoupler sits on top of it */
const LOWHULL = { version: 1, name: "low", parts: [
  { id: "tankA", type: "tank", width: 2, length: 4 },
  { id: "engA", type: "engine", thrust: 250000, parent: "tankA", anchor: "bottom", dx: 0 },
  { id: "dec", type: "decoupler", width: 2, parent: "tankA", anchor: "top", dx: 0 },
  { id: "tankB", type: "tank", width: 2, length: 2, parent: "dec", anchor: "top", dx: 0 },
  { id: "nose", type: "nose", width: 2, length: 1.5, parent: "tankB", anchor: "top", dx: 0 }
], stages: [["engA"], ["dec"]] };

/* ---- 1. the part ---- */
console.log("\n1. The decoupler part");
const dec = run("decoupler")(2);
check(near(dec.mass, Math.PI * RULES.decouplerPerM2, 1e-6) && dec.faceTop === 2 && dec.faceBottom === 2 && near(dec.length, 0.2), `a 2 m decoupler is a 0.2 m ring of ${dec.mass.toFixed(0)} kg that fits a 2 m face`);
check(near(dec.kick, Math.PI * RULES.decouplerKick, 1e-6), `its separation charge is ${(dec.kick / 1000).toFixed(1)} kN*s, from the rules`);
check(run("checkRules")(run("assemble")(TWO).parts).length === 0, "an assembled two-stage rocket follows every rule");
const light = Object.assign(run("decoupler")(2), { mass: 10 });
check(run("checkRules")([light]).some(m => /decoupler is lighter/.test(m)), "the rules catch a decoupler that is too light");

/* ---- 2. designs ---- */
console.log("\n2. Designs and the staging list");
check(bad(run("DESIGN")).length === 0, "the starting rocket is still valid, with its staging list");
check(bad(TWO).length === 0, "the two-stage rocket is valid" + (bad(TWO).length ? ": " + bad(TWO).join("; ") : ""));
check(bad(LOWHULL).length === 0, "so is the one with the decoupler on top of the lower tank" + (bad(LOWHULL).length ? ": " + bad(LOWHULL).join("; ") : ""));
const tankUnder = clone(TWO); tankUnder.parts[2] = { id: "tx", type: "tank", width: 2, length: 2, parent: "eng2", anchor: "bottom", dx: 0 }; tankUnder.parts.splice(3, 2); tankUnder.stages = [["eng2"]];
check(bad(tankUnder).some(m => /only a decoupler/.test(m)), "a tank straight under an engine: refused (only a decoupler can go there)");
const narrow = { version: 1, name: "n", parts: [
  { id: "t", type: "tank", width: 2, length: 4 }, { id: "e", type: "engine", thrust: 1500000, parent: "t", anchor: "bottom", dx: 0 },
  { id: "d", type: "decoupler", width: 1, parent: "e", anchor: "bottom", dx: 0 }] };
check(bad(narrow).some(m => /narrower/.test(m)), "a 1 m decoupler under a 1.6 m engine: refused (it has to go round the nozzle)");
check(JSON.stringify(run("stagesOf")(TWO)) === '[["eng1"],["dec","eng2"]]', "a design keeps the staging list it was given");
const noList = clone(TWO); delete noList.stages;
check(JSON.stringify(run("stagesOf")(noList)) === '[["eng2","eng1"],["dec"]]', "an older design with no list: all engines first, then each decoupler on its own");
const forgot = clone(TWO); forgot.stages = [["eng1"], ["dec"]];
check(JSON.stringify(run("stagesOf")(forgot)) === '[["eng1"],["dec"],["eng2"]]', "a part the list forgot gets a row of its own at the end");
const messy = clone(TWO); messy.stages = [["eng1", "eng1", "ghost"], []];
check(JSON.stringify(run("stagesOf")(messy)) === '[["eng1"],["eng2"],["dec"]]', "doubles, unknown ids and empty rows are cleaned out");
const tankStaged = clone(TWO); tankStaged.stages = [["tank1"], ["eng1"]];
check(bad(tankStaged).some(m => /not an engine or a decoupler/.test(m)), "a staging list that names a tank: refused");
check(run("assemble")(TWO).labels.dec.verb === "Decouple" && run("assemble")(TWO).labels.eng2.label === "Engine 100 kN", "the assembled rocket carries the labels the flight bar shows");
const noFirst = clone(TWO); noFirst.stages = [["dec"], ["eng1", "eng2"]];
check(run("designWarnings")(noFirst).some(m => /stage 1 does not activate an engine/.test(m)) && !run("designWarnings")(TWO).some(m => /stage 1/.test(m)), "a first stage with no engine in it is warned about");

/* ---- 3. moving things, and the numbers ---- */
console.log("\n3. Moving things in the list, and the numbers per stage");
const rs = (id, t) => JSON.stringify(run("restage")(TWO, id, t).stages);
check(rs("eng2", { kind: "gap", index: 2 }) === '[["eng1"],["dec"],["eng2"]]', "dragging the upper engine into the gap at the end gives it a row of its own");
check(rs("dec", { kind: "row", index: 0 }) === '[["eng1","dec"],["eng2"]]', "dragging the decoupler onto row 1 fires it together with the first engine");
check(rs("eng2", { kind: "gap", index: 0 }) === '[["eng2"],["eng1"],["dec"]]', "dragging into the first gap makes a new first row");
check(rs("eng1", { kind: "row", index: 1 }) === '[["dec","eng2","eng1"]]', "a row that is left empty vanishes");
const st = run("designStats")(TWO), a = run("assemble")(TWO, { keepFrame: true }).parts;
const mass = (id) => a.find(p => p.id === id).mass, fuelOf = (id) => a.find(p => p.id === id).fuel.full, ve = RULES.ispVac * G0;
check(st.stages.length === 2 && st.stages[0].dv > 0 && st.stages[1].dv > 0, `two rows, each with a burn (${Math.round(st.stages[0].dv)} and ${Math.round(st.stages[1].dv)} m/s)`);
check(near(st.stages[0].dv, ve * Math.log(st.wet / (st.wet - fuelOf("tank1"))), 0.5), "stage 1 is the rocket equation for the lower tank, carrying everything");
const m0b = mass("tank2") + mass("eng2") + mass("nose");
check(near(st.stages[1].dv, ve * Math.log(m0b / (m0b - fuelOf("tank2"))), 0.5) && near(st.stages[1].mass, m0b, 1e-6), "stage 2 is the upper tank alone: the lower stage is gone from the mass");
check(near(st.dvVac, st.stages[0].dv + st.stages[1].dv, 1e-6), "the delta-v total is the sum of the stages");
const one = run("designStats")(run("DESIGN"));
check(one.dvVac > 6000 && one.dvVac < 7500 && one.stages.length === 1, `the starting rocket is one stage and still ${Math.round(one.dvVac)} m/s`);

/* ---- 4. in the game ---- */
console.log("\n4. In the game");
function load(design) { ctx.__d = design; run("ROCKET = assemble(__d)"); run("buildWorld")(); }
const stepSim = () => run("stepSim")();
function burn(sec, thr) { run("controls").throttle = thr; const n = Math.round(sec / run("DT")); for (let i = 0; i < n; i++) stepSim(); run("controls").throttle = 0; }
const tk = (id) => run("sim").tanks.find(t => t.part.def.id === id);
const part = (id) => run("sim").parts.find(p => p.def.id === id);

load(TWO);
let s = run("sim");
check(JSON.stringify(s.stages) === '[["eng1"],["dec","eng2"]]' && s.stageNext === 0 && s.vessel.length === s.parts.length, "the staging list comes into the game, nothing fired, everything is one rocket");
burn(1, 1);
check(s.thrust === 0 && tk("tank1").fuel === tk("tank1").full && tk("tank2").fuel === tk("tank2").full, "full throttle with no stage fired: every engine stays cold, no fuel is used");
check(run("fireStage")() === true && s.stageNext === 1 && logs.some(m => /Stage 1: activated Engine 250 kN/.test(m)), "Space fires stage 1 and says what it did");
burn(2, 1);
check(s.thrust > 0 && tk("tank1").fuel < tk("tank1").full, "the lower engine burns the lower tank");
check(tk("tank2").fuel === tk("tank2").full, "the upper tank is untouched: fuel does not cross a decoupler");
burn(200, 1);
check(tk("tank1").fuel === 0 && s.thrust === 0 && logs.some(m => /out of fuel/.test(m)), "the lower engine goes out when its own tank is empty");
check(tk("tank2").fuel === tk("tank2").full, "while the upper tank is still full");
const jointsBefore = s.joints.length;
check(run("fireStage")() === true, "Space fires stage 2");
check(s.world.destroyed === 1 && s.joints.length === jointsBefore - 1, "one weld was let go");
const ids = (list) => list.map(p => p.def.id).sort().join();
check(ids(s.vessel) === "eng2,nose,tank2" && ids(s.parts.filter(p => p.debris)) === "dec,eng1,tank1", "the rocket you fly is the upper stage; the lower stage and the ring are dropped pieces");
check(s.hull.def.id === "tank2", "steering and the camera stay on the upper tank");
const up = s.vessel, down = s.parts.filter(p => p.debris), M = (l) => l.reduce((m, p) => m + p.body.getMass(), 0);
const vU = up[0].body.getLinearVelocity().y, vD = down[0].body.getLinearVelocity().y, J = run("decouplerSpec")(2).kick;
check(vU > 0 && vD < 0 && near(vU - vD, J * (1 / M(up) + 1 / M(down)), 1e-6), `the charge pushes them apart at ${(vU - vD).toFixed(2)} m/s`);
check(near(M(up) * vU + M(down) * vD, 0, 1e-6) && up.every(p => near(p.body.getLinearVelocity().y, vU, 1e-9)) && down.every(p => near(p.body.getLinearVelocity().y, vD, 1e-9)), "momentum is conserved and each piece moves as one (no part is jerked against its neighbours)");
check(near(run("totalMass")(), M(up), 1e-6) && near(s.fuelFull, tk("tank2").full, 1e-6) && near(s.fuel, tk("tank2").fuel, 1e-6), "mass and fuel readouts are now the upper stage only");
burn(2, 1);
check(s.thrust > 0 && tk("tank2").fuel < tk("tank2").full, "the upper engine was activated in the same row and burns the upper tank");
check(part("eng1").forces[0].now === 0, "the dropped engine does not burn");
check(near(run("maxThrust")(), 100000 * (1 - (1 - 280 / 310) * s.rho / 1.225), 5), "the thrust readout counts only the engines that are on, on the rocket you fly");
check(run("fireStage")() === false && logs.some(m => /Stage 2: decoupled Decoupler 2 m, activated Engine 100 kN/.test(m)), "no stages left: Space does nothing; stage 2 was logged");

load(LOWHULL);
s = run("sim");
run("fireStage")(); run("fireStage")();
check(ids(s.vessel) === "dec,nose,tankB" && s.hull.def.id === "tankB" && s.rootHull.def.id === "tankA", "when the first tank is dropped, the hull switches to a tank on the rocket you fly");
check(near(s.hullWidth, 2, 1e-9), "and its width is used for the stability reading");

load(run("DESIGN"));
s = run("sim");
check(run("fireStage")() === true && part("engine").active === true && run("fireStage")() === false, "the starting rocket has one stage: Space activates its engine, a second press does nothing");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
