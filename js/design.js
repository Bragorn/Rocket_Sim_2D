"use strict";

/* =====================================================================
   DESIGN  (js/design.js)
   A rocket design is plain data (it saves as text): a list of parts, each one
   joined to an earlier one. The first part is the root.
     { id, type, ...the part's settings (see PART_TYPES), parent, anchor, ... }
   Body parts (tank, engine, nose) join end to end:
     anchor "top"    sits on top of its parent,   anchor "bottom" hangs below it.
     dx              slides it sideways along that face (m); default 0. It has to stay inside the face.
   Side parts (fin, leg) hang on a tank:
     anchor "side", side 0 = one on each side (a mirrored pair), -1 = left only, 1 = right only,
     y = how high up the tank they join (m above the tank's bottom).
   assemble() turns a design into ROCKET (what world.js builds); validateDesign() says what is wrong with one.
   ===================================================================== */

/* ---- staging: the order engines light and decouplers let go ----
   design.stages is a list of rows, each a list of part ids. Row 1 fires first (Space in flight). An engine in a row
   is activated (it can burn and answers the throttle); a decoupler in a row lets go. A design without the list gets one made. */
const STAGEABLE = { engine: "Activate", decoupler: "Decouple" };

function stageLabel(d) { return d.type === "engine" ? "Engine " + Math.round(d.thrust / 1000) + " kN" : d.type === "decoupler" ? "Decoupler " + d.width + " m" : d.id; }

function stageLabels(design) {       // id -> { label, verb } for every part the staging list can hold
  const out = {};
  for (const d of design.parts) if (STAGEABLE[d.type]) out[d.id] = { label: stageLabel(d), verb: STAGEABLE[d.type] };
  return out;
}

function stagesOf(design) {          // the staging rows, cleaned: only real engines and decouplers, each once, none missing, no empty rows
  const rows = [], seen = {}, given = Array.isArray(design.stages);
  if (given) for (const row of design.stages) {
    const r = [];
    if (Array.isArray(row)) for (const id of row) {
      const d = design.parts.find(function (q) { return q.id === id; });
      if (d && STAGEABLE[d.type] && !seen[id]) { seen[id] = true; r.push(id); }
    }
    if (r.length) rows.push(r);
  }
  const missing = design.parts.filter(function (d) { return STAGEABLE[d.type] && !seen[d.id]; });
  if (given) { for (const d of missing) rows.push([d.id]); }              // a part the list forgot gets a row of its own, last
  else {                                                                  // an older design: every engine in the first row, then each decoupler alone
    const engines = missing.filter(function (d) { return d.type === "engine"; }).map(function (d) { return d.id; });
    if (engines.length) rows.push(engines);
    for (const d of missing) if (d.type === "decoupler") rows.push([d.id]);
  }
  return rows;
}

/* The starting rocket: a 2 m x 4 m tank, a 250 kN engine under it, a nose on top, a pair of legs and a pair of fins. */
const DESIGN = {
  version: 1, name: "Starting rocket", stages: [["engine"]],
  parts: [
    { id: "tank",   type: "tank",   width: 2, length: 4 },
    { id: "engine", type: "engine", thrust: 250000, parent: "tank", anchor: "bottom", dx: 0 },
    { id: "nose",   type: "nose",   width: 2, length: 1.5, parent: "tank", anchor: "top", dx: 0 },
    { id: "leg",    type: "leg",    parent: "tank", anchor: "side", side: 0, y: 0.4 },
    { id: "fin",    type: "fin",    parent: "tank", anchor: "side", side: 0, y: 0.4 }
  ]
};

