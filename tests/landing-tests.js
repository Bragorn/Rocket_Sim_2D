/* =====================================================================
   LANDING TESTS  (tests/landing-tests.js)
   Flies the landing program with the REAL physics engine (js/planck.min.js), no browser: rockets of different sizes and weights are
   placed up in the air, falling, with the program switched on, and the touchdown is checked.
   Needs Node.js. From the project folder:   node tests/landing-tests.js

   1. Ground height and the seconds-to-ground number.
   2. Landings: starting rocket full and nearly empty, a small one, a big one, with sideways speed, from high up.
   3. Too late: switched on when it cannot stop: it says so, and burns flat out.
   4. Taking the throttle back.
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const planck = require(path.join(root, "js", "planck.min.js"));
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);

const winHandlers = {};
const ctx = { console, Math, Object, Array, Number, JSON, String, Date, Float32Array, encodeURIComponent, decodeURIComponent, setTimeout, performance: { now: () => Date.now() },
  document: { body: {} }, window: { addEventListener(n, f) { (winHandlers[n] = winHandlers[n] || []).push(f); } }, localStorage: { getItem: () => null, setItem() {} }, planck };
vm.createContext(ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "controls", "aero", "telemetry", "world", "sim", "orbit", "autopilot", "landing"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const run = (e) => vm.runInContext(e, ctx);
run("var warp = 1; function setWarp(i) { warp = [1, 2, 5, 10, 25][i]; }");
const logs = [];
ctx.log = function (s, k) { logs.push({ s: s, k: k }); };
const R = run("R"), DT = run("DT"), DESIGN = run("DESIGN");
const tank = (id, w, l, extra) => Object.assign({ id, type: "tank", width: w, length: l }, extra);
const eng = (id, parent, dx, thrust) => ({ id, type: "engine", thrust: thrust || 250000, parent, anchor: "bottom", dx: dx || 0 });
const P2 = (x, y) => new planck.Vec2(x, y);

/* a rocket up in the air, engine active, falling: alt = height of its lowest point (m), vd = speed down, vh = speed sideways, fuel = fraction of full tanks */
function scenario(design, o) {
  ctx.__d = design; run("ROCKET = assemble(__d)"); run("buildWorld")(); run("controlsReset")(); run("fireStage")();
  logs.length = 0;
  const s = run("sim"), b = s.hull.body, vv = Math.hypot(o.vd, o.vh);
  const a = Math.atan2(o.vh, o.vd);                                   // nose against the path
  b.setTransform(P2(0, R + o.alt + s.refOffset - run("PAD_GAP")), a);
  b.setLinearVelocity(P2(o.vh, -o.vd));
  for (const t of s.tanks) { t.fuel = t.full * o.fuel; t.part.fixture.setDensity((t.dry + t.fuel) / t.area); }
  b.resetMassData(); run("updateVessels")();
  s.airborne = true; s.flown = true;
  return s;
}
function fly(s, secs) {
  const info = { crashed: false, t: 0 };
  for (let i = 0; i < secs / DT; i++) {
    run("stepSim")(); info.t += DT;
    if (run("landing.mode") === "landed") break;
  }
  info.mode = run("landing.mode"); info.touch = s.touchdownSpeed; info.fuel = s.fuel; info.breaks = logs.filter(l => /broke off/.test(l.s)).length;
  info.vv = Math.hypot(s.hull.body.getLinearVelocity().x, s.hull.body.getLinearVelocity().y);
  info.tilt = Math.abs(s.hull.body.getAngle() + Math.atan2(s.hull.body.getPosition().x, s.hull.body.getPosition().y)) * 180 / Math.PI;
  return info;
}
const report = (name, s, i) => console.log(`  info    ${name}: ${i.mode}, touchdown ${i.touch === null ? "-" : i.touch.toFixed(1)} m/s (aim ${run("landing.vt").toFixed(1)}), ${i.breaks} breaks, fuel ${i.fuel.toFixed(0)} kg, ${i.t.toFixed(0)} s, tilt ${i.tilt.toFixed(0)}`);

