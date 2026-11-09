"use strict";

/* =====================================================================
   STATS  (js/stats.js)
   What a design adds up to, worked out from the same rules and the same
   air-force code the game uses: mass, fuel, thrust, delta-v, stability.
   The builder shows these live. No planck needed.
   ===================================================================== */

function polyCentroid(v) {           // centre of a polygon of {x, y} points
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length], c = p.x * q.y - q.x * p.y; a += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; }
  a /= 2;
  return [cx / (6 * a), cy / (6 * a)];
}

function designStats(design) {
  if (!design || !design.parts || design.parts.length === 0) return null;
  const rocket = assemble(design, { keepFrame: true });
  let wet = 0, fuel = 0, thrustVac = 0, thrustSl = 0, mdot = 0, engines = 0, tanks = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const items = rocket.parts.map(function (def) {
    const verts = def.verts.map(function (v) { return { x: v[0], y: v[1] }; });
    const c = polyCentroid(verts);
    const part = { def: def, verts: verts, cy: def.at[1] + c[1], forces: (def.forces || []).map(function (f) { return Object.assign({}, f); }) };
    let weight = 0;                                          // how much this part pushes sideways (see stabilityCal in aero.js)
    for (const f of part.forces) {
      prepareAero(part, f);
      if (f.kind === "fin") weight += f.liftA; else if (f.kind === "drag") weight += f.sideA;
      if (f.kind === "thrust") { thrustVac += f.vac; thrustSl += f.sl; mdot += f.mdot; if (def.kind === "engine") engines++; }
    }
    part.weight = weight;
    wet += def.mass;
    if (def.fuel) { fuel += def.fuel.full; tanks++; }
    for (const v of def.verts) { x0 = Math.min(x0, def.at[0] + v[0]); x1 = Math.max(x1, def.at[0] + v[0]); y0 = Math.min(y0, def.at[1] + v[1]); y1 = Math.max(y1, def.at[1] + v[1]); }
    return part;
  });
  const dry = wet - fuel;
  let cp = null, w = 0, ws = 0;
  for (const p of items) { w += p.weight; ws += p.weight * p.cy; }
  if (w > 0) cp = ws / w;
  function cg(frac) {                                        // centre of gravity (height) with the tanks this full
    let m = 0, ms = 0;
    for (const p of items) { const pm = p.def.fuel ? p.def.fuel.dry + frac * p.def.fuel.full : p.def.mass; m += pm; ms += pm * p.cy; }
    return ms / m;
  }
  const hull = rocket.hull, cgFull = cg(1), cgDry = cg(0);
  return {
    parts: rocket.parts.length, tanks: tanks, engines: engines,
    wet: wet, dry: dry, fuel: fuel,
    thrustVac: thrustVac, thrustSl: thrustSl,
    twrSl: wet > 0 ? thrustSl / (wet * G0) : 0,
    dvVac: mdot > 0 && fuel > 0 ? thrustVac / mdot * Math.log(wet / dry) : 0,
    burn: mdot > 0 ? fuel / mdot : 0,
    height: y1 - y0, width: x1 - x0,
    cgFull: cgFull, cgDry: cgDry, cp: cp, axisX: hull ? hull.at[0] : 0,
    calFull: hull && cp !== null ? (cgFull - cp) / hull.width : null,
    calDry: hull && cp !== null ? (cgDry - cp) / hull.width : null
  };
}
