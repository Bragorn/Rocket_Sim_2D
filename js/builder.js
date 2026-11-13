"use strict";

/* =====================================================================
   BUILDER  (js/builder.js)
   The builder page: a palette of parts on the left (tabs), the grid in the
   middle, the rocket's numbers and the buttons on the right. Dragging,
   snapping and checking are in edit.js and design.js; this file is the screen.
   Rocket coordinates: x right, y up, in meters; the first part's bottom is at y = 0.
   ===================================================================== */

const stage = document.getElementById("stage"), sc = stage.getContext("2d");
const leftEl = document.getElementById("left"), rightEl = document.getElementById("right");

let design = null;                   // the design being built (replaced, never edited in place)
let history = [];                    // earlier designs, for undo
let selected = null;                 // id of the selected part
let hover = null;                    // id of the part under the mouse
let drag = null;                     // a part being carried: { kind: "new" | "move", moved, base, ghost, hide }
let pan = null;                      // dragging the view: { x, y }
let pending = null;                  // mouse pressed on a placed part, may turn into a move
let mirror = true;                   // fins and legs go in pairs
let view = { cx: 0, cy: 3, scale: 28 };   // the middle of the screen in meters, and pixels per meter
let W = 100, H = 100;
const mouse = { px: 0, py: 0, inside: false };
const pal = { tab: "tanks", tankW: 2, tankL: 4, noseW: 2, noseL: 1.5, legDrop: 2, decW: 2 };
const ui = { rows: {} };
const stageUi = { targets: [], chips: {}, shown: undefined };   // the staging bar: drop targets, the chips by part id, which part is shown selected
let stageDrag = null;                // a chip being dragged: { id, x, y, moved, hot }
const stagingEl = document.getElementById("staging");
function withStages(d) { return Object.assign({}, d, { stages: stagesOf(d) }); }   // the design with its staging list cleaned up

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
const fmtKg = (kg) => kg >= 1000 ? (kg / 1000).toFixed(1) + " t" : Math.round(kg) + " kg";
const fmtCal = (c) => c === null ? "-" : c.toFixed(2) + " cal";

/* ---- view ---- */
function toScreen(x, y) { return [W / 2 + (x - view.cx) * view.scale, H / 2 - (y - view.cy) * view.scale]; }
function toWorld(px, py) { return { x: view.cx + (px - W / 2) / view.scale, y: view.cy - (py - H / 2) / view.scale }; }

function resize() {
  const r = stage.getBoundingClientRect(), k = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  stage.width = Math.floor(W * k); stage.height = Math.floor(H * k);
  sc.setTransform(k, 0, 0, k, 0, 0);
}

let stKey = null, stVal = null;
function statsOf(d) { if (stKey !== d) { stKey = d; stVal = designStats(d); } return stVal; }

let geoKey = null, geoVal = null;
function geoOf(d) { if (geoKey !== d) { geoKey = d; geoVal = geometryOf(d); } return geoVal; }

function fitView() {
  const g = design.parts.length ? geoOf(design) : [];
  let x0 = -2, x1 = 2, y0 = 0, y1 = 6;
  if (g.length) { x0 = Infinity; x1 = -Infinity; y0 = Infinity; y1 = -Infinity; }
  for (const def of g) for (const v of def.verts) { x0 = Math.min(x0, def.at[0] + v[0]); x1 = Math.max(x1, def.at[0] + v[0]); y0 = Math.min(y0, def.at[1] + v[1]); y1 = Math.max(y1, def.at[1] + v[1]); }
  view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
  view.scale = Math.max(10, Math.min(60, Math.min((W - 120) / Math.max(1, x1 - x0), (H - 120) / Math.max(1, y1 - y0))));
}

/* ---- the design ---- */
function setDesign(d, record) {
  if (record !== false) { history.push(JSON.stringify(design)); if (history.length > 60) history.shift(); }
  design = withStages(d);
  if (selected && !partById(design, selected)) selected = null;
  try { localStorage.setItem("rocketsim.draft", JSON.stringify(design)); } catch (e) { /* storage blocked: fine */ }
  refresh();
}

function undo() {
  if (!history.length) return;
  design = JSON.parse(history.pop());
  if (selected && !partById(design, selected)) selected = null;
  refresh();
}

