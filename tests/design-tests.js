/* =====================================================================
   DESIGN TESTS  (tests/design-tests.js)
   Runs the real game files without a browser. planck is replaced by a
   tiny stand-in that does no physics, so this checks the design code, the
   checking, the saving and the fuel/engine bookkeeping, not how it flies.
   Needs Node.js. From the project folder:   node tests/design-tests.js
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");

/* ---- a stand-in for planck: bodies that stay where they are ---- */
function Vec2(x, y) { this.x = x; this.y = y; }
function Polygon(verts) { this.verts = verts; }
function Circle(r) { this.r = r; }
function area(v) { let a = 0; for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }
class Fixture { constructor(def) { this.shape = def.shape; this.density = def.density || 0; } setDensity(d) { this.density = d; } }
class Body {
  constructor(def) { this.type = def.type; this.pos = def.position; this.fix = null; this.next = null; this.forceSum = 0; this.torque = 0; }
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
  getLinearVelocity() { return new Vec2(0, 0); }
  getLinearVelocityFromWorldPoint() { return new Vec2(0, 0); }
  getAngularVelocity() { return 0; }
  applyForce(f) { this.forceSum += Math.hypot(f.x, f.y); }
  applyForceToCenter() {}
  applyTorque(t) { this.torque += t; }
}
class World { constructor() { this.first = null; this.last = null; }
  createBody(def) { const b = new Body(def); if (this.last) this.last.next = b; else this.first = b; this.last = b; return b; }
  getBodyList() { return this.first; }
  createJoint(j) { return j; } on() {} step() {} }
const planck = { Settings: {}, Vec2, Polygon, Circle, World, WeldJoint: function () { this.getReactionForce = () => new Vec2(0, 0); } };
const ctx = { console, Math, Object, Array, Number, JSON, encodeURIComponent, decodeURIComponent, document: { body: {} }, window: { addEventListener() {} }, planck };
vm.createContext(ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "controls", "aero", "telemetry", "world", "sim", "orbit"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const run = (e) => vm.runInContext(e, ctx);
ctx.log = () => {};
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);
const clone = (o) => JSON.parse(JSON.stringify(o));
const DESIGN = run("DESIGN"), G0 = run("G0");
const bad = (d) => run("validateDesign")(d);
const withParts = (...parts) => ({ version: 1, name: "t", parts: parts });
const tank = (id, w, l, extra) => Object.assign({ id, type: "tank", width: w, length: l }, extra);
const eng = (id, parent, dx, thrust) => ({ id, type: "engine", thrust: thrust || 250000, parent, anchor: "bottom", dx: dx || 0 });

/* ---- 1. the starting design ---- */
console.log("\n1. The starting design");
const R0 = run("ROCKET"), by = (id) => R0.parts.find(p => p.id === id);
check(bad(DESIGN).length === 0, "the starting design is valid");
check(R0.parts.map(p => p.id).join() === "tank,engine,nose,legL,legR,finL,finR", "it assembles into tank, engine, nose, two legs, two fins");
let low = Infinity; for (const p of R0.parts) for (const v of p.verts) low = Math.min(low, p.at[1] + v[1]);
check(near(low, 0), "the lowest point of the rocket (the feet) is at height 0");
check(R0.hull.id === "tank", "the hull is the tank");
check(near(by("engine").joint.at[1], by("tank").at[1] - 2) && near(by("nose").joint.at[1], by("tank").at[1] + 2), "engine and nose are welded at the tank's bottom and top faces");
const engLen = run("engine(250e3)").length;
check(near(by("tank").at[1] - by("engine").at[1], 2 + engLen / 2) && near(by("nose").at[1] - by("tank").at[1], 2.75), `the parts stack up: engine ${engLen.toFixed(2)} m long, tank 4 m, nose 1.5 m`);
check(near(run("engine(250e3)").width, 0.645, 0.001) && near(run("engine(1500e3)").width, 1.58, 0.01), "engine widths follow the thrust: 250 kN is 0.65 m wide, 1.5 MN is 1.6 m");
check(near(by("legL").at[0], -1) && near(by("legR").at[0], 1) && near(by("legL").at[1], by("tank").at[1] - 2 + 0.4), "legs hang on the tank wall, 0.4 m above its bottom, one each side");
check(near(by("finR").at[0], 1.7) && near(by("finL").at[0], -1.7), "fins sit out from the tank wall, mirrored");
check(by("finL").joint.to === "tank" && by("legR").joint.to === "tank", "side parts are welded to the tank");
check(run("checkRules")(R0.parts).length === 0, "the assembled rocket follows the rules");

