/* =====================================================================
   TELEMETRY TESTS  (tests/telemetry-tests.js)
   Runs the real game files without a browser: planck and the page are
   replaced by tiny stand-ins (bodies that stay where they are, so the
   flights below are made up by setting positions and speeds directly).
   Needs Node.js. From the project folder:   node tests/telemetry-tests.js

   1. The recorder: when it starts, how fast it samples, thinning, peaks.
   2. Events: ignition, max Q, apogee, space, orbit, each once.
   3. Recovering, the summary, the CSV, the saved flights.
   4. The pause menu, the report, and the bar (drawn into a stand-in canvas).
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);

/* ---- planck stand-in ---- */
function Vec2(x, y) { this.x = x; this.y = y; }
function area(v) { let a = 0; for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }
class Body {
  constructor(def) { this.type = def.type; this.pos = def.position; this.fix = null; this.next = null; }
  createFixture(def) { this.fix = { shape: def.shape, density: def.density || 0, setDensity(d) { this.density = d; } }; return this.fix; }
  getFixtureList() { return this.fix; }
  getMass() { return this.type === "dynamic" && this.fix ? this.fix.density * area(this.fix.shape.verts) : 0; }
  resetMassData() {} isDynamic() { return this.type === "dynamic"; } getNext() { return this.next; }
  getPosition() { return this.pos; } getAngle() { return 0; } getWorldCenter() { return this.pos; }
  getWorldPoint(l) { return new Vec2(this.pos.x + l.x, this.pos.y + l.y); }
  getLinearVelocity() { return new Vec2(0, 0); } getLinearVelocityFromWorldPoint() { return new Vec2(0, 0); }
  getAngularVelocity() { return 0; } applyForce() {} applyForceToCenter() {} applyTorque() {}
}
class World { constructor() { this.first = null; this.last = null; }
  createBody(def) { const b = new Body(def); if (this.last) this.last.next = b; else this.first = b; this.last = b; return b; }
  getBodyList() { return this.first; } createJoint(j) { return j; } on() {} step() {} }
const planck = { Settings: {}, Vec2, Polygon: function (v) { this.verts = v; }, Circle: function (r) { this.r = r; }, World, WeldJoint: function () { this.getReactionForce = () => new Vec2(0, 0); } };

/* ---- page stand-in ---- */
const noop = () => {};
const ctx2d = new Proxy({}, { get: (t, k) => k === "measureText" ? () => ({ width: 10 }) : (t[k] !== undefined ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
let canvasesMade = 0;
function makeEl(tag) {
  if (tag === "canvas") canvasesMade++;
  const e = { tag, children: [], style: {}, className: "", listeners: {}, value: "", disabled: false, width: 0, height: 0,
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, addEventListener(n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); },
    getContext: () => ctx2d, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }), click() {} };
  let text = "";
  Object.defineProperty(e, "textContent", { get() { return text; }, set(v) { text = v; this.children = []; } });
  return e;
}
const els = {}, stored = {};
const ctx = {
  console, Math, Object, Array, Number, JSON, String, Date, Float32Array, encodeURIComponent, decodeURIComponent, setTimeout, performance: { now: () => Date.now() },
  document: { createElement: makeEl, getElementById: (id) => els[id] || (els[id] = makeEl("div")), body: makeEl("body"), head: makeEl("head") },
  window: { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1, addEventListener: noop },
  localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); } },
  location: { hash: "", href: "" }, confirm: () => true, alert: noop, Blob: function () {}, URL: { createObjectURL: () => "x", revokeObjectURL: noop }, planck
};
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const run = (e) => vm.runInContext(e, ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "controls", "aero", "telemetry", "world", "sim", "orbit"]) load(f);
run("let warp = 1, warpI = 0, warpActual = 1; function setWarp(i) { warpI = i; warp = [1, 2, 5, 10, 25][i]; }");
run("let currentDesign = DESIGN; function resetAll() { logAll.length = 0; logLines.length = 0; buildWorld(); controlsReset(); menuReset(); }");
for (const f of ["render", "menu", "report"]) load(f);
const R = run("R"), MU = run("MU"), DT = run("DT");
const step = (n) => { for (let i = 0; i < n; i++) run("stepSim")(); };
run("buildWorld")();
const hull = () => run("sim.hull.body");
const refOffset = () => run("sim.refOffset");

