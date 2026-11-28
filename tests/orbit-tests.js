/* =====================================================================
   ORBIT TESTS  (tests/orbit-tests.js)
   The orbit maths (js/orbit.js) for every kind of path, including the odd ones: sitting still, going straight up, going
   straight down. Needs Node.js. From the project folder:   node tests/orbit-tests.js
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const planck = require("./fake-planck");
const ctx = { console, Math, Object, Array, Number, JSON, isFinite, document: { body: {} }, window: { addEventListener() {} }, planck };
vm.createContext(ctx);
for (const f of ["util", "settings", "orbit"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const orbit = (p, v) => vm.runInContext("orbitInfo", ctx)(p, v);
const R = vm.runInContext("R", ctx), MU = vm.runInContext("MU", ctx);

let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, rel) => Math.abs(a - b) <= (rel || 1e-6) * Math.max(1, Math.abs(b));
const finiteBound = (o) => [o.r, o.e, o.ex, o.ey, o.rp, o.ra, o.pLat, o.period].every(isFinite);

console.log("\nOrbit maths");
const r = R + 120000, vc = Math.sqrt(MU / r);
let o = orbit({ x: 0, y: r }, { x: vc, y: 0 });
check(o.bound && o.e < 1e-9 && near(o.rp, r) && near(o.ra, r) && near(o.period, 2 * Math.PI * Math.sqrt(r * r * r / MU)), "a circular orbit: both ends at the starting height, the lap time from the maths");
const vp = vc * 1.1;
o = orbit({ x: 0, y: r }, { x: vp, y: 0 });
const a = 1 / (2 / r - vp * vp / MU), e = r * vp * vp / MU - 1;
check(o.bound && near(o.e, e) && near(o.rp, r) && near(o.ra, a * (1 + e)) && near(o.rp, a * (1 - e)), "an ellipse, starting at its lowest point: the highest point is where the energy says");
o = orbit({ x: 0, y: r }, { x: vc * 0.8, y: 0 });
check(o.bound && near(o.ra, r) && o.rp < r && near(o.rp, o.pLat / (1 + o.e)), "an ellipse starting at its highest point");
const pLat = o.pLat, ee = o.e;
check(near(o.ra, pLat / (1 - ee), 1e-9), "and the highest point still agrees with the old way of working it out (p / (1 - e))");
o = orbit({ x: 0, y: r }, { x: vc * 1.6, y: 0 });
check(!o.bound && o.ra === Infinity && isFinite(o.rp) && o.period === null, "faster than escape speed: not bound, no highest point");
o = orbit({ x: 0, y: R + 7.4 }, { x: 0, y: 0 });
check(finiteBound(o) && o.bound && near(o.rp, 0, 1e-6) && near(o.ra, R + 7.4, 1e-6) , "sitting still on the ground: every number is a real number (this used to give NaN for the highest point and froze the map). Highest point = where it is");
o = orbit({ x: 3, y: R + 7.4 }, { x: 0, y: 0 });
check(finiteBound(o), "sitting still, a little off the vertical: still all real numbers");
o = orbit({ x: 0, y: R + 5000 }, { x: 0, y: 120 });
check(finiteBound(o) && o.ra > R + 5000 && near(o.rp, 0, 1e-6), "going straight up: a real highest point above where it is, and the lowest point is the planet's centre");
o = orbit({ x: 0, y: R + 5000 }, { x: 0, y: -120 });
check(finiteBound(o) && o.ra > R + 5000, "going straight down: the same path, a real highest point");
o = orbit({ x: 0, y: R + 5000 }, { x: 0, y: 1.2 * Math.sqrt(2 * MU / (R + 5000)) });
check(!o.bound && isFinite(o.rp) && o.ra === Infinity, "straight up faster than escape speed: not bound");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
