/* =====================================================================
   BREAK TESTS  (tests/break-tests.js)
   Runs the real game files without a browser. planck is replaced by the shared stand-in (no physics), so the
   ground contacts are made up here: each test says "this part hit the ground at this speed with this much push"
   by calling the same functions planck would call (onPreSolve, onPostSolve), then checkImpacts() runs.
   Needs Node.js. From the project folder:   node tests/break-tests.js

   1. What each part can take (rules).
   2. Landing: a gentle one is fine, a hard one breaks the legs, and the threshold follows the rocket's weight.
   3. Only parts that touch the ground break: no chain reaction, the nose and tank are left alone.
   4. Things that must never break: the first part, dropped pieces, slow touches.
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const planck = require("./fake-planck");
const ctx = { console, Math, Object, Array, Number, JSON, encodeURIComponent, decodeURIComponent, document: { body: {} }, window: { addEventListener() {} }, planck };
vm.createContext(ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "controls", "aero", "telemetry", "world", "sim", "orbit"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const logs = [];
ctx.log = function (s, k) { logs.push({ s: s, k: k }); };
const run = (e) => vm.runInContext(e, ctx);
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);
const R = run("R");

function fresh(design) { ctx.__d = design || run("DESIGN"); run("ROCKET = assemble(__d)"); run("buildWorld")(); logs.length = 0; }
const part = (id) => run("sim").parts.find(p => p.def.id === id);
const mass = () => run("totalMass")();
const broke = () => logs.filter(l => /broke off/.test(l.s));

/* one step of contact: the part's contact point closes on the ground at vc, the ground pushes with J. All the parts are on one body moving at vc. */
function touch(ids, vc, Js) {
  run("sim.hull.body").vel = { x: 0, y: -vc };
  const ground = run("sim.ground.fixtures[0]");
  ids.forEach(function (id, i) {
    const p = part(id), ct = { getFixtureA: () => p.fixture, getFixtureB: () => ground, getWorldManifold: () => ({ pointCount: 1, points: [{ x: 0, y: R }] }) };
    run("onPreSolve")(ct);
    run("onPostSolve")(ct, { normalImpulses: [Js[i], 0] });
  });
  run("checkImpacts")();
}
function landOnLegs(vc) { const M = mass(); touch(["legL", "legR"], vc, [M * vc / 2, M * vc / 2]); }   // a level landing: each leg takes half the stop

/* ---- 1. what a part can take ---- */
console.log("\n1. What each part can take");
fresh();
const cap = (id) => run("impactCapacity")(part(id).def);
const RU = run("RULES");
check(near(cap("legL"), RU.impactJPerKg.leg * part("legL").def.mass, 1e-6), `a leg can take ${(cap("legL") / 1000).toFixed(0)} kJ: the rules' figure per kg times its own mass`);
check(near(cap("tank"), RU.impactJPerKg.tank * part("tank").def.fuel.dry, 1e-6), "a tank counts its walls only, not the fuel inside it");
check(cap("legL") > cap("engine") && cap("engine") > cap("nose") * 0.5 && cap("finL") < cap("legL"), `legs can take more than the engine bell (${(cap("engine") / 1000).toFixed(0)} kJ) and a fin (${(cap("finL") / 1000).toFixed(1)} kJ) the least of all`);
check(part("tank").joint === null && part("legL").joint !== null && part("engine").joint !== null, "only the first part has no link, so only it cannot break off");

/* ---- 2. landing ---- */
console.log("\n2. Landing");
const M0 = mass(), vb = Math.sqrt(4 * cap("legL") / M0);
console.log(`  info    full rocket ${M0.toFixed(0)} kg: the legs should give way at about ${vb.toFixed(1)} m/s`);
landOnLegs(0.9 * vb);
check(broke().length === 0 && !part("legL").debris, `a level landing at ${(0.9 * vb).toFixed(1)} m/s with full tanks: the legs hold`);
fresh(); landOnLegs(1.1 * vb);
check(broke().length === 2 && part("legL").debris && part("legR").debris, `at ${(1.1 * vb).toFixed(1)} m/s both legs break off (the message says: ${broke()[0] && broke()[0].s})`);
check(broke().every(l => l.k === "warning") && /kg of fuel/.test(broke()[0].s), "the message carries the energy, the speed, the rocket's mass and its fuel, so a test flight can be read afterwards");
check(!part("tank").debris && !part("engine").debris && !part("nose").debris && !part("finL").debris, "the tank, engine, nose and fins are still part of the rocket");
check(run("sim.vessel").length === 5 && run("sim.parts").filter(p => p.debris).length === 2, "the rocket has lost two legs and nothing else");
check(part("legL").body !== part("tank").body, "a broken leg is on a body of its own now");
check(part("tank").hitJ === 0 && part("legL").hitJ === 0, "the contact record is cleared every step");
fresh(); run("sim.tanks")[0].fuel = 0.1 * run("sim.tanks")[0].full;
const M1 = mass(), vb1 = Math.sqrt(4 * cap("legL") / M1);
landOnLegs(1.1 * vb);
check(M1 < M0 / 3 && broke().length === 0 && vb1 > 1.6 * vb, `the same landing with 10% fuel (${M1.toFixed(0)} kg) is fine: the legs would hold to ${vb1.toFixed(1)} m/s against ${vb.toFixed(1)} m/s when full`);
fresh(); run("sim.tanks")[0].fuel = 0.1 * run("sim.tanks")[0].full; landOnLegs(1.1 * vb1);
check(broke().length === 2, "and a light rocket landing hard enough still breaks them");
fresh(); const M = mass();
touch(["legL"], vb * 0.8, [M * vb * 0.8 * 0.9]);
check(broke().length === 1 && part("legL").debris && !part("legR").debris, "one leg touching down first and taking most of the stop breaks alone, and the other leg is untouched");