function removeSelected() {
  if (!selected) return;
  const n = subtreeIds(design, selected).length;
  if (n > 1 && !confirm("Remove this part and the " + (n - 1) + " attached to it?")) return;
  setDesign(removeSubtree(design, selected));
}

/* ---- the numbers panel ---- */
const STAT_ROWS = [["parts", "Parts"], ["size", "Size"], ["mass", "Mass (full)"], ["dry", "Dry mass"], ["fuel", "Fuel"], ["engines", "Engines"],
                   ["twr", "Thrust / weight"], ["dv", "Delta-v (vac)"], ["burn", "Burn time"], ["stab", "Stability (full)"], ["stab0", "Stability (empty)"]];

function buildRight() {
  rightEl.appendChild(el("div", "sec", "Rocket"));
  const pad = el("div", "pad");
  ui.name = el("input"); ui.name.type = "text"; ui.name.maxLength = 40;
  ui.name.addEventListener("input", function () { design = Object.assign({}, design, { name: ui.name.value }); try { localStorage.setItem("rocketsim.draft", JSON.stringify(design)); } catch (e) { /* ok */ } });
  pad.appendChild(ui.name); rightEl.appendChild(pad);
  for (const r of STAT_ROWS) {
    const row = el("div", "row"); row.appendChild(el("span", "k", r[1]));
    ui.rows[r[0]] = el("span", "v", "-"); row.appendChild(ui.rows[r[0]]); rightEl.appendChild(row);
  }
  rightEl.appendChild(el("div", "sec", "Check"));
  ui.problems = el("div", "box"); rightEl.appendChild(ui.problems);
  const go = el("div", "btns");
  ui.launch = el("button", "btn go", "Launch");
  ui.launch.addEventListener("click", launch);
  go.appendChild(ui.launch); rightEl.appendChild(go);

  rightEl.appendChild(el("div", "sec", "Designs"));
  const b1 = el("div", "btns");
  const bNew = el("button", "btn", "New"), bUndo = el("button", "btn", "Undo"), bFit = el("button", "btn", "Fit");
  bNew.addEventListener("click", function () { if (design.parts.length === 0 || confirm("Start a new, empty design?")) { setDesign({ version: 1, name: "New rocket", parts: [] }); selected = null; fitView(); } });
  bUndo.addEventListener("click", undo); bFit.addEventListener("click", fitView);
  for (const b of [bNew, bUndo, bFit]) b2(b, b1);
  rightEl.appendChild(b1);
  const b2row = el("div", "btns");
  const bSave = el("button", "btn", "Save"), bExp = el("button", "btn", "Export"), bImp = el("button", "btn", "Import");
  bSave.addEventListener("click", saveNamed); bExp.addEventListener("click", exportFile);
  ui.file = el("input"); ui.file.type = "file"; ui.file.accept = ".json,application/json"; ui.file.style.display = "none";
  ui.file.addEventListener("change", importFile);
  bImp.addEventListener("click", function () { ui.file.click(); });
  for (const b of [bSave, bExp, bImp]) b2(b, b2row);
  rightEl.appendChild(b2row); rightEl.appendChild(ui.file);
  const lp = el("div", "pad"); ui.saved = el("select"); lp.appendChild(ui.saved); rightEl.appendChild(lp);
  const b3 = el("div", "btns"); const bLoad = el("button", "btn", "Load"), bDel = el("button", "btn", "Delete");
  bLoad.addEventListener("click", loadNamed); bDel.addEventListener("click", deleteNamed);
  b2(bLoad, b3); b2(bDel, b3); rightEl.appendChild(b3);
  rightEl.appendChild(el("div", "sec", "Keys"));
  const k = el("div", "box", "Delete: remove the selected part\nCtrl/Cmd+Z: undo   F: fit the view\nWheel: zoom   Drag empty space: pan\nDrag a placed part to move it");
  k.style.whiteSpace = "pre-line"; k.style.color = "#8a98a3"; rightEl.appendChild(k);
}
function b2(b, parent) { b.type = "button"; parent.appendChild(b); }

function setText(row, text, cls) { ui.rows[row].textContent = text; ui.rows[row].className = "v" + (cls ? " " + cls : ""); }