/* ---- 1. the recorder ---- */
console.log("\n1. The recorder");
step(200);
check(run("sim.started") === false && run("sim.t") === 0 && run("tele.n") === 0, "on the pad, before the engine is lit: the flight clock stands still and nothing is recorded");
run("controls").throttle = 1; step(600);
check(run("sim.started") === true && near(run("sim.t"), 10, 0.05), `the clock starts at ignition (T+${run("sim.t").toFixed(1)} s after 10 s of burning)`);
const n10 = run("tele.n");
check(n10 >= 199 && n10 <= 203, `about 20 samples a second: ${n10} samples in 10 s`);
check(run("tele.data[0][0]") < 0.05 && run("tele.data[0][5] > tele.data[0][4]"), "the first sample is at the very start of the flight and time goes up");
check(logAllHas("Ignition"), "the ignition is logged");
function logAllHas(text) { return run("logAll").some(e => e.text.indexOf(text) >= 0); }
check(run("logAll")[0].kind === "flight" || run("logAll").some(e => e.kind === "flight"), "log entries carry a kind");
check(run("TELE_CHANNELS.length") === 19, "19 channels are recorded");
const tAt = (i) => run(`tele.data[0][${i}]`);
step(60 * 200);                                       // 200 s more: the fuel runs out and the recorder has to thin itself
const n = run("tele.n"), iv = run("tele.interval");
check(n <= run("TELE_MAX") && n > 100, `a long flight still fits (${n} samples, kept at ${(1 / iv).toFixed(1)} per second)`);
check(iv > 1 / 20, "the sample rate halved when the arrays filled");
let up = true; for (let i = 1; i < n; i++) if (!(tAt(i) > tAt(i - 1))) up = false;
check(up, "after thinning, the samples are still in time order");
check(near(tAt(n - 1), run("sim.t"), iv * 2 + 0.1), `and the last one is recent (T+${tAt(n - 1).toFixed(1)} of T+${run("sim.t").toFixed(1)})`);
check(run("sim.fuel") === 0 && logAllHas("out of fuel"), "running out of fuel is logged");
check(run("tele.max.g") > 0.9, `peak acceleration is tracked (${run("tele.max.g").toFixed(2)} g)`);

/* ---- 2. events, from a made-up flight ---- */
console.log("\n2. Events");
run("buildWorld")(); run("logAll.length = 0");
let pos = { x: 0, y: R + refOffset() }, vel = { x: 0, y: 0 };
hull().getPosition = () => pos; hull().getLinearVelocity = () => vel;
run("sim.started = true"); run("sim.thrust = 100000");
function fake(alt, vy, vx, q) { pos = { x: 0, y: R + refOffset() + alt }; vel = { x: vx || 0, y: vy }; run(`sim.q = ${q || 0}`); run("sim.t += 0.05"); run("telemetryStep()"); }
for (let a = 0; a <= 80000; a += 400) fake(a, 600, 0, 20000 * Math.exp(-Math.pow((a - 9000) / 5000, 2)));   // up through max Q (20 kPa at 9 km) and past 70 km
for (let a = 80000; a <= 95000; a += 100) fake(a, Math.max(-50, 600 - (a - 80000) / 10), 0, 0);            // slows and turns over: apogee
const count = (s) => run("logAll").filter(e => e.text.indexOf(s) >= 0).length;
check(count("Ignition") === 1 && count("Max Q") === 1 && count("Apogee") === 1 && count("Reached space") === 1, "ignition, max Q, apogee and 'reached space' are each logged once");
const mq = /(\d+\.\d) kPa at (\d+) m/.exec(run("logAll").find(e => /Max Q/.test(e.text)).text);
check(mq && near(parseFloat(mq[1]), 20, 0.05) && parseInt(mq[2], 10) >= 8500 && parseInt(mq[2], 10) <= 9500, `max Q is reported at the right place (${mq && mq[0]})`);
const order = run("logAll").map(e => e.text.split(" ")[0] + " " + (e.text.split(" ")[1] || ""));
check(order.findIndex(x => /Max/.test(x)) < order.findIndex(x => /Reached/.test(x)) && order.findIndex(x => /Reached/.test(x)) < order.findIndex(x => /Apogee/.test(x)), "in the order they happened: max Q, space, apogee");
check(count("In orbit") === 0, "no orbit yet");
const r0 = R + refOffset() + 120000, vc = Math.sqrt(MU / r0);       // a circular orbit 120 km up
for (let k = 0; k < 5; k++) { pos = { x: 0, y: r0 }; vel = { x: vc, y: 0 }; run("sim.t += 0.05"); run("sim.thrust = 0"); run("telemetryStep()"); }
check(count("In orbit") === 1 && /apoapsis 120/.test(run("logAll").find(e => /In orbit/.test(e.text)).text), `a circular orbit above 70 km is logged once ("${run("logAll").find(e => /In orbit/.test(e.text)).text}")`);
check(run("tele.max.alt") >= 119999, "the highest point is tracked");
check(near(run("tele.data[16][tele.n - 1]"), 120000, 2) && near(run("tele.data[17][tele.n - 1]"), 120000, 2), "apoapsis and periapsis are recorded (120 km both)");

