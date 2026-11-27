/* =====================================================================
   PAGE TESTS  (tests/page-tests.js)
   Starts the real flight page (every script index.html loads, main.js included) in a stand-in browser with the real
   physics engine, and plays through what a player does: launch, settle, burn, try to leave, leave, come back,
   switch vessel, scrap one. The screen is a stand-in; the menu's buttons are real objects that can be pressed.
   Needs Node.js. From the project folder:   node tests/page-tests.js
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const planck = require(path.join(root, "js", "planck.min.js"));

let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
function fakeStore() { const data = {}; return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } }; }

/* anything the game draws with: every property is more of the same, and calling it does nothing */
function dud(name) {
  const f = function () { return dud(name + "()"); };
  return new Proxy(f, { get: (t, k) => {
    if (k === Symbol.toPrimitive) return () => 0;
    if (k === "measureText") return () => ({ width: 10 });
    if (["width", "height", "clientWidth", "clientHeight", "innerWidth", "innerHeight"].includes(k)) return 800;
    if (k === "getBoundingClientRect") return () => ({ left: 0, top: 0, width: 800, height: 600 });
    if (k === "children" || k === "length") return [];
    if (k === "style") return {};
    if (k === "textContent" || k === "className" || k === "value") return "";
    if (k === "then") return undefined;
    return dud(name + "." + String(k));
  }, set: () => true, apply: () => dud(name + "()") });
}
/* a page element that remembers its children and click handlers, so the menu can be read and its buttons pressed */
function el(tag) {
  const e = { tag, children: [], style: {}, className: "", listeners: {}, disabled: false, type: "", getContext: () => dud("ctx"), getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    appendChild(c) { this.children.push(c); return c; }, addEventListener(n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); }, focus() {}, setAttribute() {} };
  let text = "";
  Object.defineProperty(e, "textContent", { get() { return text; }, set(v) { text = v; this.children = []; } });
  return e;
}

/* one page load of index.html */
function loadPage(store) {
  let raf = null; const handlers = {}; const loc = { hash: "", href: "" };
  const body = el("body"), head = el("head"), base = dud("document");
  const doc = new Proxy(base, { get: (t, k) => k === "createElement" ? el : k === "body" ? body : k === "head" ? head : k === "hidden" ? false : k === "addEventListener" ? ((n, f) => { (handlers["doc:" + n] = handlers["doc:" + n] || []).push(f); }) : t[k] });
  const ctx = { console: { log() {}, warn() {}, error: console.error }, Math, Object, Array, Number, JSON, Date, Error, isFinite, parseInt, parseFloat, String, Boolean, Map, Set, Float32Array, Float64Array, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
    performance: { now: () => ctx.__now }, __now: 0, document: doc,
    window: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, addEventListener: (n, f) => { (handlers[n] = handlers[n] || []).push(f); } },
    requestAnimationFrame: (f) => { raf = f; }, localStorage: store, location: loc, confirm: () => ctx.__confirm, __confirm: true, alert() {}, planck, navigator: {}, Image: function () {} };
  vm.createContext(ctx);
  const scripts = fs.readFileSync(path.join(root, "index.html"), "utf8").match(/src="js\/[a-z]+\.js"/g).map((s) => s.slice(8, -4)).filter((s) => s !== "planck.min");
  for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  const p = { ctx, loc, run: (e) => vm.runInContext(e, ctx) };
  p.frames = (n) => { for (let i = 0; i < n; i++) { ctx.__now += 16.7; const f = raf; raf = null; if (f) f(ctx.__now); } };
  p.fire = (n) => { for (const f of handlers[n] || []) f({}); };
  p.menu = (name) => { p.run("openMenu()"); if (name) p.run("showPanel('" + name + "')"); return p.run("menuUi.box.children"); };
  p.button = (label) => p.run("menuUi.box.children").find((c) => c.tag === "button" && c.textContent === label);
  p.rowButtons = (label) => p.run("menuUi.box.children").flatMap((r) => r.children || []).filter((c) => c.tag === "button" && c.textContent === label);   // the buttons inside the vessel list's rows
  p.notes = () => p.run("menuUi.box.children").filter((c) => c.className === "mnote").map((c) => c.textContent);
  p.press = (b) => (b.listeners.click || []).forEach((f) => f({}));
  return p;
}
const universeOf = (store) => JSON.parse(JSON.parse(store.data["rocketsim.universe"]).body);

/* a universe with one vessel parked in orbit and a new rocket on the pad, as the builder leaves it after two launches */
const store = fakeStore();
{
  const g = loadPage(store);
  let u = g.run("universeNew()");
  const a = g.run("universeAddVessel")(u, g.run("DESIGN"), "Parked");
  const C = Math.sqrt(g.run("MU") / (g.run("R") + 120000));
  u = g.run("universeUpdateVessel")(a.universe, a.id, { status: "orbit", revert: false, state: { pos: { x: 0, y: g.run("R") + 120000 }, vel: { x: C, y: 0 }, angle: 0, angVel: 0, fuel: {}, stageNext: 0 } }).universe;
  const b = g.run("universeAddVessel")(u, g.run("DESIGN"), "Fresh");
  g.run("universeSave")(b.universe);
}

