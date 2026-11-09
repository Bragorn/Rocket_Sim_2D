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

/* The starting rocket: a 2 m x 4 m tank, a 250 kN engine under it, a nose on top, a pair of legs and a pair of fins. */
const DESIGN = {
  version: 1, name: "Starting rocket",
  parts: [
    { id: "tank",   type: "tank",   width: 2, length: 4 },
    { id: "engine", type: "engine", thrust: 250000, parent: "tank", anchor: "bottom", dx: 0 },
    { id: "nose",   type: "nose",   width: 2, length: 1.5, parent: "tank", anchor: "top", dx: 0 },
    { id: "leg",    type: "leg",    parent: "tank", anchor: "side", side: 0, y: 0.4 },
    { id: "fin",    type: "fin",    parent: "tank", anchor: "side", side: 0, y: 0.4 }
  ]
};

/* ---- assembling ---- */
function assemble(design) {
  const built = {}, parts = [];
  let hull = null;
  for (const d of design.parts) {
    const type = PART_TYPES[d.type];
    if (type.kind === "stack") {
      const def = type.make(d), p = d.parent ? built[d.parent] : null;
      def.id = d.id;
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
        def.id = d.id + (side < 0 ? "L" : "R");
        def.name = (side < 0 ? "left " : "right ") + type.label.toLowerCase();
        def.joint.to = p.id;
        parts.push(def);
      }
    }
  }
  let low = Infinity;                                                          // move everything so the lowest point of the rocket is at height 0
  for (const def of parts) for (const v of def.verts) low = Math.min(low, def.at[1] + v[1]);
  for (const def of parts) { def.at[1] -= low; if (def.joint) def.joint.at[1] -= low; }
  return { parts: parts, hull: hull };
}

let ROCKET = assemble(DESIGN);

/* ---- checking ---- */
function inRange(v, p) {
  if (p.choices) return p.choices.indexOf(v) >= 0;
  if (!(v >= p.min - 1e-9 && v <= p.max + 1e-9)) return false;
  const k = (v - p.min) / p.step;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

/* Returns a list of what is wrong with a design (empty = it can launch). */
function validateDesign(design) {
  if (!design || !Array.isArray(design.parts) || design.parts.length === 0) return ["the design has no parts"];
  const bad = [], seen = {}, made = {}, groups = {};
  let tanks = 0, engines = 0;
  design.parts.forEach(function (d, i) {
    const type = PART_TYPES[d && d.type];
    if (!d || !d.id || seen[d.id]) { bad.push("part " + (i + 1) + " has no id, or the same id as another part"); return; }
    seen[d.id] = true;
    if (!type) { bad.push(d.id + ": unknown part type " + d.type); return; }
    let ok = true;
    for (const k in type.params) if (!inRange(d[k], type.params[k])) { bad.push(d.id + ": " + k + " " + d[k] + " is not allowed for a " + type.label.toLowerCase()); ok = false; }
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
    const parentFace = d.anchor === "top" ? p.faceTop : p.faceBottom, myFace = d.anchor === "top" ? made[d.id].faceBottom : made[d.id].faceTop;
    if (parentFace === null) { bad.push(d.id + ": there is nothing to join on the " + d.anchor + " of the " + p.name); return; }
    if (myFace === null) { bad.push(d.id + ": it has no face to join on that side"); return; }
    if (myFace > parentFace + 1e-9) { bad.push(d.id + ": it is wider (" + myFace.toFixed(2) + " m) than the face it joins (" + parentFace.toFixed(2) + " m)"); return; }
    const dx = d.dx || 0;
    if (Math.abs(dx) + myFace / 2 > parentFace / 2 + 1e-9) bad.push(d.id + ": it sticks out past the edge of the face it joins");
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
  if (tanks === 0) bad.push("the rocket needs a tank");
  if (engines === 0) bad.push("the rocket needs an engine");
  if (bad.length === 0) for (const m of checkRules(assemble(design).parts)) bad.push(m);
  return bad;
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