/* ---- 2. checking designs ---- */
console.log("\n2. Checking designs");
const t24 = tank("t", 2, 4);
check(bad(withParts(t24, eng("e", "t"))).length === 0, "a tank with an engine under it is valid");
check(bad(withParts(t24)).some(m => /engine/.test(m)), "no engine: refused");
check(bad(withParts({ id: "n", type: "nose", width: 2, length: 1.5 })).some(m => /tank/.test(m)), "no tank: refused");
check(bad(withParts(tank("t", 1, 4), eng("e", "t", 0, 1500000))).some(m => /wider/.test(m)), "a 1.6 m engine under a 1 m tank: refused (wider than the face)");
check(bad(withParts(tank("t", 1, 4), eng("e", "t", 0, 600000))).length === 0, "a 1 m engine under a 1 m tank: fits exactly");
check(bad(withParts(tank("t", 2, 4), tank("u", 4, 2, { parent: "t", anchor: "top" }))).some(m => /wider/.test(m)), "a 4 m tank on a 2 m tank: refused");
check(bad(withParts(tank("t", 4, 4), tank("u", 2, 2, { parent: "t", anchor: "top" }), eng("e", "t"))).length === 0, "a 2 m tank on a 4 m tank: allowed");
check(bad(withParts(t24, eng("e", "t"), eng("f", "t"))).some(m => /overlap/.test(m)), "two engines in the same place: refused");
check(bad(withParts(tank("t", 4, 4), eng("e", "t", -1, 600000), eng("f", "t", 1, 600000))).length === 0, "two big engines side by side under a 4 m tank: valid");
check(bad(withParts(tank("t", 4, 4), eng("e", "t", -1.7, 600000))).some(m => /edge/.test(m)), "an engine pushed past the edge of the face: refused");
check(bad(withParts(tank("t", 4, 8), eng("a", "t", -1.5, 600000), eng("b", "t", -0.5, 600000), eng("c", "t", 0.5, 600000), eng("d", "t", 1.5, 600000))).length === 0, "four large engines side by side fit under a 4 m tank");
check(bad(withParts(t24, eng("e", "t"), { id: "x", type: "engine", thrust: 250000, parent: "e", anchor: "top" })).length > 0 && bad(withParts(t24, { id: "n", type: "nose", width: 2, length: 1.5, parent: "t", anchor: "top" }, eng("e2", "n", 0), eng("e", "t"))).some(m => /already joined/.test(m)), "nothing can join on the end of a part that is already joined to its parent");
check(bad(withParts(t24, eng("e", "t"), { id: "n", type: "nose", width: 2, length: 1.5, parent: "t", anchor: "top" }, { id: "n2", type: "nose", width: 2, length: 1, parent: "n", anchor: "top" })).some(m => /nothing to join/.test(m)), "something on top of a nose cone: refused (the tip has no face)");
check(bad(withParts(t24, eng("e", "t"), { id: "l", type: "leg", parent: "e", anchor: "side", side: 0, y: 0.2 })).some(m => /only hang on a tank/.test(m)), "a leg on an engine: refused");
check(bad(withParts(t24, eng("e", "t"), { id: "f", type: "fin", parent: "t", anchor: "side", side: 0, y: 4.5 })).length > 0, "a fin joined above the top of the tank: refused");
check(bad(withParts(t24, eng("e", "t"), { id: "f", type: "fin", parent: "t", anchor: "side", side: 0, y: 1 }, { id: "g", type: "fin", parent: "t", anchor: "side", side: 1, y: 1.2 })).some(m => /same place/.test(m)), "two fins crowded on the same side: refused");
check(bad(withParts(t24, eng("e", "t"), { id: "f", type: "fin", parent: "t", anchor: "side", side: -1, y: 1 }, { id: "g", type: "fin", parent: "t", anchor: "side", side: 1, y: 1 })).length === 0, "a left fin and a right fin at the same height: fine");
check(bad(withParts(tank("t", 3, 4), eng("e", "t"))).some(m => /width/.test(m)), "a 3 m tank: refused (not a width class)");
check(bad(withParts(tank("t", 2, 4.3), eng("e", "t"))).some(m => /length/.test(m)), "a 4.3 m tank: refused (not on the 0.5 m grid)");
check(bad(withParts(t24, { id: "q", type: "rocket", parent: "t" })).some(m => /unknown/.test(m)), "an unknown part type: refused");
check(bad(withParts(t24, eng("t", "t"))).some(m => /id/.test(m)), "a repeated id: refused");
check(bad(withParts(eng("e", null), t24)).length > 0, "an engine as the first part: refused");
check(bad(null).length > 0 && bad({ parts: [] }).length > 0, "nothing at all: refused");

