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
P.run("mapMode = false; toggleMap()");
check(isFinite(P.run("mapS")), "the map opens with a real scale even before the rocket has moved at all (this used to be NaN and freeze the game)");
P.run("toggleMap()");
P.menu();
check(!P.button("Back to builder").disabled && /has not flown: it goes back to the builder with you/.test(P.notes().join()), "the very first moment, untouched: Back to builder is available, and the menu says the rocket goes back with you");
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
check(/^builder\.html#d=/.test(P.loc.href) && !P.run("flightTracked()"), "an untouched rocket: Back to builder goes to the builder, with the design in the address");
check(universeOf(store).vessels.length === 1 && universeOf(store).vessels[0].id === "v1" && universeOf(store).activeId === null, "and the rocket is off the pad and out of the universe, as if it had never been launched (only the parked vessel is left)");
{ const g = loadPage(store); const add = g.run("universeAddVessel")(g.run("universeLoad")().universe, g.run("DESIGN"), "Second"); g.run("universeSave")(add.universe); }   // the builder launches it again: v3
P = loadPage(store);
check(P.run("flightVesselId") === "v3", "launching again from the builder puts a new vessel (v3) on the pad");
P.run("fireStage()"); P.frames(240); P.menu();
P.press(P.button("Back to builder"));
check(/^builder\.html/.test(P.loc.href) && !P.run("flightTracked()"), "a rocket that has fired its stage and is calm on the pad: Back to builder goes to the builder");
let v3 = universeOf(store).vessels.find((v) => v.id === "v3");
check(v3.status === "pad" && v3.state !== null && v3.revert === false && universeOf(store).activeId === "v3", "and this one is kept on the pad, can no longer be reverted, and is still the last one flown");

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
check(P.loc.href === "index.html" && universeOf(store).activeId === "v1" && universeOf(store).vessels.find((v) => v.id === "v3").revert === false, "switching makes the parked vessel the active one and goes to the flight page");
P = loadPage(store);
const pos = P.run("sim.hull.body.getPosition()"), vel = P.run("sim.hull.body.getLinearVelocity()");
{
  const u = universeOf(store), parked = u.vessels.find((v) => v.id === "v1"), gone = u.clock - parked.epoch;      // how long it has been left, on the universe clock
  const C = Math.sqrt(P.run("MU") / 720000), want = P.run("railsStateAt")({ pos: { x: 0, y: 720000 }, vel: { x: C, y: 0 }, angle: 0, angVel: 0, fuel: {}, stageNext: 0 }, gone);
  check(gone > 5 && P.run("flightVesselId") === "v1" && Math.abs(pos.x - want.pos.x) < 1e-3 && Math.abs(pos.y - want.pos.y) < 1e-3 && Math.abs(vel.x - want.vel.x) < 1e-6 && Math.abs(Math.hypot(pos.x, pos.y) - 720000) < 1e-3, "the page opens the parked vessel " + gone.toFixed(0) + " s on from where it was left: round its orbit by the time that has passed, still 120 km up at orbital speed");
}
P.menu();
check(!P.button("Back to builder").disabled && P.button("Revert to launch").disabled, "it can be left again right away (it is in a good orbit), and it cannot be reverted");
P.frames(120); P.run("closeMenu()");
const pos2 = P.run("sim.hull.body.getPosition()");
check(Math.abs(Math.hypot(pos2.x, pos2.y) - 720000) < 1, "and it stays in its circular orbit as the game runs");
P.press(P.button("Vessels"));
P.ctx.__confirm = false; P.press(P.rowButtons("Scrap")[0]);
check(universeOf(store).vessels.length === 2, "Scrap asks first: no keeps the vessel");
P.ctx.__confirm = true; P.press(P.rowButtons("Scrap")[0]);
check(universeOf(store).vessels.length === 1 && universeOf(store).vessels[0].id === "v1", "yes scraps the other vessel for good (v3); the one being flown stays");

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

console.log("\n6. The map, and a bad frame");
P = loadPage(store);
P.run("sim.hull.body.setLinearVelocity(new planck.Vec2(0, 0)); sim.hull.body.setAngularVelocity(0)");
P.run("toggleMap()");
check(P.run("mapMode") && isFinite(P.run("mapS")), "the map opens for a rocket sitting at rest on the ground");
P.frames(5);
check(P.run("mapMode") === true, "and stays open while the game runs");
P.ctx.console.error = () => {};                      // (the game reports the bad frame with console.error, which would only clutter this test's output)
P.run("var __draws = 0; draw = function () { __draws++; throw new Error('boom'); };");
let threw = false; try { P.frames(4); } catch (e) { threw = true; }
check(!threw && P.run("__draws") === 4 && P.run("mapMode") === false, "a frame that cannot be drawn does not stop the game: it keeps running, and the map is closed");

console.log("\n7. The other vessels on the map");
const store7 = fakeStore();
{
  const g = loadPage(store7), R = g.run("R"), C = Math.sqrt(g.run("MU") / (R + 120000));
  let u = g.run("universeNew()");
  const a = g.run("universeAddVessel")(u, g.run("DESIGN"), "Parked");
  u = g.run("universeUpdateVessel")(a.universe, a.id, { status: "orbit", revert: false, epoch: 0, state: { pos: { x: 0, y: R + 120000 }, vel: { x: C, y: 0 }, angle: 0, angVel: 0, fuel: {}, stageNext: 0 } }).universe;
  const b = g.run("universeAddVessel")(u, g.run("DESIGN"), "Outpost");
  u = g.run("universeUpdateVessel")(b.universe, b.id, { status: "landed", revert: false, epoch: 0, state: { pos: { x: R * Math.sin(8000 / R), y: R * Math.cos(8000 / R) }, vel: { x: 0, y: 0 }, angle: -8000 / R, angVel: 0, fuel: {}, stageNext: 0 } }).universe;
  const c = g.run("universeAddVessel")(u, g.run("DESIGN"), "Mine");
  g.run("universeSave")(c.universe);
}
P = loadPage(store7);
P.run("toggleMap()"); P.frames(2);
check(P.run("mapMarkers.length") === 2 && P.run("mapMarkers.map(m => m.id).sort().join()") === "v1,v2", "on the map the two other vessels are marked (the one being flown is the arrow, not a marker)");
check(P.run("mapVesselsExtent()") >= 720000, "the map is zoomed out far enough to take in the orbit of the one in orbit");
const p1 = P.run("mapVesselPos(mapOthers.vessels.find(v => v.id === 'v1'))");
P.frames(300);
const p2 = P.run("mapVesselPos(mapOthers.vessels.find(v => v.id === 'v1'))");
check(Math.hypot(p2.x - p1.x, p2.y - p1.y) > 5000 && Math.abs(Math.hypot(p2.x, p2.y) - 720000) < 1, "the one in orbit moves round its orbit as the game runs (" + (Math.hypot(p2.x - p1.x, p2.y - p1.y) / 1000).toFixed(1) + " km in about 5 s), staying 120 km up");
const m1 = P.run("mapMarkers.find(m => m.id === 'v1')");
check(P.run("mapMouseDown")(m1.x + 3, m1.y - 2) === true && P.run("mapSelected") === "v1", "clicking its marker selects it");
P.frames(1);
check(P.run("mapButtons.length") === 1, "the panel offers a Switch button: this rocket is untouched on the pad, so it can be left");
const info = P.run("mapPanelInfo(mapOthers.vessels.find(v => v.id === 'v1'), flightCanLeave())");
check(info.title === "Parked" && /In orbit, 120 km by 120 km/.test(info.where) && info.canSwitch && info.reasons.length === 0, "and says what it is");
P.run("mapSelected = 'v1'"); P.frames(1);
const bt = P.run("mapButtons[0]");
P.run("mapMouseDown")(bt.x + 4, bt.y + 4);
check(P.loc.href === "index.html" && universeOf(store7).activeId === "v1" && universeOf(store7).vessels.find((v) => v.id === "v3").status === "pad", "pressing Switch leaves this rocket (kept on the pad) and makes the other vessel the active one");
// the landed one
P = loadPage(store7);
P.run("toggleMap()"); P.frames(2);
check(P.run("mapMarkers.map(m => m.id).sort().join()") === "v2,v3", "from the parked vessel's flight: the landed outpost and the rocket on the pad are the others");
const m2 = P.run("mapMarkers.find(m => m.id === 'v2')");
P.run("mapMouseDown")(m2.x, m2.y);
check(P.run("mapPanelInfo(mapOthers.vessels.find(v => v.id === 'v2'), flightCanLeave())").where === "Landed, 8.0 km from the pad", "a landed vessel is described as landed, with how far from the pad");
// can't switch while burning
P.run("toggleMap()"); P.run("fireStage()"); P.run("controls.throttle = 1"); P.frames(120);
P.run("toggleMap()"); P.frames(2);
const m3 = P.run("mapMarkers.find(m => m.id === 'v2')");
P.run("mapMouseDown")(m3.x, m3.y); P.frames(1);
const refused = P.run("mapPanelInfo(mapOthers.vessels.find(v => v.id === 'v2'), flightCanLeave())");
check(P.run("mapButtons.length") === 0 && !refused.canSwitch && /throttle is on/.test(refused.reasons.join()), "while this rocket is burning there is no Switch button, and the panel says why (the throttle is on)");
check(P.run("mapMouseDown")(m3.x + 300, m3.y + 300) === true && P.run("mapSelected") === null, "clicking empty map clears the selection");
P.run("toggleMap()");
P.run("toggleMap()");
check(P.run("mapSelected") === null, "and opening the map afresh starts with nothing selected");
// a free test flight can see the vessels too
{
  const free = loadPage(store7);
  free.run("flightDetach()"); free.run("mapMode = false; toggleMap()"); free.frames(2);
  check(free.run("mapMarkers.length") >= 2, "a test flight (not kept) also sees the vessels of the universe");
}

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