/* ---- 3. only what touches breaks ---- */
console.log("\n3. No chain reaction");
fresh(); landOnLegs(3 * vb);
check(broke().length === 2 && broke().every(l => /leg/.test(l.s)), "a landing far too hard breaks the two legs that touched and nothing else");
check(!part("nose").debris && !part("tank").debris && !part("engine").debris, "the nose is never the first to go when the legs hit");
run("sim.world").step();
logs.length = 0; run("checkImpacts")();
check(broke().length === 0, "a following step with no new touch breaks nothing");
// then the rocket drops onto its engine bell: that is a new touch, and the engine can take it or not
const Mn = mass(), ve = 2.0;
touch(["engine"], ve, [Mn * ve]);
const eng = part("engine"), Eexp = 0.5 * Mn * ve * ve;
check((Eexp > cap("engine")) === eng.debris, `then it drops on its engine bell at ${ve} m/s (${(Eexp / 1000).toFixed(0)} kJ against ${(cap("engine") / 1000).toFixed(0)} kJ the bell can take): the engine ${eng.debris ? "breaks" : "holds"}`);
check(!part("nose").debris && !part("tank").debris, "and still the nose and tank are fine");
fresh(); touch(["engine"], 5, [mass() * 5]);
check(part("engine").debris && run("sim.vessel").indexOf(part("engine")) < 0 && run("sim.parts").every(p => p === part("engine") || !p.debris || /leg|fin/.test(p.def.id)), "a hard hit on the engine bell breaks the bell off and leaves the rest of the rocket");
check(run("maxThrust")() === 0, "a rocket that has lost its engine has no thrust left to count");

/* ---- 4. never ---- */
console.log("\n4. Things that must not break");
fresh(); touch(["tank"], 50, [mass() * 50]);
check(broke().length === 0 && !part("tank").debris, "the first part (the tank) cannot break off, however hard it hits");
fresh(); landOnLegs(0.4);
check(broke().length === 0, "a touch slower than the minimum speed never breaks anything");
fresh(); touch(["legL", "legR"], 0.2, [1e7, 1e7]);
check(broke().length === 0, "even with a huge push, a slow touch is ignored");
fresh(); const w = run("sim.world");
run("sim.joints").splice(0, 0);
const legL = part("legL"); legL.debris = true;
touch(["legL"], 20, [mass() * 20]);
check(broke().length === 0, "a part that has already broken off does not break again");
fresh(); run("sim.hull.body").vel = { x: 0, y: -50 };
const g = run("sim.ground.fixtures[0]"), other = { getFixtureA: () => part("legL").fixture, getFixtureB: () => part("legR").fixture, getWorldManifold: () => ({ pointCount: 1, points: [{ x: 0, y: R }] }) };
run("onPreSolve")(other); run("onPostSolve")(other, { normalImpulses: [1e6, 0] }); run("checkImpacts")();
check(broke().length === 0, "a contact that is not with the ground is ignored");

/* ---- 5. the pad ---- */
console.log("\n5. Standing on the pad");
fresh();
const drop = Math.sqrt(2 * run("G0") * run("PAD_GAP")), Mp = mass();
touch(["legL", "legR"], drop, [Mp * drop / 2, Mp * drop / 2]);
check(broke().length === 0, `the small drop onto the pad at the start (${drop.toFixed(2)} m/s) breaks nothing`);
const Er = 0.5 * (Mp * run("G0") / 60 / 2) * (run("G0") / 60);
check(Er < 0.01 * cap("legL"), `resting on its legs, a leg takes ${Er.toFixed(0)} J per step, far below what it can take`);

/* ---- 6. what you fly after a break ---- */
console.log("\n6. What you fly after a break");
fresh(); touch(["nose"], 6, [mass() * 6]);
check(part("nose").debris && !part("tank").debris && run("sim.vessel").indexOf(part("tank")) >= 0, "when the nose breaks off, the tank and engine stay the rocket you fly (the nose is wreckage, not the new rocket)");
check(run("sim.hull").def.id === "tank" && run("sim.fuel") > 12000, `and the fuel readout still counts the tank (${run("sim.fuel").toFixed(0)} kg)`);
fresh(); landOnLegs(1.5 * vb);
check(run("sim.hull").def.id === "tank" && run("sim.vessel").length === 5, "after both legs break the rocket is still the same tank, engine, nose and fins");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