/* ---- legs ---- */
console.log("\n2b. Legs");
const legD = (extra) => withParts(t24, eng("e", "t"), Object.assign({ id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4 }, extra));
check(bad(legD({})).length === 0 && bad(legD({ drop: 4 })).length === 0 && bad(legD({ drop: 0.5 })).length > 0 && bad(legD({ drop: 8.5 })).length > 0, "a leg's length is optional, and has to be between 1 and 8 m");
const footOf = (d) => { let low = Infinity; for (const p of run("assemble")(d, { keepFrame: true }).parts) if (p.kind === "leg") for (const v of p.verts) low = Math.min(low, p.at[1] + v[1]); return low; };
check(footOf(legD({ drop: 4 })) < footOf(legD({})) - 2, "a longer leg reaches lower");
check(near(run("assemble")(legD({}), { keepFrame: true }).parts.find(p => p.id === "lL").mass, run("assemble")(DESIGN, { keepFrame: true }).parts.find(p => p.id === "legL").mass, 1e-6), "a leg with no length set is the same as before (1.7 m)");
const warn = (d) => run("designWarnings")(d);
check(warn(DESIGN).length === 0, "the starting rocket has no warnings");
const hugeRocket = withParts(tank("t", 4, 8), eng("a", "t", -1, 1500000), eng("b", "t", 1, 1500000), { id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4 });
check(bad(hugeRocket).length === 0 && warn(hugeRocket).length === 1 && /reaches lower than the legs/.test(warn(hugeRocket)[0]), `a huge engine hangs lower than the default legs: warned, but still allowed ("${warn(hugeRocket)[0]}")`);
const need = parseFloat(/about ([\d.]+) m long/.exec(warn(hugeRocket)[0])[1]);
const fixed = withParts(tank("t", 4, 8), eng("a", "t", -1, 1500000), eng("b", "t", 1, 1500000), { id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4, drop: need });
check(warn(fixed).length === 0, `legs of the suggested length (${need.toFixed(1)} m) clear the warning`);
check(warn(withParts(t24, eng("e", "t"))).length === 1 && /no legs/.test(warn(withParts(t24, eng("e", "t")))[0]), "no legs: warned that it would stand on its engine");
check(warn({ version: 1, parts: [] }).length === 0, "an empty design has no warnings");

/* ---- 3. saving and loading ---- */
console.log("\n3. Saving and loading");
const text = run("designToText")(DESIGN), back = run("designFromText")(text);
check(back.design && JSON.stringify(back.design) === JSON.stringify(DESIGN), "a design saves as text and loads back identical");
check(run("designFromText")("{not json").design === null && run("designFromText")("{not json").problems.length === 1, "broken text is refused with a message");
const broken = clone(DESIGN); broken.parts[1].thrust = 12345;
check(run("designFromText")(JSON.stringify(broken)).design === null, "text holding an invalid design is refused");
const hash = run("designToHash")(DESIGN), fromHash = run("designFromHash")(hash);
check(fromHash.design && JSON.stringify(fromHash.design) === JSON.stringify(DESIGN), "a design survives the trip through the page address (builder to game)");
check(run("designFromHash")("").design === null && run("designFromHash")("").problems.length === 0, "no design in the address: no complaint, the game uses the starting rocket");
check(run("designFromHash")("#d=%7Bbad").problems.length > 0, "a damaged address is reported, not trusted");
check(Object.keys(run("savedDesigns")()).length === 0 && run("saveDesign")("x", DESIGN) === false, "with no browser storage, saving says no and nothing breaks");

