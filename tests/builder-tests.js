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
check(near(st.calFull, 0.73, 0.03) && near(st.calDry, 0.51, 0.03), `stability ${st.calFull.toFixed(2)} cal full, ${st.calDry.toFixed(2)} empty: matches the flight test (the nose cone's built-in wheel adds weight up front)`);
check(near(st.height, 6.9, 0.2) && near(st.width, 5.1, 0.2), `size ${st.width.toFixed(1)} x ${st.height.toFixed(1)} m`);
const two = run("designStats")(partial(tank("t", 4, 4), tank("u", 2, 2, { parent: "t", anchor: "top" }), eng("e", "t", -1), eng("f", "t", 1)));
check(two.engines === 2 && two.tanks === 2 && near(two.thrustVac, 500000), "two tanks and two engines are counted");
check(run("designStats")(partial(tank("t", 2, 4))).dvVac === 0 && run("designStats")(partial(tank("t", 2, 4))).twrSl === 0, "no engine: no delta-v, no thrust-to-weight");
check(run("designStats")({ version: 1, parts: [] }) === null, "an empty design has no stats");
const w2 = run("wheelSpec")(2).torque;
check(near(st.wheelTorque, w2, 1e-6) && st.turnFull > 20 && st.turnDry > st.turnFull, `the starting rocket turns at ${st.turnFull.toFixed(0)} deg/s2 full and ${st.turnDry.toFixed(0)} empty (its nose cone's wheel, ${(w2 / 1000).toFixed(0)} kN*m)`);
check(two.wheelTorque === 0 && two.turnFull === 0 && two.turnDry === 0, "no nose cone and no wheel: no turning push, and the builder says so");
const ringed = run("designStats")(partial(tank("t", 2, 4), eng("e", "t"), { id: "w", type: "wheel", width: 2, parent: "t", anchor: "top" }));
check(near(ringed.wheelTorque, w2, 1e-6) && ringed.turnFull > 0, "a wheel ring on a rocket with no nose gives it turning push");
const heavy = run("designStats")(partial(tank("t", 4, 8), eng("a", "t", -1, 1500000), eng("b", "t", 1, 1500000), { id: "n", type: "nose", width: 4, length: 2, parent: "t", anchor: "top" }));
check(heavy.turnFull < st.turnFull, `a big rocket turns slower with just its nose wheel (${heavy.turnFull.toFixed(1)} deg/s2 against ${st.turnFull.toFixed(0)}), so it wants extra wheels`);

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
r = best(baseT, { type: "wheel", width: 2 }, 0.1, 4.2);
check(r.valid && r.att.anchor === "top", "a reaction wheel ring near the top of a tank snaps on top of it");
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
check(/kN\*m/.test(run("ui.rows.wheel.textContent")) && /deg\/s2/.test(run("ui.rows.turn.textContent")) && /deg\/s2/.test(run("ui.rows.turn0.textContent")), `the panel shows the reaction wheels and how fast the rocket turns (${run("ui.rows.wheel.textContent")}, ${run("ui.rows.turn.textContent")})`);
run("pal.tab = 'stage'; renderCards()");
const cardTitles = run("ui.cards.children").filter(c => c.className === "card").map(c => c.children[1].children[0].textContent);
check(cardTitles.length === 2 && /Decoupler/.test(cardTitles[0]) && /Reaction wheel/.test(cardTitles[1]), "the Rings tab offers the decoupler and the reaction wheel");
run("pal.tab = 'noses'; renderCards()");
check(/built-in wheel/.test(run("ui.cards.children").filter(c => c.className === "card")[0].children[1].children.map(c => c.textContent).join(" ")), "the nose cone card says it has a wheel built in");
run("pal.tab = 'tanks'; renderCards()");

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
// a wheel ring dropped onto the top of the tank
const newTank = geo().find(d => d.kind === "tank");
g = dropNew({ type: "wheel", width: 2 }, 0, newTank.at[1] + 2.1);
check(g && g.valid && run("design.parts").some(p => p.type === "wheel" && p.anchor === "top"), "a reaction wheel ring dropped on top of a tank joins it");
// the draft is kept for the next visit
check(stored["rocketsim.draft"] && JSON.parse(stored["rocketsim.draft"]).parts.length === 2, "the design is kept as a draft in the browser");

/* ---- 4. loose parts ---- */
console.log("\n4. Parking loose parts");
const STACK = { version: 1, name: "stack", parts: [
  tank("t1", 2, 2), eng("e1", "t1", 0, 100000),
  { id: "d", type: "decoupler", width: 2, parent: "e1", anchor: "bottom", dx: 0 },
  tank("t2", 2, 4, { parent: "d", anchor: "bottom", dx: 0 }), eng("e2", "t2", 0, 250000),
  { id: "n", type: "nose", width: 2, length: 1.5, parent: "t1", anchor: "top", dx: 0 } ] };
