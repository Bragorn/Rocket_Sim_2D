"use strict";

/* =====================================================================
   PARTS  (js/parts.js)
   The rocket as plain data. Nothing here touches planck. A part only says
   how big it is: its mass, fuel and engine numbers come from rules.js.
   Each part has:
     id, name, color, kind
     length, width = its size, m
     at     = [x, y] where the part's centre sits, in meters above the rocket's bottom (engine bottom)
     verts  = its shape, [x, y] points around its centre
     mass   = kg
     joint  = { to: id of another part, at: [x, y] } weld it to that part at that point (same units as "at")
     forces = a list of forces the part produces. Kinds so far:
                thrust  an engine: vac and sl (thrust in vacuum / at sea level, N), mdot (fuel kg/s at full throttle),
                        minThrottle, gimbalMax, gimbalRate, and "at" (the nozzle, relative to the part)
                drag    air drag on the part: cdAxial and cdSide (drag coefficients along and across the part),
                        depth (how far the part reaches into the screen, m). Areas come from the shape.
                fin     a tail surface: a sideways push that grows with the angle of the air: cn, depth
   Special flags: hull (the body that steering torque turns and the camera follows),
                  fuel (the part that holds fuel: dry and full mass, kg).
   assemble() stacks the parts bottom to top and welds them; side parts (legs, fins) hang on the hull.
   ===================================================================== */

const PAD_CLEARANCE = 0.5 + 0.02;    // the engine's bottom starts this high: feet hang 0.5 m lower and start 2 cm off the ground

function bar(end, th) {              // a thin straight bar from (0,0) to end, th thick
  const L = Math.hypot(end[0], end[1]), nx = -end[1] / L * th / 2, ny = end[0] / L * th / 2;
  return [[nx, ny], [end[0] + nx, end[1] + ny], [end[0] - nx, end[1] - ny], [-nx, -ny]];
}

/* ---- stack parts (bottom to top) ---- */
function engine(vacN) {
  const sp = engineSpec(vacN), s = sp.scale;
  return { id: "engine", name: "engine", kind: "engine", color: "#7f8c8d", length: 0.8 * s, width: 1.2 * s, mass: sp.mass,
           verts: [[-0.5 * s, -0.4 * s], [0.5 * s, -0.4 * s], [0.6 * s, 0.4 * s], [-0.6 * s, 0.4 * s]],
           forces: [{ kind: "thrust", at: [0, -0.4 * s], vac: sp.vac, sl: sp.sl, mdot: sp.mdot, scale: s,
                      minThrottle: RULES.minThrottle, gimbalMax: GIMBAL_MAX, gimbalRate: GIMBAL_RATE },
                    { kind: "drag", cdAxial: 0.3, cdSide: 0.6, depth: 1.2 * s }] };
}

function tank(width, length) {
  const sp = tankSpec(width, length), w = width / 2, h = length / 2;
  return { id: "tank", name: "tank", kind: "tank", color: "#ecf0f1", length: length, width: width, mass: sp.dry + sp.fuel,
           verts: [[-w, -h], [w, -h], [w, h], [-w, h]],
           hull: true, fuel: { dry: sp.dry, full: sp.fuel },
           forces: [{ kind: "drag", cdAxial: 0.1, cdSide: 0.8, depth: width }] };
}

function nose(width, length) {
  const sp = noseSpec(width, length), w = width / 2, t = 0.1 * width, h = length / 2;
  return { id: "nose", name: "nose", kind: "nose", color: "#e67e22", length: length, width: width, mass: sp.mass,
           verts: [[-w, -h], [w, -h], [t, h], [-t, h]],
           forces: [{ kind: "drag", cdAxial: 0.3, cdSide: 0.8, depth: width }] };
}

/* ---- side parts: made once for each side (-1 left, 1 right), hung on the hull at height y ---- */
function makeFin(side, y, half, hull) {   // root along the hull wall (2.4 m), tip 1.4 m out (0.8 m long)
  const v = [[-0.7, -1.2], [0.7, -1.2], [0.7, -0.4], [-0.7, 1.2]].map(function (p) { return [side * p[0], p[1]]; });
  const planform = 2.24 * hull.width;     // the shape's area (2.24 m2) x how far it reaches into the screen
  return { id: side < 0 ? "finL" : "finR", name: side < 0 ? "left fin" : "right fin", kind: "fin", color: "#c0392b",
           at: [side * (half + 0.7), y + 1.2], mass: planform * RULES.finAreal, verts: v,
           joint: { to: hull.id, at: [side * half, y + 1.2] },
           forces: [{ kind: "fin", cn: FIN_CN, depth: hull.width },
                    { kind: "drag", cdAxial: 0.1, cdSide: 0, depth: hull.width }] };   // the sideways push is the fin force; this is just its own skin drag
}

function makeLeg(side, y, half, hull) {   // a bar from the hull wall down and out
  const end = [side * 1.5, -1.7], len = Math.hypot(end[0], end[1]);
  return { id: side < 0 ? "legL" : "legR", name: side < 0 ? "left leg" : "right leg", kind: "leg", color: "#95a5a6",
           at: [side * half, y], mass: len * RULES.legPerM, verts: bar(end, 0.2),
           joint: { to: hull.id, at: [side * half, y] },
           forces: [{ kind: "drag", cdAxial: 1.0, cdSide: 1.0, depth: 0.15 }] };
}
const SIDE_MAKERS = { fin: makeFin, leg: makeLeg };

/* Stack the parts, weld each to the one below, then hang the side parts on the hull. */
function assemble(design) {
  const parts = [];
  let y = 0, prev = null, hull = null;
  for (const s of design.stack) {
    s.at = [0, y + s.length / 2];
    if (prev) s.joint = { to: prev.id, at: [0, y] };
    parts.push(s);
    if (s.hull && !hull) hull = s;
    prev = s;
    y += s.length;
  }
  const half = hull.width / 2;
  for (const e of design.sides) for (const side of [-1, 1]) parts.push(SIDE_MAKERS[e.kind](side, e.y, half, hull));
  return { parts: parts };
}

/* The starting rocket: a medium engine (250 kN), a 2 m x 4 m tank, a 2 m nose, two legs and two fins. */
const DESIGN = {
  stack: [engine(250e3), tank(2, 4), nose(2, 1.5)],
  sides: [{ kind: "leg", y: 1.2 }, { kind: "fin", y: 0 }]
};
const ROCKET = assemble(DESIGN);