/* ---- 4. fuel pool and engines in the world (stand-in physics) ---- */
console.log("\n4. Several tanks and engines in the world");
function load(design) { ctx.__d = design; run("ROCKET = assemble(__d)"); run("buildWorld")(); }
function burn(seconds, throttle) {
  run("controls").throttle = throttle;
  for (let i = 0; i < seconds * 60; i++) run("stepSim")();
  run("controls").throttle = 0;
}
load(DESIGN);
let s = run("sim");
check(s.tanks.length === 1 && near(s.fuelFull, 12566.37, 0.01) && s.fuel === s.fuelFull, "one tank: the pool holds its 12.57 t of fuel");
check(near(s.refOffset, by("tank").at[1] + 0.02, 1e-9), "the pad altitude reference is the hull's height on the pad");
const m0 = s.hull.body.getMass(); burn(10, 1);
const mdot = 250000 / (310 * G0);
check(near(s.fuel, s.fuelFull - mdot * 10, 2), `10 s at full throttle burns ${(mdot * 10).toFixed(0)} kg (the pool: ${s.fuel.toFixed(0)} kg left)`);
check(near(s.hull.body.getMass(), m0 - mdot * 10, 2), "the tank weighs less as it empties");
check(near(s.thrust, 250000 * 280 / 310 - 0, 3000) && s.thrust > 0, `thrust at the ground is about ${(s.thrust / 1000).toFixed(0)} kN (sea level)`);

const two = withParts(tank("t", 4, 4), tank("u", 2, 2, { parent: "t", anchor: "top" }), eng("e", "t", -1, 250000), eng("f", "t", 1, 250000),
                      { id: "n", type: "nose", width: 2, length: 1.5, parent: "u", anchor: "top" },
                      { id: "fin", type: "fin", parent: "t", anchor: "side", side: 0, y: 0.5 });
check(bad(two).length === 0, "a two-tank, two-engine rocket is valid" + (bad(two).length ? ": " + bad(two).join("; ") : ""));
load(two); s = run("sim");
const full = run("tankSpec")(4, 4).fuel + run("tankSpec")(2, 2).fuel;
check(s.tanks.length === 2 && near(s.fuelFull, full, 0.01), `two tanks share one pool (${(full / 1000).toFixed(1)} t)`);
check(s.hull.def.id === "t", "the hull is the first tank");
const mt = s.tanks.map(t => t.part.body.getMass()); burn(20, 1);
const fracLeft = s.fuel / s.fuelFull;
const mt2 = s.tanks.map(t => t.part.body.getMass());
check(near(mt2[0], s.tanks[0].dry + fracLeft * s.tanks[0].full, 1) && near(mt2[1], s.tanks[1].dry + fracLeft * s.tanks[1].full, 1), `both tanks drain evenly (${(fracLeft * 100).toFixed(1)}% left in each)`);
check(near(s.fuelFull - s.fuel, 2 * mdot * 20, 3), "two engines burn twice the fuel");
check(near(run("maxThrust")(), 2 * 250000 * (1 - (1 - 280 / 310) * s.rho / 1.225), 5), "the bar's thrust adds up both engines");
check(near(run("vacIsp")(), 310, 1e-9), "two engines together still have the engine's own efficiency");
check(near(run("sim").parts.filter(p => p.forces.some(f => f.kind === "thrust")).length, 2), "both engines are in the world as separate parts");
let flameA = 0; run("controls").throttle = 1; run("stepSim")(); for (const p of s.parts) for (const f of p.forces) if (f.kind === "thrust") flameA += f.now; run("controls").throttle = 0;
check(flameA > 0, "both engines produce thrust together");

/* run out of fuel */
load(DESIGN); s = run("sim"); burn(200, 1);
check(s.fuel === 0 && s.thrust === 0 && s.emptyLogged, "an empty tank shuts the engine off");
check(near(s.hull.body.getMass(), s.tanks[0].dry, 1), "and the empty tank weighs only its dry mass");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