/* ---- assembling ---- */
function assemble(design, opts) {      // opts.keepFrame: leave the root where it is (the builder wants a rocket that does not jump around)
  const built = {}, parts = [];
  let hull = null;
  for (const d of design.parts) {
    const type = PART_TYPES[d.type];
    if (type.kind === "stack") {
      const def = type.make(d), p = d.parent ? built[d.parent] : null;
      def.id = d.id; def.designId = d.id;
      if (!p) def.at = [0, def.length / 2];                                    // the root; everything is moved so the lowest point is at 0 below
      else if (d.anchor === "top") {
        def.at = [p.at[0] + (d.dx || 0), p.at[1] + p.length / 2 + def.length / 2];
        def.joint = { to: p.id, at: [def.at[0], p.at[1] + p.length / 2] };
      } else {
        def.at = [p.at[0] + (d.dx || 0), p.at[1] - p.length / 2 - def.length / 2];
        def.joint = { to: p.id, at: [def.at[0], p.at[1] - p.length / 2] };
      }
      if (def.hull) { if (hull) delete def.hull; else hull = def; }            // the first tank is the hull
      built[d.id] = def; parts.push(def);
    } else {
      const p = built[d.parent], jy = p.at[1] - p.length / 2 + d.y;
      for (const side of (d.side ? [d.side] : [-1, 1])) {
        const def = type.make(d, side, { px: p.at[0], half: p.width / 2, jy: jy, parent: p });
        def.id = d.id + (side < 0 ? "L" : "R"); def.designId = d.id;
        def.name = (side < 0 ? "left " : "right ") + type.label.toLowerCase();
        def.joint.to = p.id;
        parts.push(def);
      }
    }
  }
  if (!(opts && opts.keepFrame)) {
    let low = Infinity;                                                        // move everything so the lowest point of the rocket is at height 0
    for (const def of parts) for (const v of def.verts) low = Math.min(low, def.at[1] + v[1]);
    for (const def of parts) { def.at[1] -= low; if (def.joint) def.joint.at[1] -= low; }
  }
  return { parts: parts, hull: hull, stages: stagesOf(design), labels: stageLabels(design) };
}

let ROCKET = assemble(DESIGN);