const BIG = { version: 1, name: "big", parts: [tank("t", 4, 8), eng("a", "t", -1.5, 600000), eng("b", "t", -0.5, 600000), eng("c", "t", 0.5, 600000), eng("d", "t", 1.5, 600000),
  { id: "n", type: "nose", width: 4, length: 2, parent: "t", anchor: "top", dx: 0 },
  { id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4, drop: 4 }, { id: "f", type: "fin", parent: "t", anchor: "side", side: 0, y: 1 }] };
const SMALL = { version: 1, name: "small", parts: [tank("t", 1, 4), eng("e", "t", 0, 100000),
  { id: "n", type: "nose", width: 1, length: 1 , parent: "t", anchor: "top", dx: 0 },
  { id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4, drop: 1.5 }, { id: "f", type: "fin", parent: "t", anchor: "side", side: 0, y: 0.4 }] };

const topFins = JSON.parse(JSON.stringify(DESIGN)); topFins.parts.find(p => p.id === "fin").y = 3.6;
const noFins = (d) => Object.assign({}, d, { parts: d.parts.filter(p => p.type !== "fin") });

/* ---- 1. ground height and the seconds to the ground ---- */
console.log("\n1. Ground height and the countdown");
let s = scenario(noFins(DESIGN), { alt: 100, vd: 20, vh: 0, fuel: 0.3 });
const gh = run("groundHeight")(), r0 = R + 100 + s.refOffset - run("PAD_GAP"), g0 = run("MU") / (r0 * r0);
check(near(gh, 100, 0.05), `the height is measured to the lowest point of the rocket (${gh.toFixed(2)} m for a rocket whose feet are 100 m up)`);
const tc = run("groundCountdown")(), want = (-20 + Math.sqrt(400 + 2 * g0 * gh)) / g0;
check(tc !== null && near(tc, want, 0.05), `falling at 20 m/s from 100 m with the engine off: ${tc && tc.toFixed(2)} s to the ground`);
run("sim.thrust = 2.2 * 9.81 * totalMass()");
check(run("groundCountdown")() === null, "with thrust that would stop it first, there is no impact to count down to");
run("sim.thrust = 0"); s.hull.body.setLinearVelocity(P2(0, 30));
check(run("groundCountdown")() === null, "going up: no countdown");
run("buildWorld")();
check(near(run("groundHeight")(), run("PAD_GAP"), 1e-3), "on the pad the lowest point is the pad gap above the ground");

/* ---- 2. landings ---- */
console.log("\n2. Landings");
const flights = [
  ["starting rocket (no fins), 30% fuel, 3 km, 250 m/s down", noFins(DESIGN), { alt: 3000, vd: 250, vh: 0, fuel: 0.3 }],
  ["the same with 60% fuel, 3 km, 200 m/s down", noFins(DESIGN), { alt: 3000, vd: 200, vh: 0, fuel: 0.6 }],
  ["almost empty, 2 km, 200 m/s down", noFins(DESIGN), { alt: 2000, vd: 200, vh: 0, fuel: 0.1 }],
  ["like your flight: 2.5 km, 430 m/s down and 270 m/s sideways", noFins(DESIGN), { alt: 2500, vd: 430, vh: 270, fuel: 0.3 }],
  ["from 20 km, 700 m/s down and 500 m/s sideways", noFins(DESIGN), { alt: 20000, vd: 700, vh: 500, fuel: 0.4 }],
  ["switched on late and low: 300 m up, 40 m/s down", noFins(DESIGN), { alt: 300, vd: 40, vh: 0, fuel: 0.3 }],
  ["a small rocket (100 kN, 1 m wide)", noFins(SMALL), { alt: 2000, vd: 250, vh: 0, fuel: 0.2 }],
  ["a big rocket (four 600 kN engines)", noFins(BIG), { alt: 3000, vd: 250, vh: 0, fuel: 0.8 }],
  ["the big rocket from 20 km with sideways speed", noFins(BIG), { alt: 20000, vd: 600, vh: 400, fuel: 0.8 }],
  ["fins high on the tank (stable engine-first), fast", topFins, { alt: 10000, vd: 400, vh: 0, fuel: 0.3 }]
];
for (const [name, d, o] of flights) {
  const s2 = scenario(d, o); run("landingArm")();
  const i = fly(s2, 150), vt = run("landing.vt");
  report(name, s2, i);
  check(i.mode === "landed" && i.breaks === 0 && i.touch !== null && i.touch <= vt * 1.5 + 0.3 && i.tilt < 5 && i.fuel > 0, `${name}: down at ${i.touch === null ? "-" : i.touch.toFixed(1)} m/s (aimed for ${vt.toFixed(1)}), nothing broke, upright`);
}
s = scenario(DESIGN, { alt: 1000, vd: 80, vh: 0, fuel: 0.3 }); run("landingArm")();
check(logs.some(l => l.k === "warning" && /stable nose-first/.test(l.s)), "a rocket with its fins low is warned that engine-first it may tumble");
s = scenario(noFins(DESIGN), { alt: 1000, vd: 80, vh: 0, fuel: 0.3 }); run("landingArm")();
check(!logs.some(l => /stable nose-first/.test(l.s)), "and a finless one is not");
const v1 = scenario(noFins(DESIGN), { alt: 3000, vd: 250, vh: 0, fuel: 0.3 }); run("landingArm")();
const f1 = fly(v1, 150);
check(f1.fuel > 2500, `it does not waste fuel: ${(3600 - 0).toFixed(0)} kg to start, ${f1.fuel.toFixed(0)} kg left after landing`);