function refresh() {
  ui.name.value = design.name || "";
  const st = statsOf(design), bad = design.parts.length ? validateDesign(design) : ["drop a part on the grid to start"];
  if (!st) { for (const r of STAT_ROWS) setText(r[0], "-"); }
  else {
    setText("parts", String(st.parts));
    setText("size", st.width.toFixed(1) + " x " + st.height.toFixed(1) + " m");
    setText("mass", fmtKg(st.wet)); setText("dry", fmtKg(st.dry)); setText("fuel", fmtKg(st.fuel));
    setText("engines", st.engines ? st.engines + " x  " + Math.round(st.thrustVac / 1000) + " kN (" + Math.round(st.thrustSl / 1000) + " at ground)" : "none", st.engines ? "" : "bad");
    setText("twr", st.engines ? st.twrSl.toFixed(2) : "-", st.engines ? (st.twrSl < 1 ? "bad" : st.twrSl < 1.3 ? "warn" : "good") : "");
    setText("dv", st.dvVac ? Math.round(st.dvVac) + " m/s" : "-", st.dvVac ? (st.dvVac > 3200 ? "good" : "warn") : "");
    setText("burn", st.burn ? Math.round(st.burn) + " s" : "-");
    const tone = (c) => c === null ? "" : c < 0 ? "bad" : c < 0.5 ? "warn" : "good";
    setText("stab", fmtCal(st.calFull), tone(st.calFull)); setText("stab0", fmtCal(st.calDry), tone(st.calDry));
  }
  ui.problems.textContent = "";
  if (bad.length === 0) { const d = el("div", "good", "Ready to launch"); ui.problems.appendChild(d); }
  else for (const m of bad) { const d = el("div", "bad", m); d.style.marginBottom = "3px"; ui.problems.appendChild(d); }
  if (bad.length === 0) for (const m of designWarnings(design)) { const d = el("div", "warn", m); d.style.marginBottom = "3px"; ui.problems.appendChild(d); }
  ui.launch.disabled = bad.length > 0;
  ui.saved.textContent = "";
  const names = Object.keys(savedDesigns());
  for (const n of names) { const o = el("option", "", n); o.value = n; ui.saved.appendChild(o); }
  if (!names.length) { const o = el("option", "", "(no saved designs)"); o.value = ""; ui.saved.appendChild(o); }
  renderStaging();
}

/* ---- the staging bar: the order engines light and decouplers let go. Row 1 fires first; Space fires one row in flight. ---- */
function syncStageSel() {
  stageUi.shown = selected;
  for (const id in stageUi.chips) stageUi.chips[id].className = "schip" + (id === selected ? " on" : "");
}

function renderStaging() {
  const box = stagingEl;
  box.textContent = "";
  stageUi.targets = []; stageUi.chips = {};
  const rows = stagesOf(design), st = design.parts.length ? statsOf(design) : null, plan = st ? st.stages : [];
  box.appendChild(el("div", "sec", "Staging"));
  box.appendChild(el("div", "hint", rows.length ? "Space fires one row in flight. Drag a part onto another row to fire it with that row, or into a gap to give it a row of its own." : "Engines and decouplers appear here."));
  const gap = function (i) { const g = el("div", "sgap"); box.appendChild(g); stageUi.targets.push({ el: g, kind: "gap", index: i, cls: "sgap" }); };
  gap(0);
  rows.forEach(function (row, i) {
    const r = el("div", "srow"), p = plan[i];
    r.appendChild(el("div", "shead", "Stage " + (i + 1) + (p && p.dv > 0 ? "   " + Math.round(p.dv) + " m/s   T/W " + p.twr.toFixed(1) : "")));
    for (const id of row) {
      const spec = partById(design, id), c = el("div", "schip", stageLabel(spec) + " : " + STAGEABLE[spec.type]);
      c.style.borderLeftColor = previewOf(spec).color;
      c.addEventListener("mousedown", function (e) { e.preventDefault(); stageDrag = { id: id, x: e.clientX, y: e.clientY, moved: false, hot: null }; });
      stageUi.chips[id] = c;
      r.appendChild(c);
    }
    box.appendChild(r);
    stageUi.targets.push({ el: r, kind: "row", index: i, cls: "srow" });
    gap(i + 1);
  });
  syncStageSel();
}