/* ---- checking ---- */
function inRange(v, p) {
  if (p.choices) return p.choices.indexOf(v) >= 0;
  if (!(v >= p.min - 1e-9 && v <= p.max + 1e-9)) return false;
  const k = (v - p.min) / p.step;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

/* Returns a list of what is wrong with a design (empty = it can launch).
   partial = true is for a design still being built: it skips "needs a tank / an engine". */
function validateDesign(design, partial) {
  if (!design || !Array.isArray(design.parts) || design.parts.length === 0) return ["the design has no parts"];
  const bad = [], seen = {}, made = {}, groups = {};
  let tanks = 0, engines = 0;
  design.parts.forEach(function (d, i) {
    const type = PART_TYPES[d && d.type];
    if (!d || !d.id || seen[d.id]) { bad.push("part " + (i + 1) + " has no id, or the same id as another part"); return; }
    seen[d.id] = true;
    if (!type) { bad.push(d.id + ": unknown part type " + d.type); return; }
    let ok = true;
    for (const k in type.params) if (!(type.params[k].optional && d[k] === undefined) && !inRange(d[k], type.params[k])) { bad.push(d.id + ": " + k + " " + d[k] + " is not allowed for a " + type.label.toLowerCase()); ok = false; }
    if (!ok) return;
    if (d.type === "tank") tanks++;
    if (d.type === "engine") engines++;
    if (type.kind === "stack") made[d.id] = type.make(d);
    if (i === 0) {
      if (d.parent) bad.push(d.id + ": the first part has to be the root (no parent)");
      if (type.kind !== "stack") bad.push(d.id + ": the first part has to be a body part, not a " + type.label.toLowerCase());
      return;
    }
    const p = made[d.parent];
    if (!p) { bad.push(d.id + ": it has to join a body part that comes earlier in the list"); return; }
    if (type.kind === "side") {
      const pt = PART_TYPES[design.parts.find(function (q) { return q.id === d.parent; }).type];
      if (d.anchor !== "side") bad.push(d.id + ": a " + type.label.toLowerCase() + " has to hang on the side");
      else if (!pt.sideOK) bad.push(d.id + ": a " + type.label.toLowerCase() + " can only hang on a tank");
      if (d.side !== 0 && d.side !== -1 && d.side !== 1) bad.push(d.id + ": side has to be 0 (both), -1 or 1");
      if (!inRange(d.y, { min: 0, max: p.length, step: RULES.sideGridM })) bad.push(d.id + ": it has to join at a height on the tank, in steps of " + RULES.sideGridM + " m");
      (groups[d.parent + "|side|" + d.type] = groups[d.parent + "|side|" + d.type] || []).push(d);   // fins crowd fins and legs crowd legs; a fin and a leg may share a height
      return;
    }
    if (d.anchor !== "top" && d.anchor !== "bottom") { bad.push(d.id + ": a body part has to join at the top or the bottom"); return; }
    const pd = design.parts.find(function (q) { return q.id === d.parent; });
    if ((pd.anchor === "top" && d.anchor === "bottom") || (pd.anchor === "bottom" && d.anchor === "top")) { bad.push(d.id + ": the " + p.name + " is already joined on that end"); return; }
    if (d.anchor === "top" && made[d.id].bottomOnly) { bad.push(d.id + ": the nozzle end of an " + made[d.id].name + " can only join a " + made[d.id].bottomOnly + ", so it cannot sit on top of the " + p.name); return; }
    const parentFace = d.anchor === "top" ? p.faceTop : p.faceBottom, myFace = d.anchor === "top" ? made[d.id].faceBottom : made[d.id].faceTop;
    if (parentFace === null) { bad.push(d.id + ": there is nothing to join on the " + d.anchor + " of the " + p.name); return; }
    if (myFace === null) { bad.push(d.id + ": it has no face to join on that side"); return; }
    if (d.anchor === "bottom" && p.bottomOnly) {                                // under an engine: only a decoupler, wrapped round the nozzle
      const dw = made[d.id].width;
      if (d.type !== p.bottomOnly) { bad.push(d.id + ": only a " + p.bottomOnly + " can join under the " + p.name); return; }
      if (dw < p.width - 1e-9) { bad.push(d.id + ": it is narrower (" + dw.toFixed(2) + " m) than the " + p.name + " it goes round (" + p.width.toFixed(2) + " m)"); return; }
      if (Math.abs(d.dx || 0) + p.width / 2 > dw / 2 + 1e-9) bad.push(d.id + ": the " + p.name + " would stick out past its edge");
      (groups[d.parent + "|" + d.anchor] = groups[d.parent + "|" + d.anchor] || []).push(d);
      return;
    }
    const ext = Math.max(myFace, made[d.id].width);                            // the widest part of it (an engine's bell is wider than where it joins)
    if (ext > parentFace + 1e-9) { bad.push(d.id + ": it is wider (" + ext.toFixed(2) + " m) than the face it joins (" + parentFace.toFixed(2) + " m)"); return; }
    const dx = d.dx || 0;
    if (Math.abs(dx) + ext / 2 > parentFace / 2 + 1e-9) bad.push(d.id + ": it sticks out past the edge of the face it joins");
    (groups[d.parent + "|" + d.anchor] = groups[d.parent + "|" + d.anchor] || []).push(d);
  });
  for (const key in groups) {                                                  // two parts cannot sit in the same place
    const list = groups[key];
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = list[a], B = list[b];
      if (key.indexOf("|side|") >= 0) {
        const share = !A.side || !B.side || A.side === B.side;
        if (share && Math.abs(A.y - B.y) < 0.5) bad.push(A.id + " and " + B.id + " are in the same place");
      } else {
        const wa = made[A.id].width, wb = made[B.id].width;
        if (Math.abs((A.dx || 0) - (B.dx || 0)) < (wa + wb) / 2 - 1e-9) bad.push(A.id + " and " + B.id + " overlap");
      }
    }
  }
  if (!partial && design.stages !== undefined) {                              // the staging list: real engines and decouplers, each once
    if (!Array.isArray(design.stages)) bad.push("the staging list is not a list");
    else {
      const used = {};
      for (const row of design.stages) {
        if (!Array.isArray(row) || row.length === 0) { bad.push("a stage in the staging list is empty"); continue; }
        for (const id of row) {
          const q = design.parts.find(function (o) { return o.id === id; });
          if (!q || !STAGEABLE[q.type]) bad.push("the staging list names " + id + ", which is not an engine or a decoupler");
          else if (used[id]) bad.push(id + " is in the staging list twice");
          used[id] = true;
        }
      }
    }
  }
  if (!partial && tanks === 0) bad.push("the rocket needs a tank");
  if (!partial && engines === 0) bad.push("the rocket needs an engine");
  if (bad.length === 0) for (const m of checkRules(assemble(design).parts)) bad.push(m);
  return bad;
}