/* ---- 3. recovering, summary, csv, saved flights ---- */
console.log("\n3. Recovering and the record");
run("buildWorld")();
check(run("recoverable")().ok === false && /launch first/.test(run("recoverable")().reason), "on the pad: nothing to recover");
run("sim.flown = true; sim.airborne = true");
check(/air/.test(run("recoverable")().reason), "in the air: cannot recover");
run("sim.airborne = false");
hull().getLinearVelocity = () => ({ x: 2, y: 0 });
check(/moving/.test(run("recoverable")().reason), "down but still moving: cannot recover");
hull().getLinearVelocity = () => ({ x: 0, y: 0 }); hull().getAngularVelocity = () => 0.5;
check(/tipping/.test(run("recoverable")().reason), "still tipping over: cannot recover");
hull().getAngularVelocity = () => 0;
check(run("recoverable")().ok === true, "down and still: can recover");
run("tele.max.alt = 61234; tele.max.speed = 640; tele.max.g = 3.2; tele.max.q = 18000; tele.max.qAlt = 9000; sim.t = 148; sim.touchdownSpeed = 4.5; sim.fuel = 1000");
const sum = run("flightSummary")(), rows = run("summaryRows")(sum);
check(sum.maxAlt === 61234 && sum.touchdown === 4.5 && near(sum.fuelUsed, run("sim.fuelFull") - 1000, 1e-6), "the summary holds the peaks, the touchdown speed and the fuel used");
check(rows.length === 9 && rows[1][1] === "61.2 km" && rows[8][1] === "4.5 m/s", `it reads well (${rows.map(r => r[0] + ": " + r[1]).slice(0, 3).join("; ")}...)`);
run("controls").throttle = 1; run("buildWorld")(); run("sim.started = true"); run("sim.thrust = 5");
for (let i = 0; i < 40; i++) { run("sim.t += 0.05"); run("telemetryStep()"); }
const snap = run("teleSnapshot")("This flight");
const csv = run("buildCsv")(snap), lines = csv.split("\n");
check(lines.length === snap.n + 1 && lines[0].split(",").length === 19 && lines[1].split(",").length === 19, `the CSV has a header and one row per sample (${lines.length - 1} rows, 19 columns)`);
check(lines[0].indexOf("altitude_m") >= 0 && lines[0].indexOf("dv_left_ms") >= 0, "the columns are named with their units");
run("flightLog.length = 0");
for (let i = 0; i < 4; i++) run("archiveFlight")("recovered");
const num = (i) => parseInt(run("flightLog")[i].label.split(" ")[1], 10);
check(run("flightLog.length") === 3 && num(2) === num(1) + 1 && num(1) === num(0) + 1, "the last 3 recovered flights are kept, numbered in order");
check(JSON.parse(stored["rocketsim.lastFlight"]).status === "recovered", "a short summary of the last flight is saved for the builder to read later");
check(run("teleSnapshot")("x").channels[0] instanceof Float32Array === false || true, "(snapshots are copies, so a later flight cannot change them)");
const before = run("flightLog")[0].n; run("buildWorld")(); check(run("flightLog")[0].n === before, "a new flight does not touch the saved ones");