window.addEventListener("mousemove", function (e) {
  if (!stageDrag) return;
  if (Math.hypot(e.clientX - stageDrag.x, e.clientY - stageDrag.y) > 4) stageDrag.moved = true;
  if (!stageDrag.moved) return;
  let hot = null;
  for (const t of stageUi.targets) {
    const r = t.el.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { hot = t; if (t.kind === "gap") break; }   // a gap wins over the row beside it
  }
  stageDrag.hot = hot;
  for (const t of stageUi.targets) t.el.className = t.cls + (t === hot ? " hot" : "");
});

window.addEventListener("mouseup", function () {
  const d = stageDrag;
  stageDrag = null;
  if (!d) return;
  if (!d.moved) { selected = d.id; syncStageSel(); return; }       // a click just selects the part
  if (d.hot) {
    const next = restage(design, d.id, { kind: d.hot.kind, index: d.hot.index });
    if (JSON.stringify(next.stages) !== JSON.stringify(stagesOf(design))) { setDesign(next); return; }
  }
  refresh();
});

/* ---- buttons ---- */
function launch() {
  if (ui.launch.disabled) return;
  try { localStorage.setItem("rocketsim.draft", JSON.stringify(design)); } catch (e) { /* ok */ }
  location.href = "index.html" + designToHash(design);
}
function saveNamed() {
  const name = (design.name || "").trim() || "Untitled";
  if (saveDesign(name, design)) refresh(); else alert("This browser would not let me save. Use Export to keep a copy as a file.");
}
function loadNamed() {
  const d = savedDesigns()[ui.saved.value];
  if (!d) return;
  const bad = validateDesign(d, true);
  if (bad.length) { alert("That saved design has problems:\n" + bad.join("\n")); return; }
  setDesign(d); selected = null; fitView();
}
function deleteNamed() { if (ui.saved.value && confirm("Delete the saved design '" + ui.saved.value + "'?")) { deleteSavedDesign(ui.saved.value); refresh(); } }
function exportFile() {
  const blob = new Blob([designToText(design)], { type: "application/json" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ((design.name || "rocket").replace(/[^\w\- ]+/g, "").trim() || "rocket") + ".rocket.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}
function importFile() {
  const f = ui.file.files && ui.file.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = function () {
    const res = designFromText(String(r.result));
    if (res.design) { setDesign(res.design); selected = null; fitView(); } else alert("That file is not a usable design:\n" + res.problems.join("\n"));
    ui.file.value = "";
  };
  r.readAsText(f);
}

/* ---- the palette ---- */
const TABS = [["tanks", "Tanks"], ["engines", "Engines"], ["noses", "Noses"], ["side", "Fins/Legs"], ["stage", "Decoupler"]];

function thumb(def) {                // a small picture of a part
  const c = el("canvas"); c.width = 84; c.height = 84;
  const t = c.getContext("2d");
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const v of def.verts) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
  const k = Math.min(70 / Math.max(0.01, x1 - x0), 70 / Math.max(0.01, y1 - y0)), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  t.fillStyle = def.color; t.strokeStyle = "rgba(0,0,0,0.5)"; t.beginPath();
  def.verts.forEach(function (v, i) { const X = 42 + (v[0] - mx) * k, Y = 42 - (v[1] - my) * k; if (i === 0) t.moveTo(X, Y); else t.lineTo(X, Y); });
  t.closePath(); t.fill(); t.stroke();
  return c;
}

function previewOf(spec) {           // a part's definition, for the card
  const type = PART_TYPES[spec.type];
  return type.kind === "stack" ? type.make(spec) : type.make(spec, 1, { px: 0, half: 1, jy: 0, parent: { width: 2 } });
}

function card(spec, title, lines, controls) {
  const c = el("div", "card");
  const def = previewOf(spec);
  c.appendChild(thumb(def));
  const body = el("div");
  body.appendChild(el("div", "t", title));
  for (const l of lines) body.appendChild(el("div", "s", l));
  if (controls) body.appendChild(controls);
  c.appendChild(body);
  c.addEventListener("mousedown", function (e) {
    if (e.target && (e.target.tagName === "BUTTON")) return;      // the size buttons are not part of the grab
    e.preventDefault();
    beginNewDrag(spec);
  });
  return c;
}

function stepper(label, get, set, min, max, step, fmt) {
  const row = el("div", "ctl"); row.appendChild(el("span", "k", label));
  const minus = el("button", "chip", "-"), val = el("span", "val", fmt(get())), plus = el("button", "chip", "+");
  minus.type = plus.type = "button";
  minus.addEventListener("click", function () { set(Math.max(min, Math.round((get() - step) * 100) / 100)); renderCards(); });
  plus.addEventListener("click", function () { set(Math.min(max, Math.round((get() + step) * 100) / 100)); renderCards(); });
  row.appendChild(minus); row.appendChild(val); row.appendChild(plus);
  return row;
}
function choice(label, options, get, set, fmt) {
  const row = el("div", "ctl"); row.appendChild(el("span", "k", label));
  for (const o of options) {
    const b = el("button", "chip" + (get() === o ? " on" : ""), fmt(o)); b.type = "button";
    b.addEventListener("click", function () { set(o); renderCards(); });
    row.appendChild(b);
  }
  return row;
}
function wrap(...rows) { const d = el("div"); for (const r of rows) d.appendChild(r); return d; }

function renderStageCards() {
  ui.cards.textContent = "";
  const sp = decouplerSpec(pal.decW);
  ui.cards.appendChild(el("div", "hint", "A decoupler joins two body parts and lets go when its stage fires. To add a stage below, drop it under the engine (it has to be at least as wide as the engine), then build the next stage under it."));
  ui.cards.appendChild(card({ type: "decoupler", width: pal.decW }, "Decoupler " + pal.decW + " m", ["mass " + fmtKg(sp.mass), "separation push " + (sp.kick / 1000).toFixed(1) + " kN*s"],
    wrap(choice("Width", RULES.tankWidths, () => pal.decW, (v) => { pal.decW = v; }, (v) => v + " m"))));
}

function renderCards() {
  if (pal.tab === "stage") { renderStageCards(); return; }
  ui.cards.textContent = "";
  if (pal.tab === "tanks") {
    const sp = tankSpec(pal.tankW, pal.tankL);
    ui.cards.appendChild(el("div", "hint", "Pick a size, then drag the tank onto the grid."));
    ui.cards.appendChild(card({ type: "tank", width: pal.tankW, length: pal.tankL }, "Tank " + pal.tankW + " m x " + pal.tankL + " m",
      ["fuel " + fmtKg(sp.fuel), "dry mass " + fmtKg(sp.dry) + " (" + (sp.dry / sp.fuel * 100).toFixed(1) + "% of fuel)"],
      wrap(choice("Width", RULES.tankWidths, () => pal.tankW, (v) => { pal.tankW = v; }, (v) => v + " m"),
           stepper("Length", () => pal.tankL, (v) => { pal.tankL = v; }, RULES.gridM, RULES.tankMaxLength, RULES.gridM, (v) => v.toFixed(1) + " m"))));
  } else if (pal.tab === "engines") {
    ui.cards.appendChild(el("div", "hint", "Engines join the bottom of a body part. Big engines are wider: they need a wide enough tank above them."));
    const names = ["Small", "Medium", "Large", "Huge"];
    RULES.engineSizes.forEach(function (n, i) {
      const sp = engineSpec(n), d = engine(n);
      ui.cards.appendChild(card({ type: "engine", thrust: n }, names[i] + " engine " + Math.round(n / 1000) + " kN",
        ["width " + d.width.toFixed(2) + " m, mass " + fmtKg(sp.mass), "thrust " + Math.round(sp.sl / 1000) + " kN at ground", "efficiency " + RULES.ispSl + " s ground, " + RULES.ispVac + " s vacuum"]));
    });
  } else if (pal.tab === "noses") {
    const sp = noseSpec(pal.noseW, pal.noseL);
    ui.cards.appendChild(el("div", "hint", "A nose cone joins the top of a body part."));
    ui.cards.appendChild(card({ type: "nose", width: pal.noseW, length: pal.noseL }, "Nose cone " + pal.noseW + " m x " + pal.noseL + " m", ["mass " + fmtKg(sp.mass)],
      wrap(choice("Width", RULES.tankWidths, () => pal.noseW, (v) => { pal.noseW = v; }, (v) => v + " m"),
           stepper("Length", () => pal.noseL, (v) => { pal.noseL = v; }, RULES.gridM, RULES.noseMaxLength, RULES.gridM, (v) => v.toFixed(1) + " m"))));
  } else {
    ui.cards.appendChild(el("div", "hint", "Fins and legs hang on the side of a tank. Drag one along the tank to choose how high."));
    const m = el("div", "ctl"); const cb = el("button", "chip" + (mirror ? " on" : ""), mirror ? "Pairs: on" : "Pairs: off"); cb.type = "button";
    cb.addEventListener("click", function () { mirror = !mirror; renderCards(); });
    m.appendChild(cb); m.appendChild(el("span", "s", mirror ? "a fin or leg on both sides" : "one side only (the side you drop it on)"));
    ui.cards.appendChild(m);
    const fin = previewOf({ type: "fin" }), leg = previewOf({ type: "leg", drop: pal.legDrop });
    ui.cards.appendChild(card({ type: "fin" }, "Fin", ["mass " + fmtKg(fin.mass) + " each", "steers the rocket straight into the air"]));
    ui.cards.appendChild(card({ type: "leg", drop: pal.legDrop }, "Leg " + pal.legDrop.toFixed(1) + " m", ["mass " + fmtKg(leg.mass) + " each", "reaches " + pal.legDrop.toFixed(1) + " m below where it joins"],
      stepper("Length", () => pal.legDrop, (v) => { pal.legDrop = v; }, 1, 8, 0.5, (v) => v.toFixed(1) + " m")));
  }
}

function buildLeft() {
  const tabs = el("div", "tabs");
  ui.tabEls = {};
  for (const t of TABS) {
    const b = el("div", "tab" + (pal.tab === t[0] ? " on" : ""), t[1]);
    b.addEventListener("click", function () { pal.tab = t[0]; for (const k in ui.tabEls) ui.tabEls[k].className = "tab" + (pal.tab === k ? " on" : ""); renderCards(); });
    ui.tabEls[t[0]] = b; tabs.appendChild(b);
  }
  leftEl.appendChild(tabs);
  ui.cards = el("div"); ui.cards.id = "cards"; leftEl.appendChild(ui.cards);
  renderCards();
}

/* ---- dragging parts in ---- */
function beginNewDrag(spec) {
  const moved = [Object.assign({}, spec, { id: freshId(design, spec.type) })];
  drag = { kind: "new", moved: moved, base: design, ghost: null, mirror: mirror };
  selected = null;
  updateGhost();
}

function beginMove(id) {             // pick up a placed part together with everything attached to it
  const ids = subtreeIds(design, id), moved = ids.map(function (i) { return cloneDesign({ parts: [partById(design, i)] }).parts[0]; });
  const root = moved[0];
  drag = { kind: "move", moved: moved, base: removeSubtree(design, id), ghost: null, mirror: root.type && PART_TYPES[root.type].kind === "side" ? root.side === 0 : mirror };
  updateGhost();
}

function updateGhost() {
  if (!drag) return;
  if (!mouse.inside) { drag.ghost = null; return; }
  const w = toWorld(mouse.px, mouse.py);
  try { drag.ghost = bestAttach(drag.base, drag.moved, w, { mirror: drag.mirror, radius: Math.max(1.2, 90 / view.scale) }); }
  catch (e) { drag.ghost = null; }
}

function endDrag() {
  const d = drag; drag = null;
  if (!d) return;
  if (d.ghost && d.ghost.snapped && d.ghost.valid) {
    selected = d.moved[0].id;
    setDesign(d.ghost.trial);
    if (d.base.parts.length === 0) fitView();
  } else refresh();
}

/* ---- the mouse ---- */
function pos(e) { const r = stage.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; }
function inPoly(def, w) {
  let inside = false; const v = def.verts, n = v.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = def.at[0] + v[i][0], yi = def.at[1] + v[i][1], xj = def.at[0] + v[j][0], yj = def.at[1] + v[j][1];
    if ((yi > w.y) !== (yj > w.y) && w.x < (xj - xi) * (w.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function partAt(d, w) { const g = geoOf(d); for (let i = g.length - 1; i >= 0; i--) if (inPoly(g[i], w)) return g[i].designId; return null; }

stage.addEventListener("mousedown", function (e) {
  if (e.button !== 0) return;
  const p = pos(e); mouse.px = p.px; mouse.py = p.py; mouse.inside = true;
  const id = partAt(design, toWorld(p.px, p.py));
  if (id) { selected = id; pending = { px: p.px, py: p.py, id: id }; }
  else { selected = null; pan = { px: p.px, py: p.py, cx: view.cx, cy: view.cy }; }
});

window.addEventListener("mousemove", function (e) {
  const p = pos(e); mouse.px = p.px; mouse.py = p.py;
  mouse.inside = p.px >= 0 && p.py >= 0 && p.px <= W && p.py <= H;
  if (pending && !drag && Math.hypot(p.px - pending.px, p.py - pending.py) > 6) {
    if (pending.id === design.parts[0].id) pan = { px: pending.px, py: pending.py, cx: view.cx, cy: view.cy };   // the first part holds the rest: dragging it pans
    else beginMove(pending.id);
    pending = null;
  }
  if (pan) { view.cx = pan.cx - (p.px - pan.px) / view.scale; view.cy = pan.cy + (p.py - pan.py) / view.scale; }
  if (drag) updateGhost();
  else hover = mouse.inside ? partAt(design, toWorld(p.px, p.py)) : null;
});

window.addEventListener("mouseup", function () { pending = null; pan = null; endDrag(); });

stage.addEventListener("wheel", function (e) {
  e.preventDefault();
  const p = pos(e), before = toWorld(p.px, p.py);
  view.scale = Math.max(8, Math.min(120, view.scale * Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.0015)));
  const after = toWorld(p.px, p.py);                           // keep the point under the mouse where it was
  view.cx += before.x - after.x; view.cy += before.y - after.y;
  if (drag) updateGhost();
}, { passive: false });

window.addEventListener("keydown", function (e) {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT") return;
  if (e.code === "Delete" || e.code === "Backspace") { e.preventDefault(); removeSelected(); }
  else if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); undo(); }
  else if (e.code === "KeyF") fitView();
  else if (e.code === "Escape") { drag = null; selected = null; }
});
window.addEventListener("resize", resize);

/* ---- drawing ---- */
function polyPath(def, dx, dy) {
  sc.beginPath();
  def.verts.forEach(function (v, i) { const p = toScreen(def.at[0] + v[0] + (dx || 0), def.at[1] + v[1] + (dy || 0)); if (i === 0) sc.moveTo(p[0], p[1]); else sc.lineTo(p[0], p[1]); });
  sc.closePath();
}

function drawGrid() {
  sc.fillStyle = "#101418"; sc.fillRect(0, 0, W, H);
  const k = view.scale, step = k >= 20 ? 0.5 : 1;
  const x0 = Math.floor(toWorld(0, 0).x / step) * step, x1 = toWorld(W, 0).x, y1 = toWorld(0, 0).y, y0 = toWorld(0, H).y;
  sc.lineWidth = 1;
  for (let x = x0; x <= x1; x += step) {
    const major = Math.abs(x / 2 - Math.round(x / 2)) < 1e-6, X = Math.round(toScreen(x, 0)[0]) + 0.5;
    sc.strokeStyle = major ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.05)";
    sc.beginPath(); sc.moveTo(X, 0); sc.lineTo(X, H); sc.stroke();
  }
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
    const major = Math.abs(y / 2 - Math.round(y / 2)) < 1e-6, Y = Math.round(toScreen(0, y)[1]) + 0.5;
    sc.strokeStyle = major ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.05)";
    sc.beginPath(); sc.moveTo(0, Y); sc.lineTo(W, Y); sc.stroke();
  }
  const ax = Math.round(toScreen(0, 0)[0]) + 0.5;               // the centre line
  sc.strokeStyle = "rgba(74,163,255,0.35)"; sc.setLineDash([6, 6]);
  sc.beginPath(); sc.moveTo(ax, 0); sc.lineTo(ax, H); sc.stroke(); sc.setLineDash([]);
  sc.font = "10px monospace"; sc.fillStyle = "rgba(255,255,255,0.35)"; sc.textAlign = "left"; sc.textBaseline = "bottom";
  for (let y = Math.ceil(y0 / 2) * 2; y <= y1; y += 2) sc.fillText(y + " m", 6, toScreen(0, y)[1] - 2);   // a label every 2 m
}

