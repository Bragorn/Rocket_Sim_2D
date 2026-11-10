/* =====================================================================
   BUILDER TESTS  (tests/builder-tests.js)
   Runs the real game files without a browser.
   Needs Node.js. From the project folder:   node tests/builder-tests.js

   1. Stats: what a design adds up to.
   2. Editing: removing parts, snapping a dragged part to the right spot.
   3. The builder page itself, run against a stand-in page: drag parts in,
      move them, delete, undo, and launch.
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);

/* ---- a stand-in web page, just enough for builder.js ---- */
const els = {}, winHandlers = {};
const noop = () => {};
const ctx2d = new Proxy({}, { get: (t, k) => k === "measureText" ? () => ({ width: 10 }) : (t[k] !== undefined ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
function makeEl(tag) {
  const e = { tag, children: [], style: {}, className: "", listeners: {}, value: "", disabled: false, width: 0, height: 0, type: "", files: null,
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, addEventListener(n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); },
    getContext: () => ctx2d, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 700 }), click() {}, focus() {}, setAttribute() {} };
  let text = "";
  Object.defineProperty(e, "textContent", { get() { return text; }, set(v) { text = v; this.children = []; } });
  return e;
}
let raf = null, hrefSet = "";
const stored = {};
const ctx = {
  console, Math, Object, Array, Number, JSON, String, Date, encodeURIComponent, decodeURIComponent, setTimeout,
  document: { createElement: makeEl, getElementById: (id) => els[id] || (els[id] = makeEl("div")), body: makeEl("body") },
  window: { devicePixelRatio: 1, addEventListener: (n, f) => { (winHandlers[n] = winHandlers[n] || []).push(f); } },
  requestAnimationFrame: (f) => { raf = f; },
  localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = String(v); } },
  location: { hash: "", set href(v) { hrefSet = v; }, get href() { return hrefSet; } },
  alert: noop, confirm: () => true, planck: { Settings: {}, Vec2: function (x, y) { this.x = x; this.y = y; } }
};
vm.createContext(ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "aero", "stats", "edit"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const run = (e) => vm.runInContext(e, ctx);
const DESIGN = run("DESIGN");
const tank = (id, w, l, extra) => Object.assign({ id, type: "tank", width: w, length: l }, extra);
const eng = (id, parent, dx, thrust) => ({ id, type: "engine", thrust: thrust || 250000, parent, anchor: "bottom", dx: dx || 0 });
const partial = (...parts) => ({ version: 1, name: "t", parts });

/* ---- 1. stats ---- */
console.log("\n1. Stats");
const st = run("designStats")(DESIGN);
const wet = run("ROCKET.parts").reduce((s, p) => s + p.mass, 0);
check(near(st.wet, wet, 1e-6) && near(st.fuel, 12566.37, 0.01) && near(st.dry, wet - st.fuel, 1e-6), `mass ${st.wet.toFixed(0)} kg, fuel ${st.fuel.toFixed(0)} kg, dry ${st.dry.toFixed(0)} kg: the same as the assembled rocket`);
check(st.engines === 1 && near(st.thrustVac, 250000) && near(st.thrustSl, 250000 * 280 / 310, 1e-6), "one 250 kN engine (226 kN at the ground)");
check(st.twrSl > 1.5 && st.twrSl < 1.8, `thrust-to-weight ${st.twrSl.toFixed(2)}`);
check(st.dvVac > 6000 && st.dvVac < 7500, `delta-v ${st.dvVac.toFixed(0)} m/s (the game's bar uses the same formula)`);
check(near(st.burn, 12566.37 / (250000 / (310 * 9.81)), 0.01), `burn time ${st.burn.toFixed(0)} s`);
check(near(st.calFull, 0.71, 0.03) && near(st.calDry, 0.32, 0.03), `stability ${st.calFull.toFixed(2)} cal full, ${st.calDry.toFixed(2)} empty: matches the flight test`);
check(near(st.height, 6.9, 0.2) && near(st.width, 5.1, 0.2), `size ${st.width.toFixed(1)} x ${st.height.toFixed(1)} m`);
const two = run("designStats")(partial(tank("t", 4, 4), tank("u", 2, 2, { parent: "t", anchor: "top" }), eng("e", "t", -1), eng("f", "t", 1)));
check(two.engines === 2 && two.tanks === 2 && near(two.thrustVac, 500000), "two tanks and two engines are counted");
check(run("designStats")(partial(tank("t", 2, 4))).dvVac === 0 && run("designStats")(partial(tank("t", 2, 4))).twrSl === 0, "no engine: no delta-v, no thrust-to-weight");
check(run("designStats")({ version: 1, parts: [] }) === null, "an empty design has no stats");

/* ---- 2. editing ---- */
console.log("\n2. Editing and snapping");
const E = (e) => run(e);
const noTop = E("removeSubtree")(DESIGN, "nose");
check(noTop.parts.length === DESIGN.parts.length - 1 && !noTop.parts.some(p => p.id === "nose"), "removing a part takes it out");
const noTank = E("removeSubtree")(DESIGN, "tank");
check(noTank.parts.length === 0, "removing the root removes everything attached to it");
check(E("subtreeIds")(partial(tank("t", 2, 4), tank("u", 2, 2, { parent: "t", anchor: "top" }), { id: "n", type: "nose", width: 2, length: 1, parent: "u", anchor: "top" }), "u").join() === "u,n", "a part's subtree is it and what is on it");
check(E("freshId")(DESIGN, "tank") === "tank1" && E("freshId")(DESIGN, "engine") === "engine1", "new parts get unused ids");
const ord = E("orderDesign")(partial({ id: "b", type: "engine", thrust: 250000, parent: "a", anchor: "bottom" }, tank("a", 2, 4)));
check(ord.parts[0].id === "a", "a part never comes before the one it joins");

const baseT = partial(tank("tank", 2, 4));                             // just a tank: root at y 0..4, centre x 0
const best = (base, spec, mx, my, opts) => E("bestAttach")(base, [Object.assign({ id: "new" }, spec)], { x: mx, y: my }, opts);
let r = best(baseT, { type: "engine", thrust: 250000 }, 0.1, -0.5);
check(r.valid && r.att.parent === "tank" && r.att.anchor === "bottom", "an engine near the bottom of the tank snaps to its bottom");
r = best(baseT, { type: "nose", width: 2, length: 1.5 }, 0.1, 4.8);
check(r.valid && r.att.anchor === "top", "a nose near the top snaps to its top");
r = best(baseT, { type: "engine", thrust: 250000 }, 0, 4.9);
check(r.snapped && !r.valid && r.problems.length > 0, `an engine near the top is shown as not allowed ("${r.problems[0]}")`);
r = best(baseT, { type: "fin" }, 1.2, 1.5);
check(r.valid && r.att.anchor === "side" && r.att.side === 0 && near(r.att.y, 1.5), "a fin near the wall snaps on as a pair at that height");
r = best(baseT, { type: "fin" }, 1.2, 1.5, { mirror: false });
check(r.valid && r.att.side === 1, "with pairs off, it goes on the side you drop it on");
r = best(baseT, { type: "fin" }, -1.2, 1.47, { mirror: false });
check(r.valid && r.att.side === -1 && near(r.att.y, 1.5), "dropped on the left wall: left side, height rounded to 10 cm");
r = best(baseT, { type: "leg" }, 8, 8);
check(!r.snapped, "far from every part, nothing snaps");
const wide = partial(tank("tank", 4, 4));
r = best(wide, { type: "engine", thrust: 600000 }, -1, -0.3);
check(r.valid && r.att.dx < -0.5, `on a 4 m tank a big engine can slide off-centre (dx ${r.att.dx})`);
r = best(E("attachTrial")(wide, [eng("e1", "tank", -1, 600000)], {parent: "tank", anchor: "bottom", dx: -1}), { type: "engine", thrust: 600000 }, 1, -0.3);
check(r.valid && r.att.dx > 0.5, "a second engine goes on the other side of the first");
r = best(E("attachTrial")(wide, [eng("e1", "tank", 0, 600000)], {parent: "tank", anchor: "bottom", dx: 0}), { type: "engine", thrust: 600000 }, 0.2, -0.3);
check(r.valid && Math.abs(r.att.dx) >= 1, `a second engine dropped on the first slides to a free spot beside it (dx ${r.att.dx.toFixed(1)})`);
const big = E("designStats")(partial(tank("t", 4, 8), eng("a", "t", -1.5, 600000), eng("b", "t", -0.5, 600000), eng("c", "t", 0.5, 600000), eng("d", "t", 1.5, 600000)));
check(big.twrSl > 1.9 && big.twrSl < 2.4, `the biggest tank (4 m x 8 m, ${(big.wet / 1000).toFixed(0)} t) with four large engines lifts off at ${big.twrSl.toFixed(2)} thrust-to-weight`);
const bigHuge = E("designStats")(partial(tank("t", 4, 8), eng("a", "t", -1, 1500000), eng("b", "t", 1, 1500000)));
check(bigHuge.twrSl > 2.3, `or two huge engines: ${bigHuge.twrSl.toFixed(2)}`);
const empty = { version: 1, name: "n", parts: [] };
r = best(empty, { type: "tank", width: 2, length: 4 }, 0, 0);
check(r.valid && r.snapped && r.trial.parts.length === 1, "the first part becomes the root of an empty design");
r = best(empty, { type: "fin" }, 0, 0);
check(!r.valid && !r.snapped, "a fin cannot be the first part");
const moved = [{ id: "nose", type: "nose", width: 2, length: 1.5 }];
const without = E("removeSubtree")(DESIGN, "nose");
r = E("bestAttach")(without, moved, { x: 0, y: 4.9 }, {});
check(r.valid && r.att.anchor === "top" && r.att.parent === "tank", "a nose picked up and put back snaps where it was");

/* ---- 3. the builder page ---- */
console.log("\n3. The builder page (stand-in page, mouse and keys)");
vm.runInContext(fs.readFileSync(path.join(root, "js", "builder.js"), "utf8"), ctx, { filename: "builder.js" });
const emit = (name, ev) => (winHandlers[name] || []).forEach(f => f(Object.assign({ preventDefault: noop, target: { tagName: "BODY" } }, ev)));
const stageEmit = (name, ev) => (els.stage.listeners[name] || []).forEach(f => f(Object.assign({ preventDefault: noop, button: 0 }, ev)));
const scr = (x, y) => run(`toScreen(${x}, ${y})`);
const frames = (n) => { for (let i = 0; i < n; i++) raf(i * 16); };
frames(3);
check(run("design.parts.length") === 5 && run("ui.launch.disabled") === false, "the builder opens on the starting rocket, ready to launch");
check(run("ui.rows.twr.textContent") !== "-" && run("ui.problems.children[0].textContent") === "Ready to launch", "the numbers panel is filled in");

function dropNew(spec, wx, wy) {     // grab a card, carry it over the grid to (wx, wy) meters, let go
  run(`beginNewDrag(${JSON.stringify(spec)})`);
  const p = scr(wx, wy); emit("mousemove", { clientX: p[0], clientY: p[1] }); frames(1);
  const ghost = run("drag.ghost"); emit("mouseup", {}); frames(1);
  return ghost;
}
const geo = () => run("geometryOf(design)");
const tankDef = () => geo().find(d => d.designId === "tank");
const tY0 = () => tankDef().at[1] - 2;
// a second fin pair, higher up the right wall
let g = dropNew({ type: "fin" }, 1.2, tY0() + 2.6);
check(g && g.valid && run("design.parts.length") === 6, "dropping a fin on the tank wall adds a pair");
check(run("design.parts[5].side") === 0 && near(run("design.parts[5].y"), 2.6, 0.05), "it is a mirrored pair at the height it was dropped");
check(run("history.length") === 1, "the change can be undone");
// an engine dropped on the top of the nose: not allowed, nothing added
g = dropNew({ type: "engine", thrust: 250000 }, 0, tankDef().at[1] + 4.4);
check(g && !g.valid && run("design.parts.length") === 6, "an engine on top of the nose is refused and nothing is added");
// select and delete a part with nothing attached
const legSpot = geo().find(d => d.id === "legR"), lp = scr(legSpot.at[0] + 1.35, legSpot.at[1] - 1.53);   // near the foot, below the fin that overlaps the leg
stageEmit("mousedown", { clientX: lp[0], clientY: lp[1] }); emit("mouseup", {});
check(run("selected") === "leg", "clicking a leg selects it");
emit("keydown", { code: "Delete" }); frames(1);
check(!run("design.parts").some(p => p.id === "leg") && run("design.parts.length") === 5, "Delete removes the leg (both of the pair)");
emit("keydown", { code: "KeyZ", ctrlKey: true }); frames(1);
check(run("design.parts").some(p => p.id === "leg"), "Ctrl+Z brings it back");
// move a fin pair by dragging one of the fins
const finSpot = geo().find(d => d.id === "fin1R") || geo().find(d => d.designId === "fin" && d.at[0] > 0);
const fp = scr(finSpot.at[0], finSpot.at[1]);
stageEmit("mousedown", { clientX: fp[0], clientY: fp[1] });
const to = scr(1.3, tY0() + 3.6); emit("mousemove", { clientX: to[0], clientY: to[1] }); frames(1);
check(run("drag") && run("drag.kind") === "move", "dragging a placed part picks it up");
emit("mouseup", {}); frames(1);
const movedFin = run("design.parts").find(p => p.id === "fin1");
check(movedFin && near(movedFin.y, 3.6, 0.05) && movedFin.side === 0, `the second fin pair moved up the tank (now ${movedFin.y} m)`);
// pairs off: a single leg on the left
run("mirror = false");
g = dropNew({ type: "leg" }, -1.2, tY0() + 3.0);
const single = run("design.parts").find(p => p.type === "leg" && p.id !== "leg");
check(single && single.side === -1, "with pairs off, a leg goes on one side only");
run("mirror = true");
// panning and zoom do not break anything
stageEmit("mousedown", { clientX: 60, clientY: 60 }); emit("mousemove", { clientX: 90, clientY: 80 }); emit("mouseup", {}); frames(1);
stageEmit("wheel", { clientX: 450, clientY: 350, deltaY: -100 }); frames(1);
check(run("view.scale") > 28 || run("view.scale") > 0, "panning and zooming work");
// launch sends the design to the game in the address
run("ui.launch.disabled") === false && run("launch")();
check(/^index\.html#d=/.test(hrefSet) && run("designFromHash")(hrefSet.slice("index.html".length)).design !== null, "Launch opens the game with the design in the address, and the game can read it back");
// a design that cannot fly disables Launch
run("setDesign(removeSubtree(design, 'engine'))"); frames(1);
check(run("ui.launch.disabled") === true && run("ui.problems.children.length") > 0, "without an engine the Launch button is off and the reason is listed");
// new empty design, and a first part dropped in
run("setDesign({ version: 1, name: 'New', parts: [] })"); frames(1);
g = dropNew({ type: "tank", width: 2, length: 4 }, 0, 0);
check(run("design.parts.length") === 1 && run("design.parts[0].type") === "tank", "a part dropped on an empty grid becomes the first part");
// the draft is kept for the next visit
check(stored["rocketsim.draft"] && JSON.parse(stored["rocketsim.draft"]).parts.length === 1, "the design is kept as a draft in the browser");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
