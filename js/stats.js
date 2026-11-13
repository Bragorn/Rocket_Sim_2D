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

/* What each row of the staging list gets you, in firing order: [{ dv, burn, twr, mass }].
   When a row fires: its decouplers let go (the piece with the highest part is the rocket from then on), its engines are activated,
   and every engine that is on burns all the fuel in its own tanks (fuel never crosses a decoupler). dv is the rocket equation for
   that burn, from the mass of the rocket at that moment; twr is at sea level. */
function stagePlan(rocket) {
  const parts = rocket.parts, idx = {}, cut = {}, active = {}, fuel = {}, out = [];
  parts.forEach(function (d, i) { idx[d.id] = i; if (d.fuel) fuel[d.id] = d.fuel.full; });
  let top = 0, topY = -Infinity;
  parts.forEach(function (d, i) { for (const v of d.verts) if (d.at[1] + v[1] > topY) { topY = d.at[1] + v[1]; top = i; } });
  function comps(barrier) {          // which piece each part is in (barrier: look at fuel, which does not cross a decoupler)
    const root = parts.map(function (d, i) { return i; });
    const find = function (x) { while (root[x] !== x) { root[x] = root[root[x]]; x = root[x]; } return x; };
    for (const d of parts) {
      if (!d.joint || cut[d.id]) continue;
      const to = idx[d.joint.to];
      if (barrier && (d.kind === "decoupler" || parts[to].kind === "decoupler")) continue;
      root[find(idx[d.id])] = find(to);
    }
    return parts.map(function (d, i) { return find(i); });
  }
  for (const row of rocket.stages) {
    for (const id of row) {
      const d = parts[idx[id]];
      if (!d) continue;
      if (d.kind === "decoupler") cut[d.id] = true; else if (d.kind === "engine") active[d.id] = true;
    }
    const grp = comps(false), zone = comps(true), mine = function (i) { return grp[i] === grp[top]; };
    let m0 = 0;
    parts.forEach(function (d, i) { if (mine(i)) m0 += d.fuel ? d.fuel.dry + fuel[d.id] : d.mass; });
    const zf = {};                   // fuel in each group of tanks
    parts.forEach(function (d, i) { if (mine(i) && d.fuel) zf[zone[i]] = (zf[zone[i]] || 0) + fuel[d.id]; });
    const zFlow = {};                // fuel flow of the engines that are on, for each group of tanks
    let flow = 0, vac = 0, sl = 0;
    parts.forEach(function (d, i) {
      if (!mine(i) || d.kind !== "engine" || !active[d.id] || !(zf[zone[i]] > 0)) return;
      const f = d.forces.find(function (q) { return q.kind === "thrust"; });
      zFlow[zone[i]] = (zFlow[zone[i]] || 0) + f.mdot; flow += f.mdot; vac += f.vac; sl += f.sl;
    });
    let burnt = 0, burn = 0;
    for (const z in zFlow) { burnt += zf[z]; burn = Math.max(burn, zf[z] / zFlow[z]); }
    parts.forEach(function (d, i) { if (mine(i) && d.fuel && zFlow[zone[i]]) fuel[d.id] = 0; });
    out.push({ dv: flow > 0 && burnt > 0 ? vac / flow * Math.log(m0 / (m0 - burnt)) : 0, burn: burn, twr: m0 > 0 ? sl / (m0 * G0) : 0, mass: m0 });
  }
  return out;
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
  const hull = rocket.hull, cgFull = cg(1), cgDry = cg(0), plan = stagePlan(rocket);
  return {
    parts: rocket.parts.length, tanks: tanks, engines: engines,
    wet: wet, dry: dry, fuel: fuel,
    thrustVac: thrustVac, thrustSl: thrustSl,
    twrSl: wet > 0 ? thrustSl / (wet * G0) : 0,
    dvVac: plan.reduce(function (s, r) { return s + r.dv; }, 0), stages: plan,
    burn: plan.reduce(function (s, r) { return s + r.burn; }, 0),
    height: y1 - y0, width: x1 - x0,
    cgFull: cgFull, cgDry: cgDry, cp: cp, axisX: hull ? hull.at[0] : 0,
    calFull: hull && cp !== null ? (cgFull - cp) / hull.width : null,
    calDry: hull && cp !== null ? (cgDry - cp) / hull.width : null
  };
}