/* Things that are allowed but probably not what you want. They do not stop a launch. */
function designWarnings(design) {
  const out = [];
  if (!design || !design.parts || design.parts.length === 0) return out;
  let lowLeg = Infinity, lowBody = Infinity, lowName = "";
  for (const def of assemble(design, { keepFrame: true }).parts) for (const v of def.verts) {
    const y = def.at[1] + v[1];
    if (def.kind === "leg") lowLeg = Math.min(lowLeg, y);
    else if (y < lowBody) { lowBody = y; lowName = def.name; }
  }
  const rows = stagesOf(design);
  if (rows.length && !rows[0].some(function (id) { return design.parts.find(function (q) { return q.id === id; }).type === "engine"; })) out.push("stage 1 does not activate an engine: nothing will light until a later stage fires");
  if (lowLeg === Infinity) out.push("no legs: the rocket would stand on its " + lowName);
  else if (lowBody < lowLeg - 1e-6) {
    const legs = design.parts.filter(function (p) { return p.type === "leg"; });
    const now = Math.min.apply(null, legs.map(function (p) { return p.drop === undefined ? 1.7 : p.drop; }));
    out.push("the " + lowName + " reaches lower than the legs, so it would stand on it. Legs about " + (Math.ceil((now + lowLeg - lowBody + 0.15) * 10) / 10).toFixed(1) + " m long (now " + now.toFixed(1) + " m) would reach.");
  }
  return out;
}

/* ---- saving and loading. A design is small text. ---- */
function designToText(design) { return JSON.stringify(design); }

function designFromText(text) {      // { design, problems }
  let d;
  try { d = JSON.parse(text); } catch (e) { return { design: null, problems: ["that is not a rocket design (the text does not read)"] }; }
  const problems = validateDesign(d);
  return { design: problems.length ? null : d, problems: problems };
}

/* The builder opens the game with the design in the address (after the #), which works from a double-clicked file too. */
function designToHash(design) { return "#d=" + encodeURIComponent(designToText(design)); }
function designFromHash(hash) {
  const m = /[#&]d=([^&]*)/.exec(hash || "");
  if (!m) return { design: null, problems: [] };
  try { return designFromText(decodeURIComponent(m[1])); } catch (e) { return { design: null, problems: ["the design in the address could not be read"] }; }
}

/* Designs kept in this browser, by name (this is for the builder page). Wrapped so a browser that blocks storage just says no. */
const DESIGN_STORE = "rocketsim.designs";
function savedDesigns() {
  try { return JSON.parse(localStorage.getItem(DESIGN_STORE) || "{}"); } catch (e) { return {}; }
}
function saveDesign(name, design) {
  try { const all = savedDesigns(); all[name] = design; localStorage.setItem(DESIGN_STORE, JSON.stringify(all)); return true; } catch (e) { return false; }
}
function deleteSavedDesign(name) {
  try { const all = savedDesigns(); delete all[name]; localStorage.setItem(DESIGN_STORE, JSON.stringify(all)); return true; } catch (e) { return false; }
}
