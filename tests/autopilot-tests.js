/* =====================================================================
   AUTOPILOT TESTS  (tests/autopilot-tests.js)
   Runs the real controls.js and autopilot.js without a browser. The rocket is a stand-in: one rigid body that turns
   under the same torque rule sim.js uses (steer x wheel push, minus the damping, capped at the wheel push), plus
   whatever disturbance a test adds. So these check that the autopilot only steers through controls.steer, and that
   the real turning power limits it.
   Needs Node.js. From the project folder:   node tests/autopilot-tests.js
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }

const ctx = { console, Math, Object, Array, Number, JSON, document: { body: {} }, window: { addEventListener() {} }, planck: { Settings: {}, Vec2: function (x, y) { this.x = x; this.y = y; } } };
vm.createContext(ctx);
for (const f of ["util", "settings", "controls", "autopilot"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const run = (e) => vm.runInContext(e, ctx);
const logs = []; ctx.log = function (s, k) { logs.push({ s: s, k: k }); };
const DT = run("DT"), DAMP = run("DAMP_PER_TORQUE"), R = run("R");

/* a rigid rocket: mass, spin inertia, wheel push, where it is and how it moves */
function makeRocket(opts) {
  const S = Object.assign({ a: 0, w: 0, I: 58000, mass: 14000, wheel: 36000, disturb: 0, pos: { x: 0, y: R + 10 }, vel: { x: 0, y: 0 } }, opts);
  const body = { getAngle: () => S.a, getAngularVelocity: () => S.w, getInertia: () => S.I, getMass: () => S.mass, getLocalCenter: () => ({ x: 0, y: 0 }),
                 getPosition: () => S.pos, getLinearVelocity: () => S.vel, getWorldCenter: () => S.pos, getWorldPoint: (l) => ({ x: S.pos.x + l.x, y: S.pos.y + l.y }) };
  ctx.sim = { hull: { body: body }, vessel: [], wheelMax: S.wheel, t: 0 };
  logs.length = 0; run("controlsReset")();
  const k = run("keys"); for (const key in k) k[key] = false;
  S.step = function (n) {
    let maxW = 0, maxErr = 0, maxSteer = 0;
    for (let i = 0; i < (n || 1); i++) {
      run("updateControls")(DT);
      const st = run("controls").steer; maxSteer = Math.max(maxSteer, Math.abs(st));
      let tq = st * S.wheel; if (run("controls").damping) tq -= DAMP * S.wheel * S.w;
      tq = Math.max(-S.wheel, Math.min(S.wheel, tq)) + S.disturb;
      S.w += tq / S.I * DT; S.a += S.w * DT; ctx.sim.t += DT;
      maxW = Math.max(maxW, Math.abs(S.w));
    }
    return { maxW: maxW, maxSteer: maxSteer };
  };
  S.errDeg = (target) => Math.abs(run("wrapAngle")(target - S.a)) * 180 / Math.PI;
  return S;
}
const set = (m) => run(`autopilotSet("${m}")`);
const dir = (deg) => deg * Math.PI / 180;          // heading angle for the rocket's nose; +90 deg = nose pointing left

/* ---- 1. it steers only through the controls ---- */
console.log("\n1. Through the real controls");
let S = makeRocket();
check(run("autopilot.mode") === "off" && (S.step(10), run("controls").steer === 0), "switched off, it does nothing: steer stays 0");
S.a = 0.3; set("hold"); S.a = 0.3;
check(run("autopilot.mode") === "hold" && Math.abs(run("autopilot.target") - 0.3) < 1e-9, "hold remembers the way the rocket points when switched on");
S.step(60);
check(Math.abs(run("controls").steer) <= 1, "what it hands over is a steer number from -1 to 1");
set("hold");
check(run("autopilot.mode") === "off" && logs.some(l => l.k === "autopilot" && /off/.test(l.s)), "pressing the same mode again switches it off, and says so in the log");
S = makeRocket(); set("hold"); run("keys").KeyA = true; S.step(1);
check(run("autopilot.mode") === "off" && logs.some(l => /took the controls/.test(l.s)) && run("controls").steer === 1, "pressing A takes the steering back, switches it off and steers by hand");
run("keys").KeyA = false;