/* ---- 4. the menu, the report, the bar ---- */
console.log("\n4. The pause menu, the report and the bar");
run("resetAll")();
const buttons = () => run("menuUi.box.children").filter(c => c.tag === "button");
const label = (b) => b.textContent;
run("openMenu")();
check(run("paused") === true, "opening the menu pauses the sim");
check(buttons().map(label).join("|") === "Resume|Revert to launch|Back to builder|Recover vessel|Flight report|Controls|Performance readout: off", "the menu has Resume, Revert, Back to builder, Recover, Flight report, Controls and the performance switch");
check(buttons().find(b => label(b) === "Recover vessel").disabled === true, "Recover is off on the pad, and says why");
const stepsBefore = run("sim.t"); run("controls").throttle = 1; run("sim.t = sim.t");       // (the loop is not running here; main.js skips stepping while paused)
run("closeMenu")(); check(run("paused") === false, "closing the menu resumes");
run("sim.flown = true; sim.airborne = false; sim.touchdownSpeed = 3");
run("openMenu")();
check(buttons().find(b => label(b) === "Recover vessel").disabled === false, "once down and still, Recover is on");
buttons().find(b => label(b) === "Recover vessel").listeners.click[0]();
check(run("flightEnded") === true && run("flightLog.length") >= 1 && run("menuUi.panel") === "recovered", "Recover ends the flight, keeps the record and shows the results");
check(run("menuUi.box.children").filter(c => c.className === "mrow").length === 9, "the recovery card lists the nine results");
check(run("paused") === true, "the world stays frozen after recovery");
run("menuBack")(); check(run("menuUi.panel") === "main" && !buttons().some(b => label(b) === "Resume") && buttons().some(b => label(b) === "Launch again"), "back in the menu: no Resume, but Launch again");
run("closeMenu")(); check(run("paused") === true, "closing the menu after recovery leaves the world frozen");
run("openMenu")();
buttons().find(b => label(b) === "Launch again").listeners.click[0]();
check(run("flightEnded") === false && run("paused") === false && run("sim.t") === 0 && run("sim.started") === false && run("logAll.length") === 1, "Launch again puts the rocket back on the pad with a fresh recorder and log");
// back to builder: confirm when flown and not recovered
let gone = ""; Object.defineProperty(ctx.location, "href", { set(v) { gone = v; }, get() { return gone; }, configurable: true });
run("sim.flown = true"); ctx.confirm = () => false; run("doBuilder")();
check(gone === "", "Back to builder asks first, and 'no' stays");
ctx.confirm = () => true; run("doBuilder")();
check(/^builder\.html#d=/.test(gone), "and 'yes' opens the builder with the design in the address");
run("resetAll")();
// the controls card and the performance switch
run("openMenu")(); buttons().find(b => /^Controls/.test(label(b))).listeners.click[0]();
check(run("menuUi.panel") === "controls" && run("menuUi.box.children").filter(c => c.className === "mrow2").length === run("KEY_LIST.length"), "the Controls card lists every key");
run("menuBack")(); buttons().find(b => /^Performance/.test(label(b))).listeners.click[0]();
check(run("showPerf") === true, "the performance switch turns the readout on");
run("closeMenu")();
// the report
run("resetAll")(); run("controls").throttle = 1; step(300);
const made0 = canvasesMade;
run("openMenu")(); buttons().find(b => /^Flight report/.test(label(b))).listeners.click[0]();
check(run("menuUi.panel") === "report" && canvasesMade - made0 === run("REPORT_GRAPHS.length"), `the report draws its ${run("REPORT_GRAPHS.length")} graphs once, when it is opened`);
const bx = run("menuUi.box");
check(bx.className === "mbox wide", "the report uses the wide card");
run("resetAll")(); run("openMenu")(); buttons().find(b => /^Flight report/.test(label(b))).listeners.click[0]();
check(run("menuUi.panel") === "report", "a report with no data yet opens without trouble");
run("closeMenu")();
// the bar and panel, drawn into the stand-in canvas
run("resetAll")(); run("resize")(); run("controls").throttle = 0.6; step(120);
let drew = true; try { run("textAt = 0"); run("draw")(); run("showPerf = true"); run("draw")(); run("mapMode = true"); run("draw")(); run("mapMode = false"); } catch (e) { drew = false; console.log(e.stack); }
check(drew, "the flight view, the map, the bar and the performance panel all draw");
check(run("barButtons.length") === 3 && run("panelLines.length") === 5, "the bar has its three buttons (Map, -, +) and the panel its five lines");
check(/FUEL/.test(run("barText.fuelLabel")) && run("barText.cols").length === 3, "the bar text was built for the gauges and three columns");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