console.log("\n1. A fresh rocket on the pad");
let P = loadPage(store);
check(P.run("flightTracked()") && P.run("flightVesselId") === "v2" && P.run("currentDesign.name") === "Starting rocket", "the flight opens the active vessel (v2) from the universe");
P.menu();
check(P.button("Back to builder").disabled && /touching the ground/.test(P.notes().join()), "the very first moment: it has not touched the ground yet, so it cannot be left, and the menu says so");
P.run("closeMenu()"); P.frames(240);
P.menu();
check(!P.button("Back to builder").disabled && !P.button("Revert to launch").disabled && P.button("Vessels"), "after a few seconds on the pad Back to builder and Revert are available, and there is a Vessels button");
P.run("closeMenu()");
P.run("fireStage()"); P.run("controls.throttle = 1"); P.frames(300);
P.menu();
check(P.button("Back to builder").disabled && /Can't leave: the throttle is on/.test(P.notes().join()) && !P.button("Revert to launch").disabled, "burning: Back to builder is greyed with the reason, Revert still works");
P.run("doBuilder()");
check(P.loc.href === "" && universeOf(store).vessels.find((v) => v.id === "v2").status !== "orbit", "pressing it anyway does nothing: the page does not move");
P.press(P.button("Vessels"));
check(P.rowButtons("Resume").length === 1 && P.rowButtons("Resume")[0].disabled && /has to be safe/.test(P.run("menuUi.box.children.map(c => c.textContent).join('|')")), "the Vessels panel greys Resume while this rocket is burning");
P.run("showPanel('main')");
P.press(P.button("Revert to launch"));
check(P.run("sim.started") === false && P.run("controls.throttle") === 0 && universeOf(store).vessels.find((v) => v.id === "v2").state === null, "Revert to launch puts it back on the pad untouched, in the universe too");

console.log("\n2. Leaving");
P.frames(240); P.menu();
P.press(P.button("Back to builder"));
check(/^builder\.html/.test(P.loc.href) && !P.run("flightTracked()"), "once it is calm, Back to builder goes to the builder");
let v2 = universeOf(store).vessels.find((v) => v.id === "v2");
check(v2.status === "pad" && v2.revert === false && universeOf(store).activeId === "v2", "and the vessel is saved on the pad, can no longer be reverted, and is still the last one flown");

console.log("\n3. Coming back");
P = loadPage(store);
P.frames(240); P.menu();
check(P.button("Revert to launch").disabled && /has been left since/.test(P.notes().join()), "back in the flight: Revert is greyed, and says it has been left since");
check(!P.button("Back to builder").disabled, "a vessel that was safe when saved can be left again straight away");
P.press(P.button("Vessels"));
const text = () => P.run("menuUi.box.children").map((c) => c.textContent + c.children.map((d) => d.textContent + d.children.map((x) => x.textContent).join("/")).join("/")).join("|");
check(/Parked/.test(text()) && /In orbit, 120 km by 120 km/.test(text()) && /This flight/.test(text()), "the Vessels panel lists the parked vessel in orbit and marks this one as this flight");
P.ctx.__confirm = false;
check(P.rowButtons("Resume").length === 1 && P.rowButtons("Scrap").length === 1 && !P.rowButtons("Resume")[0].disabled, "one Resume (usable, since this rocket is safe to leave) and one Scrap, for the other vessel only");

console.log("\n4. Switching");
P.press(P.rowButtons("Resume")[0]);
check(P.loc.href === "index.html" && universeOf(store).activeId === "v1" && universeOf(store).vessels.find((v) => v.id === "v2").revert === false, "switching makes the parked vessel the active one and goes to the flight page");
P = loadPage(store);
const pos = P.run("sim.hull.body.getPosition()"), vel = P.run("sim.hull.body.getLinearVelocity()");
check(P.run("flightVesselId") === "v1" && Math.abs(pos.y - (600000 + 120000)) < 1e-6 && Math.abs(vel.x - Math.sqrt(P.run("MU") / 720000)) < 1e-6, "the page opens the parked vessel in its orbit, 120 km up at orbital speed");
P.menu();
check(!P.button("Back to builder").disabled && P.button("Revert to launch").disabled, "it can be left again right away (it is in a good orbit), and it cannot be reverted");
P.frames(120); P.run("closeMenu()");
const pos2 = P.run("sim.hull.body.getPosition()");
check(Math.abs(Math.hypot(pos2.x, pos2.y) - 720000) < 1, "and it stays in its circular orbit as the game runs");
P.press(P.button("Vessels"));
P.ctx.__confirm = false; P.press(P.rowButtons("Scrap")[0]);
check(universeOf(store).vessels.length === 2, "Scrap asks first: no keeps the vessel");
P.ctx.__confirm = true; P.press(P.rowButtons("Scrap")[0]);
check(universeOf(store).vessels.length === 1 && universeOf(store).vessels[0].id === "v1", "yes scraps the other vessel for good (v2); the one being flown stays");

console.log("\n5. Closing the tab mid-flight");
P = loadPage(store);
P.run("controls.throttle = 1"); P.run("fireStage()"); P.frames(200);
P.fire("pagehide");
const saved = universeOf(store).vessels[0];
check(saved.status === "flying" && saved.state.throttle === 1 && saved.revert === false, "closing the tab while burning saves it as it is: flying, throttle on");
P = loadPage(store);
check(P.run("flightTracked()") && P.run("controls.throttle") === 1 && P.run("sim.started"), "reopening resumes the burn where it was");
P.menu();
check(P.button("Back to builder").disabled, "and it still cannot be left while it is burning");
check(/was left mid-flight/.test(P.run("universeLaunchBlock(universeLoad().universe)")), "meanwhile the builder would refuse a new launch: a rocket was left mid-flight");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