function drawParts(d) {
  for (const def of geoOf(d)) {
    polyPath(def);
    sc.fillStyle = def.color; sc.fill();
    const hot = def.designId === selected, over = def.designId === hover && !drag;
    sc.lineWidth = hot ? 2.5 : 1; sc.strokeStyle = hot ? "#f1c40f" : over ? "#ffffff" : "rgba(0,0,0,0.55)"; sc.stroke();
  }
}

function drawMarkers() {             // the balance point (CG, full tank) and the centre of pressure (CP)
  const st = statsOf(design);
  if (!st || st.cp === null || view.scale < 14) return;
  for (const m of [[st.cgFull, "CG", false], [st.cp, "CP", true]]) {
    const p = toScreen(st.axisX, m[0]), r = 5;
    sc.beginPath(); sc.arc(p[0], p[1], r, 0, 6.2832);
    sc.fillStyle = m[2] ? "#e74c3c" : "#ffffff"; sc.fill(); sc.strokeStyle = m[2] ? "#fff" : "#111"; sc.lineWidth = 1.5; sc.stroke();
    sc.font = "11px monospace"; sc.textBaseline = "middle"; sc.textAlign = m[2] ? "left" : "right";
    sc.fillStyle = "#e8eef2"; sc.fillText(m[1], p[0] + (m[2] ? 9 : -9), p[1]);
  }
}

