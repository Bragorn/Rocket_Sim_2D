"use strict";

/* =====================================================================
   EDIT  (js/edit.js)
   Changing a design: removing a part, picking where a dragged part would
   attach (the snapping), and trying that out. No screen code here, so it
   can be tested. A design is never changed in place: every edit returns a
   new design. See design.js for the format.
   ===================================================================== */

const SNAP = 0.1;                    // dragged parts snap to this grid, m

function cloneDesign(d) { return JSON.parse(JSON.stringify(d)); }
function partById(d, id) { return d.parts.find(function (p) { return p.id === id; }); }
function freshId(d, type) { let n = 1; while (d.parts.some(function (p) { return p.id === type + n; })) n++; return type + n; }
function snapTo(v) { return Math.round(v / SNAP) * SNAP === 0 ? 0 : Math.round(v * 10) / 10; }
function geometryOf(d) { return assemble(d, { keepFrame: true }).parts; }

function subtreeIds(d, id) {         // a part and everything attached to it, directly or not
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const p of d.parts) if (p.parent === out[i] && out.indexOf(p.id) < 0) out.push(p.id);
  return out;
}

function removeSubtree(d, id) {
  const gone = subtreeIds(d, id), c = cloneDesign(d);
  c.parts = c.parts.filter(function (p) { return gone.indexOf(p.id) < 0; });
  return c;
}

function orderDesign(d) {            // every part after the one it joins (keeps the order otherwise)
  const out = [], done = {};
  let pending = d.parts.slice(), progress = true;
  while (pending.length && progress) {
    progress = false;
    const next = [];
    for (const p of pending) { if (!p.parent || done[p.parent]) { out.push(p); done[p.id] = true; progress = true; } else next.push(p); }
    pending = next;
  }
  return Object.assign({}, d, { parts: out.concat(pending) });
}

/* base = the design without the part being placed. moved = the part (first) and anything attached to it.
   att = where the first one joins: { parent, anchor, dx } for a body part, { parent, anchor: "side", side, y } for a side part. */
function attachTrial(base, moved, att) {
  const c = cloneDesign(base), m = cloneDesign({ parts: moved }).parts, root = m[0];
  for (const k of ["parent", "anchor", "dx", "side", "y"]) delete root[k];
  Object.assign(root, att);
  c.parts.push.apply(c.parts, m);
  return orderDesign(c);
}

/* Where would the dragged part attach, with the mouse at `mouse` (meters, builder frame)?
   Tries the spots near the mouse, nearest first, and takes the first one that is allowed. If none is allowed it
   still answers with the nearest one (so the builder can show it red and say why).
   Returns { att, trial, problems, valid, snapped }; snapped false = nothing within reach.
   opts: radius (m, default 2.5), mirror (side parts in pairs, default true). */
function bestAttach(base, moved, mouse, opts) {
  opts = opts || {};
  const radius = opts.radius || 2.5, mirror = opts.mirror !== false;
  const spec = moved[0], type = PART_TYPES[spec.type];

  if (base.parts.length === 0) {                              // the first part: it is the root
    if (type.kind !== "stack") return { att: null, trial: null, problems: ["start with a body part"], valid: false, snapped: false };
    const trial = attachTrial(base, moved, {}), problems = validateDesign(trial, true);
    return { att: {}, trial: trial, problems: problems, valid: problems.length === 0, snapped: true };
  }

  const geo = {};
  for (const g of geometryOf(base)) if (g.faceTop !== undefined) geo[g.designId] = g;      // body parts only
  const cands = [];
  for (const dp of base.parts) {
    const pt = PART_TYPES[dp.type];
    if (pt.kind !== "stack") continue;
    const g = geo[dp.id];
    if (type.kind === "stack") {
      const made = type.make(spec);
      for (const anchor of ["top", "bottom"]) {
        const pf = anchor === "top" ? g.faceTop : g.faceBottom, mf = anchor === "top" ? made.faceBottom : made.faceTop;
        const lim = pf !== null && mf !== null ? Math.max(0, (pf - mf) / 2) : 0;
        const cy = anchor === "top" ? g.at[1] + g.length / 2 + made.length / 2 : g.at[1] - g.length / 2 - made.length / 2;
        const dxs = [Math.max(-lim, Math.min(lim, snapTo(mouse.x - g.at[0]))), 0, lim, -lim];
        for (const dx of dxs) cands.push({ att: { parent: dp.id, anchor: anchor, dx: dx }, score: Math.hypot(mouse.x - (g.at[0] + dx), mouse.y - cy) });
      }
    } else if (pt.sideOK) {
      const sgn = mouse.x >= g.at[0] ? 1 : -1, bottom = g.at[1] - g.length / 2;
      const y = Math.max(0, Math.min(g.length, snapTo(mouse.y - bottom)));
      cands.push({ att: { parent: dp.id, anchor: "side", side: mirror ? 0 : sgn, y: y },
                   score: Math.hypot(mouse.x - (g.at[0] + sgn * g.width / 2), mouse.y - (bottom + y)) });
    }
  }
  cands.sort(function (a, b) { return a.score - b.score; });
  let first = null, tried = 0;
  for (const c of cands) {
    if (c.score > radius) break;
    const trial = attachTrial(base, moved, c.att), problems = validateDesign(trial, true);
    const r = { att: c.att, trial: trial, problems: problems, valid: problems.length === 0, snapped: true };
    if (!first) first = r;
    if (r.valid) return r;
    if (++tried >= 12) break;
  }
  return first || { att: null, trial: null, problems: [], valid: false, snapped: false };
}
