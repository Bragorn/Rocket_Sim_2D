/* =====================================================================
   RULES TESTS  (tests/rules-tests.js)
   Runs the real game files (no browser, no planck) and checks them.
   Needs Node.js. From the project folder:   node tests/rules-tests.js

   1. Every part follows the rules (checkRules), and the checker really
      catches parts that break them.
   2. Engines: thrust and efficiency with the air pressure.
   3. The starting rocket: fuel, thrust-to-weight, delta-v.
   4. Stability and a quick flight, with the whole rocket treated as one
      rigid body (the same aero.js code, no joints).
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const ctx = { console, Math, Object, Array, Number, document: { body: {} }, planck: { Settings: {}, Vec2: function (x, y) { this.x = x; this.y = y; } } };
vm.createContext(ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "aero"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const run = (e) => vm.runInContext(e, ctx);
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }

const G0 = run("G0"), R = run("R"), MU = run("MU"), RULES = run("RULES"), parts = run("ROCKET.parts");
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---- 1. the rules ---- */
console.log("\n1. Every part follows the rules");
const bad = run("checkRules(ROCKET.parts)");
check(bad.length === 0, bad.length === 0 ? "the starting rocket follows every rule" : "breaches: " + bad.join("; "));
const tk = run("tankSpec(2, 4)");
check(near(tk.fuel, 12566, 1) && near(tk.dry, 785, 1), `2 m x 4 m tank: ${tk.fuel.toFixed(0)} kg of fuel, ${tk.dry.toFixed(0)} kg dry (${(tk.dry / tk.fuel * 100).toFixed(1)}%)`);
for (const L of [2, 4, 8]) { const t = run(`tankSpec(2, ${L})`); check(t.dry / t.fuel >= RULES.tankDryMin && t.dry / t.fuel <= RULES.tankDryMax, `2 m x ${L} m tank: dry mass is ${(t.dry / t.fuel * 100).toFixed(1)}% of its fuel`); }
for (const W of RULES.tankWidths) for (const L of [1, 2, 4, 8]) {
  const t = run(`tankSpec(${W}, ${L})`), frac = t.dry / t.fuel;
  if (frac < RULES.tankDryMin || frac > RULES.tankDryMax) check(false, `${W} m x ${L} m tank: dry mass is ${(frac * 100).toFixed(1)}% of its fuel, outside the allowed band`);
}
const eng = run("engine(250e3)"), eng2 = run("engine(600e3)");
check(near(eng.mass, 250e3 / (60 * G0), 1e-6) && near(eng2.mass, 600e3 / (60 * G0), 1e-6), `engine weight follows thrust (250 kN: ${eng.mass.toFixed(0)} kg, 600 kN: ${eng2.mass.toFixed(0)} kg)`);
check(eng2.width < 2.0 && eng2.width > eng.width, `a 600 kN engine is wider (${eng2.width.toFixed(2)} m) but still fits a 2 m tank`);

const cheat = [
  Object.assign(run("tank(2, 4)"), { fuel: { dry: 100, full: 12566 }, mass: 12666 }),                // walls far too light
  Object.assign(run("engine(250e3)"), { id: "e2", mass: 50 }),                                       // engine far too light
  Object.assign(run("tank(2, 4)"), { id: "t3", width: 3 }),                                          // not a width class
  Object.assign(run("nose(2, 1.5)"), { id: "n2", length: 1.3 })                                      // off the grid
];
const caught = run("checkRules").call(null, cheat);
check(caught.some(m => /dry mass/.test(m)) && caught.some(m => /lighter than the rules/.test(m)) && caught.some(m => /width/.test(m)) && caught.some(m => /multiple/.test(m)),
      `the checker catches a light tank, a light engine, a bad width and an off-grid length (${caught.length} breaches found)`);
const dup = run("checkRules")([run("tank(2, 4)"), run("tank(2, 4)")]);
check(dup.some(m => /twice/.test(m)), "the checker catches two parts with the same id");

/* ---- 2. engines in air ---- */
console.log("\n2. Engines and air pressure");
const th = eng.forces[0];
const thrustAt = (pf) => th.vac - (th.vac - th.sl) * pf;
const ispAt = (pf) => thrustAt(pf) / (th.mdot * G0);
check(near(thrustAt(0), 250e3, 1e-6) && near(ispAt(0), RULES.ispVac, 1e-9), `vacuum: ${(thrustAt(0) / 1000).toFixed(0)} kN, efficiency ${ispAt(0).toFixed(0)} s`);
check(near(ispAt(1), RULES.ispSl, 1e-9), `sea level: ${(thrustAt(1) / 1000).toFixed(0)} kN, efficiency ${ispAt(1).toFixed(0)} s`);
check(near(ispAt(0.5), (RULES.ispSl + RULES.ispVac) / 2, 1e-9), "halfway up the air, the efficiency is halfway between");
check(th.minThrottle >= RULES.minThrottle, `the engine cannot throttle below ${th.minThrottle * 100}%`);

/* ---- 3. the starting rocket ---- */
console.log("\n3. The starting rocket");
const wet = parts.reduce((s, d) => s + d.mass, 0), fuel = parts.find(d => d.fuel).fuel.full, dry = wet - fuel;
const twrSl = th.sl / (wet * G0), dvVac = RULES.ispVac * G0 * Math.log(wet / dry);
console.log(`  info    wet ${wet.toFixed(0)} kg, dry ${dry.toFixed(0)} kg, fuel ${fuel.toFixed(0)} kg`);
check(twrSl > 1.2 && twrSl < 3, `thrust-to-weight at liftoff is ${twrSl.toFixed(2)} (sea level)`);
check(dvVac > 3500, `delta-v in vacuum is ${dvVac.toFixed(0)} m/s: orbit here needs about ${Math.sqrt(MU / R).toFixed(0)} m/s plus losses`);
const hover = th.sl * th.minThrottle / (dry * G0);
console.log(`  info    lowest thrust / empty weight = ${hover.toFixed(2)} (above 1 means it cannot hover and must land with a timed burn)`);