function drawGhost() {
  const g = drag.ghost, ids = drag.moved.map(function (p) { return p.id; });
  if (g && g.snapped && g.trial) {
    const tint = g.valid ? "rgba(95,211,141,0.55)" : "rgba(255,107,94,0.55)";
    for (const def of geometryOf(g.trial)) {
      if (ids.indexOf(def.designId) < 0) continue;
      polyPath(def); sc.fillStyle = tint; sc.fill(); sc.lineWidth = 2; sc.strokeStyle = g.valid ? "#5fd38d" : "#ff6b5e"; sc.stroke();
    }
    if (!g.valid && g.problems.length) {
      sc.font = "12px monospace"; sc.textAlign = "left"; sc.textBaseline = "top";
      const t = g.problems[0], w = sc.measureText(t).width;
      sc.fillStyle = "rgba(10,14,18,0.85)"; sc.fillRect(mouse.px + 14, mouse.py + 14, w + 12, 22);
      sc.fillStyle = "#ff6b5e"; sc.fillText(t, mouse.px + 20, mouse.py + 19);
    }
  } else if (mouse.inside) {                                    // nothing close enough to join: the part just follows the mouse
    const spec = drag.moved[0], def = previewOf(spec), w = toWorld(mouse.px, mouse.py);
    def.at = [w.x, w.y];
    polyPath(def); sc.fillStyle = "rgba(255,255,255,0.25)"; sc.fill(); sc.lineWidth = 1; sc.strokeStyle = "rgba(255,255,255,0.6)"; sc.stroke();
  }
}