/* ---- 3. too late ---- */
console.log("\n3. Switched on too late");
s = scenario(noFins(DESIGN), { alt: 3000, vd: 250, vh: 0, fuel: 1 }); run("landingArm")();
const late = fly(s, 60);
check(run("landing.tooLate") === true && logs.some(l => l.k === "warning" && /(too late|not enough thrust)/.test(l.s)), "with full tanks it cannot stop from 3 km at 250 m/s: it says so");
check(late.touch !== null && late.touch < 250, `and it still burns flat out to take off speed (touchdown ${late.touch && late.touch.toFixed(0)} m/s instead of 250)`);

/* ---- 4. arming, and taking over ---- */
console.log("\n4. Arming and taking the throttle back");
const emit = (code) => (winHandlers.keydown || []).forEach(f => f({ code: code, repeat: false, preventDefault() {} }));
run("buildWorld")(); run("controlsReset")(); logs.length = 0; run("landingArm")();
check(run("landing.mode") === "off" && logs.some(l => /no engine is on/.test(l.s)), "no engine on yet: it will not arm");
run("fireStage")(); logs.length = 0; run("landingArm")();
check(run("landing.mode") === "off" && logs.some(l => /already on the ground/.test(l.s)), "sitting on the pad: it will not arm");
s = scenario(noFins(DESIGN), { alt: 3000, vd: 250, vh: 0, fuel: 0.3 });
emit("Digit5");
check(run("landing.mode") === "armed" && run("autopilot.mode") === "retro", "the 5 key arms it and the autopilot holds retrograde");
emit("Digit5");
check(run("landing.mode") === "off", "pressing 5 again switches it off");
emit("Digit5"); run("setWarp(4)");
for (let i = 0; i < 5; i++) run("stepSim")();
check(run("warp") === 1, "time warp drops to 1x when the ground is less than a minute away");
emit("KeyW");
check(run("landing.mode") === "off" && logs.some(l => /took the throttle/.test(l.s)), "W (or S, Z, X) takes the throttle back and switches it off");
s = scenario(noFins(DESIGN), { alt: 3000, vd: 250, vh: 0, fuel: 0.3 }); run("landingArm")();
let n = 0; while (run("landing.mode") !== "burn" && n++ < 60 * 40) run("stepSim")();
check(run("landing.mode") === "burn" && run("controls.throttle") > 0, "it lights the engine by itself");
emit("KeyZ");
check(run("landing.mode") === "off", "and Z takes over in the middle of the burn");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