/* ---- 2. turning to a direction ---- */
console.log("\n2. Turning");
S = makeRocket({ a: 0 }); set("hold"); ctx.__t = dir(90); run("autopilot.target = __t");
let r = S.step(60 * 20);
check(S.errDeg(dir(90)) < 0.5 && Math.abs(S.w) < 0.01, `a 90 degree turn (a 14 t rocket) settles on target (${S.errDeg(dir(90)).toFixed(2)} deg off after 20 s)`);
S = makeRocket({ a: 0 }); set("hold"); run("autopilot.target = __t"); let over = 0, tDone = null;
for (let i = 0; i < 60 * 25; i++) { S.step(1); over = Math.max(over, (S.a - dir(90)) * 180 / Math.PI); if (tDone === null && S.errDeg(dir(90)) < 1 && Math.abs(S.w) < 0.02) tDone = i / 60; }
check(over < 3, `it does not swing past the target (overshoot at most ${over.toFixed(1)} deg)`);
check(tDone !== null && tDone < 12, `and it gets there in a reasonable time (${tDone && tDone.toFixed(1)} s)`);
const aMax = 36000 / 58000; const fastest = 2 * Math.sqrt(dir(90) / aMax);
check(tDone > fastest * 0.9, `it cannot beat the physics: the quickest possible turn with this wheel is ${fastest.toFixed(1)} s, it took ${tDone && tDone.toFixed(1)} s`);
S = makeRocket({ a: 0, I: 1.8e6, wheel: 144000, mass: 110000 }); set("hold"); run("autopilot.target = __t"); tDone = null; over = 0;
for (let i = 0; i < 60 * 80; i++) { S.step(1); over = Math.max(over, (S.a - dir(90)) * 180 / Math.PI); if (tDone === null && S.errDeg(dir(90)) < 1 && Math.abs(S.w) < 0.02) tDone = i / 60; }
const fastest2 = 2 * Math.sqrt(dir(90) / (144000 / 1.8e6));
check(tDone !== null && over < 4 && tDone > fastest2 * 0.9 && tDone > 1.8 * 4.7, `a 110 t rocket with a weak wheel turns the same 90 degrees much slower (${tDone && tDone.toFixed(0)} s, the physical best is ${fastest2.toFixed(0)} s) and still does not overshoot (${over.toFixed(1)} deg)`);
S = makeRocket({ a: 0 }); set("hold"); ctx.__t = dir(-170); run("autopilot.target = __t"); r = S.step(60 * 30);
check(S.errDeg(dir(-170)) < 0.5 && r.maxW <= run("AP_MAX_RATE") + 0.05, `a big turn the other way (170 degrees) works, and the spin never passes the cap (${r.maxW.toFixed(2)} rad/s)`);
S = makeRocket({ a: 0, w: 0.4 }); set("hold"); ctx.__t = dir(0); run("autopilot.target = __t"); S.step(60 * 15);
check(S.errDeg(0) < 0.5 && Math.abs(S.w) < 0.01, "a rocket already spinning is brought to a stop pointing the right way");
check(logs.some(l => /on target/.test(l.s)), "it logs when it is on target");

/* ---- 3. disturbances ---- */
console.log("\n3. Something pushes the rocket");
S = makeRocket({ a: 0, disturb: 0.3 * 36000 }); set("hold"); S.step(60 * 25);
check(S.errDeg(0) < 1.0, `a steady push of 30% of the wheel's strength is cancelled (${S.errDeg(0).toFixed(2)} deg off after 25 s)`);
S = makeRocket({ a: 0 }); set("hold"); S.step(60 * 5); S.w = 0.3; S.step(60 * 15);
check(S.errDeg(0) < 1.0, "a knock (a sudden spin) is corrected");
S = makeRocket({ a: 0, disturb: 1.5 * 36000 }); set("hold"); S.step(60 * 20);
check(S.errDeg(0) > 5 && logs.some(l => /flat out/.test(l.s)), "a push stronger than the wheel can fight wins, and the autopilot says it is turning flat out");

/* ---- 4. the directions ---- */
console.log("\n4. Directions");
S = makeRocket({ vel: { x: -100, y: 100 } }); set("pro"); S.step(60 * 15);
check(S.errDeg(dir(45)) < 1, "prograde: moving up and to the left, the nose points up-left");
S = makeRocket({ vel: { x: -100, y: 100 } }); set("retro"); S.step(60 * 20);
check(S.errDeg(dir(-135)) < 1, "retrograde: the nose points the opposite way");
S = makeRocket({ a: 0.5, pos: { x: R * 0.7071, y: R * 0.7071 } }); set("up"); S.step(60 * 15);
check(S.errDeg(Math.atan2(-0.7071, 0.7071)) < 1, "up: away from the planet's centre, wherever on the planet the rocket is");
S = makeRocket({ a: 0.7, vel: { x: 0, y: 0 } }); set("pro"); S.step(60 * 5);
check(Math.abs(S.a - 0.7) < 0.01, "prograde on the ground, not moving: it keeps the direction it had, as other games do");
S = makeRocket({ vel: { x: 0, y: 2 } }); set("pro"); S.step(60 * 3); ctx.sim.hull.body.getLinearVelocity = () => ({ x: -50, y: 2 });
S.vel = { x: -50, y: 2 }; S.step(60 * 15);
check(S.errDeg(Math.atan2(50, 2)) < 1.5, "prograde follows the path as it changes (the target moves, the rocket follows it)");

/* ---- 5. no turning power ---- */
console.log("\n5. Nothing to turn with");
S = makeRocket({ wheel: 0 }); set("hold"); ctx.__t = dir(40); run("autopilot.target = __t"); S.step(60 * 5);
check(run("controls").steer === 0 && S.a === 0 && logs.filter(l => /nothing to turn with/.test(l.s)).length === 1, "with no reaction wheel and no engine burning it asks for nothing and says so once");
S = makeRocket({ wheel: 0 });
ctx.sim.vessel = [{ ox: 0, oy: 0, body: ctx.sim.hull.body, forces: [{ kind: "thrust", now: 200000, gimbalMax: 6 * Math.PI / 180, at: [0, -3] }] }];
set("hold"); S.step(10);
check(run("turningPower")().aG > 0 && run("turningPower")().aW === 0, "an engine that is burning gives it some turning power from its swivel");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