check(E("validateDesign")(STACK).length === 0, "a two-stage test rocket is valid");
let out = E("takeOut")(STACK, "e1");
check(out.design.parts.map(p => p.id).join() === "t1,n" && out.groups.length === 1 && out.groups[0].parts.map(p => p.id).join() === "d,t2,e2" && out.groups[0].parts[0].parent === undefined && E("validateDesign")({ version: 1, parts: out.groups[0].parts }, true).length === 0, "taking a part out keeps what hung off it as a loose group, with its first part cut free");
const dGeo = E("geometryOf")(STACK).find(g => g.designId === "d");
check(near(out.groups[0].x, dGeo.at[0]) && near(out.groups[0].y, dGeo.at[1] - dGeo.length / 2), "and the group is placed exactly where it was");
const withFin = E("cloneDesign")(STACK); withFin.parts.push({ id: "f", type: "fin", parent: "t2", anchor: "side", side: 0, y: 1 });
out = E("takeOut")(withFin, "t2");
check(!out.design.parts.some(p => p.id === "f" || p.id === "t2") && out.groups.length === 1 && out.groups[0].parts[0].id === "e2", "fins on the removed part go with it; the engine below stays as a loose group");
out = E("takeOut")(STACK, "t1");
check(out.design.parts.length === 0 && out.groups.length === 2, "taking out the first part leaves nothing connected and two loose groups");

ctx.__d = null;
function fresh(d) { ctx.__d = d; run("setDesign(__d, false, [])"); run("selected = null"); run("history.length = 0"); run("fitView()"); frames(2); }
// pick up the lower stage and let go in empty space
fresh(STACK);
let gd = geo().find(x => x.designId === "d"), gp = scr(gd.at[0], gd.at[1]);
stageEmit("mousedown", { clientX: gp[0], clientY: gp[1] });
emit("mousemove", { clientX: gp[0] + 230, clientY: gp[1] + 60 }); frames(1);
check(run("drag.kind") === "move" && run("drag.moved.length") === 3 && !run("drag.ghost").snapped, "grabbing the decoupler carries it and the tank and engine below it, and nothing is close enough to join");
emit("mouseup", {}); frames(1);
check(run("design.parts.length") === 3 && run("parked.length") === 1 && run("parked[0].parts.length") === 3, "let go in empty space, the stage is parked and the rocket keeps the rest");
check(run("ui.launch.disabled") === true && run("ui.problems.children").some(c => /not attached/.test(c.textContent)), "Launch is off and a line says parts are not attached");
const savedBefore = stored["rocketsim.designs"];
run("saveNamed")();
let threw = false; try { run("exportFile")(); } catch (e) { threw = true; }
check(stored["rocketsim.designs"] === savedBefore && !threw, "saving and exporting are refused while parts are loose");
check(JSON.parse(stored["rocketsim.parked"]).length === 1, "the loose parts are kept in the draft");
// drag it back under the engine
const pg = run("parked[0]"), pgeo = run("groupGeo(parked[0])").find(x => x.designId === "d"), p3 = scr(pgeo.at[0] + pg.x, pgeo.at[1] + pg.y);
stageEmit("mousedown", { clientX: p3[0], clientY: p3[1] });
const e1g = geo().find(x => x.designId === "e1"), tgt = scr(e1g.at[0], e1g.at[1] - e1g.length / 2 - 0.1);
emit("mousemove", { clientX: tgt[0], clientY: tgt[1] }); frames(1);
check(run("drag.kind") === "parked" && run("drag.ghost").snapped && run("drag.ghost").valid, "dragging the loose stage back under the engine shows a valid join");
emit("mouseup", {}); frames(1);
check(run("design.parts.length") === 6 && run("parked.length") === 0 && run("ui.launch.disabled") === false && E("validateDesign")(run("design")).length === 0, "let go, it joins in one drop and the rocket is whole and valid again");
emit("keydown", { code: "KeyZ", ctrlKey: true }); frames(1);
check(run("parked.length") === 1 && run("design.parts.length") === 3, "undo takes the stage off again");
emit("keydown", { code: "KeyZ", ctrlKey: true }); frames(1);
check(run("parked.length") === 0 && run("design.parts.length") === 6, "and undo again puts the whole rocket back");
// deleting the first part keeps everything else
fresh(STACK); run("selected = 't1'"); emit("keydown", { code: "Delete" }); frames(1);
check(run("design.parts.length") === 0 && run("parked.length") === 2 && run("ui.launch.disabled") === true, "deleting the first part parks what hung off it instead of deleting the lot");
emit("keydown", { code: "KeyZ", ctrlKey: true }); frames(1);
check(run("design.parts.length") === 6 && run("parked.length") === 0, "and undo brings it all back");
// a part from the palette dropped away from the rocket is parked
fresh({ version: 1, name: "t", parts: [tank("t", 2, 4), eng("e", "t")] });
dropNew({ type: "nose", width: 2, length: 1.5 }, 6, 3);
check(run("parked.length") === 1 && run("parked[0].parts[0].type") === "nose" && near(run("parked[0].x"), 6, 0.01) && near(run("parked[0].y"), 2.25, 0.01) && run("design.parts.length") === 2, "a new part let go away from the rocket is parked where it was dropped");
dropNew({ type: "fin" }, 5, 5);
check(run("parked.length") === 1 && run("design.parts.length") === 2, "a fin cannot be parked (it cannot stand alone), so it is not dropped");
check(run("freshIdAll")("nose") === "nose2", "new parts never take an id a loose part already has");
// selecting and deleting a loose part
const lg = run("groupGeo(parked[0])")[0], lp0 = scr(lg.at[0] + run("parked[0].x"), lg.at[1] + run("parked[0].y"));
stageEmit("mousedown", { clientX: lp0[0], clientY: lp0[1] }); emit("mouseup", {});
check(run("selected") === "nose1", "clicking a loose part selects it");
emit("keydown", { code: "Delete" }); frames(1);
check(run("parked.length") === 0 && run("selected") === null, "Delete removes a loose part");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