/* ---- 4. stability and a quick flight, the whole rocket as ONE rigid body ---- */
console.log("\n4. Stability and flight (one rigid body, same aero.js code)");
function centroid(v) { let a = 0, cx = 0, cy = 0; for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length], c = p.x * q.y - q.x * p.y; a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; } a /= 2; return [cx / (6 * a), cy / (6 * a)]; }
function model(withFins, tankDry) {
  const defs = parts.filter(d => withFins || !/^fin/.test(d.id));
  const items = defs.map(d => {
    const verts = d.verts.map(v => ({ x: v[0], y: v[1] })), c = centroid(verts);
    const xs = verts.map(v => v.x), ys = verts.map(v => v.y), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return { def: d, verts, C: [d.at[0] + c[0], d.at[1] + c[1]], m: (d.hull && tankDry) ? d.fuel.dry : d.mass, w, h };
  });
  const M = items.reduce((s, i) => s + i.m, 0);
  const cg = [items.reduce((s, i) => s + i.m * i.C[0], 0) / M, items.reduce((s, i) => s + i.m * i.C[1], 0) / M];
  const I = items.reduce((s, i) => s + i.m * ((i.C[0] - cg[0]) ** 2 + (i.C[1] - cg[1]) ** 2 + (i.w * i.w + i.h * i.h) / 12), 0);
  const S = { x: 0, y: R + 10, a: 0, vx: 0, vy: 0, w: 0, Fx: 0, Fy: 0, T: 0 };
  const rot = (x, y) => [Math.cos(S.a) * x - Math.sin(S.a) * y, Math.sin(S.a) * x + Math.cos(S.a) * y];
  const wc = it => { const r = rot(it.C[0] - cg[0], it.C[1] - cg[1]); return { x: S.x + r[0], y: S.y + r[1] }; };
  const pl = items.map(it => {
    const body = { getAngle: () => S.a, getMass: () => it.m, getWorldCenter: () => wc(it),
      getLinearVelocityFromWorldPoint: wp => ({ x: S.vx - S.w * (wp.y - S.y), y: S.vy + S.w * (wp.x - S.x) }),
      applyForce: (F, wp) => { S.Fx += F.x; S.Fy += F.y; S.T += (wp.x - S.x) * F.y - (wp.y - S.y) * F.x; } };
    const p = { def: it.def, body, verts: it.verts, forces: (it.def.forces || []).map(f => Object.assign({ now: 0, angle: 0 }, f)) };
    p.forces.forEach(f => run("prepareAero")(p, f));
    return p;
  });
  ctx.sim = { parts: pl, hull: pl.find(p => p.def.hull), hullWidth: 2 };
  return { S, M, I, cg, rot };
}
function ascend(withFins, tilt, secs) {
  const k = model(withFins, false), S = k.S, DT = 1 / 60;
  S.a = tilt; let maxAoa = 0;
  for (let t = 0; t < secs; t += DT) {
    S.Fx = S.Fy = S.T = 0;
    const r = Math.hypot(S.x, S.y), g = MU / (r * r);
    S.Fx += -k.M * g * S.x / r; S.Fy += -k.M * g * S.y / r;
    const ax = -Math.sin(S.a), ay = Math.cos(S.a), n = k.rot(-k.cg[0], -k.cg[1]);   // thrust from the nozzle (rocket bottom), sea-level value
    S.Fx += th.sl * ax; S.Fy += th.sl * ay; S.T += n[0] * th.sl * ay - n[1] * th.sl * ax;
    run("applyAero")();
    S.vx += S.Fx / k.M * DT; S.vy += S.Fy / k.M * DT; S.w += S.T / k.I * DT; S.x += S.vx * DT; S.y += S.vy * DT; S.a += S.w * DT;
    const V = Math.hypot(S.vx, S.vy);
    if (V > 5 && t > 3) { const c = (-Math.sin(S.a) * S.vx + Math.cos(S.a) * S.vy) / V; maxAoa = Math.max(maxAoa, Math.acos(Math.min(1, Math.abs(c))) * 180 / Math.PI); }
  }
  return maxAoa;
}
const calFull = (model(true, false), run("stabilityCal")()), calDry = (model(true, true), run("stabilityCal")()), calNoFins = (model(false, false), run("stabilityCal")());
check(calFull > 0.3, `with fins, full tank: stable (${calFull.toFixed(2)} cal)`);
check(calDry > 0.15, `with fins, empty tank: still stable (${calDry.toFixed(2)} cal)`);
check(calNoFins < 0, `without fins: unstable (${calNoFins.toFixed(2)} cal)`);
const aoaFins = ascend(true, 0.05, 30), aoaNone = ascend(false, 0.05, 30);
check(aoaFins < 5, `ascent 3 degrees off vertical, with fins: the angle of attack stays under ${aoaFins.toFixed(1)} degrees`);
check(aoaNone > 30, `same ascent without fins: it tumbles (angle of attack reaches ${aoaNone.toFixed(0)} degrees)`);

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