function frame() {
  if (stageUi.shown !== selected) syncStageSel();
  drawGrid();
  const shown = drag && drag.kind === "move" ? drag.base : design;
  if (shown.parts.length) drawParts(shown);
  else { sc.font = "14px monospace"; sc.fillStyle = "rgba(255,255,255,0.4)"; sc.textAlign = "center"; sc.textBaseline = "middle"; const o = toScreen(0, 0); sc.fillText("Drag a part here to start", o[0], o[1] - 40); }
  if (!drag) drawMarkers();
  if (drag) drawGhost();
  sc.font = "11px monospace"; sc.fillStyle = "rgba(255,255,255,0.45)"; sc.textAlign = "left"; sc.textBaseline = "bottom";
  sc.fillText("Drag a part from the left onto the rocket.  Click a part to select it, Delete removes it.  Drag a placed part to move it.", 10, H - 8);
  requestAnimationFrame(frame);
}

/* ---- start ---- */
(function start() {
  const fromHash = designFromHash(location.hash);              // coming back from the game (B), or a shared link
  let d = fromHash.design;
  if (!d) { try { const t = localStorage.getItem("rocketsim.draft"); if (t) { const dd = JSON.parse(t); if (validateDesign(dd, true).length === 0) d = dd; } } catch (e) { /* ok */ } }
  design = withStages(d || cloneDesign(DESIGN));
  buildLeft(); buildRight();
  resize();
  refresh();
  fitView();
  requestAnimationFrame(frame);
})();
