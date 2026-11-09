"use strict";

/* =====================================================================
   PARTS  (js/parts.js)
   The part types. Nothing here touches planck. A part only says how big
   it is: its mass, fuel and engine numbers come from rules.js. The
   factories below return a part's definition:
     id, name, color, kind
     length, width = its size, m
     faceTop, faceBottom = the width of the face where other parts can join on above / below (null = none)
     verts  = its shape, [x, y] points around its centre
     mass   = kg
     forces = a list of forces the part produces. Kinds so far:
                thrust  an engine: vac and sl (thrust in vacuum / at sea level, N), mdot (fuel kg/s at full throttle),
                        minThrottle, gimbalMax, gimbalRate, and "at" (the nozzle, relative to the part)
                drag    air drag on the part: cdAxial and cdSide (drag coefficients along and across the part),
                        depth (how far the part reaches into the screen, m). Areas come from the shape.
                fin     a tail surface: a sideways push that grows with the angle of the air: cn, depth
   Special flags: hull (the body that steering torque turns and the camera follows),
                  fuel (a part that holds fuel: dry and full mass, kg).
   design.js adds where each part sits (at) and what it is welded to (joint).
   PART_TYPES at the bottom is the library: what the builder offers and what each part's settings can be.
   ===================================================================== */

function bar(end, th) {              // a thin straight bar from (0,0) to end, th thick
  const L = Math.hypot(end[0], end[1]), nx = -end[1] / L * th / 2, ny = end[0] / L * th / 2;
  return [[nx, ny], [end[0] + nx, end[1] + ny], [end[0] - nx, end[1] - ny], [-nx, -ny]];
}

/* ---- body parts (they stack: one joins the next above or below) ---- */
function engine(vacN) {
  const sp = engineSpec(vacN), s = sp.scale;
  return { id: "engine", name: "engine", kind: "engine", color: "#7f8c8d", length: 0.8 * s, width: 1.2 * s, mass: sp.mass,
           faceTop: 1.2 * s, faceBottom: null,                    // the nozzle end has nothing to join
           verts: [[-0.5 * s, -0.4 * s], [0.5 * s, -0.4 * s], [0.6 * s, 0.4 * s], [-0.6 * s, 0.4 * s]],
           forces: [{ kind: "thrust", at: [0, -0.4 * s], vac: sp.vac, sl: sp.sl, mdot: sp.mdot, scale: s,
                      minThrottle: RULES.minThrottle, gimbalMax: GIMBAL_MAX, gimbalRate: GIMBAL_RATE },
                    { kind: "drag", cdAxial: 0.3, cdSide: 0.6, depth: 1.2 * s }] };
}

function tank(width, length) {
  const sp = tankSpec(width, length), w = width / 2, h = length / 2;
  return { id: "tank", name: "tank", kind: "tank", color: "#ecf0f1", length: length, width: width, mass: sp.dry + sp.fuel,
           faceTop: width, faceBottom: width,
           verts: [[-w, -h], [w, -h], [w, h], [-w, h]],
           hull: true, fuel: { dry: sp.dry, full: sp.fuel },
           forces: [{ kind: "drag", cdAxial: 0.1, cdSide: 0.8, depth: width }] };
}

function nose(width, length) {
  const sp = noseSpec(width, length), w = width / 2, t = 0.1 * width, h = length / 2;
  return { id: "nose", name: "nose cone", kind: "nose", color: "#e67e22", length: length, width: width, mass: sp.mass,
           faceTop: null, faceBottom: width,                      // the tip has nothing to join
           verts: [[-w, -h], [w, -h], [t, h], [-t, h]],
           forces: [{ kind: "drag", cdAxial: 0.3, cdSide: 0.8, depth: width }] };
}

/* ---- side parts: hung on the side of a tank. c = { px, half, jy, parent }: where the tank is (x), half its
        width, the height of the join (in rocket coordinates) and the tank itself. side: -1 left, 1 right ---- */
function makeFin(side, c) {          // root along the tank wall (2.4 m), tip 1.4 m out (0.8 m long)
  const v = [[-0.7, -1.2], [0.7, -1.2], [0.7, -0.4], [-0.7, 1.2]].map(function (p) { return [side * p[0], p[1]]; });
  const depth = c.parent.width, planform = 2.24 * depth;          // the shape's area (2.24 m2) x how far it reaches into the screen
  return { id: "fin", name: "fin", kind: "fin", color: "#c0392b",
           at: [c.px + side * (c.half + 0.7), c.jy], mass: planform * RULES.finAreal, verts: v,
           joint: { at: [c.px + side * c.half, c.jy] },
           forces: [{ kind: "fin", cn: FIN_CN, depth: depth },
                    { kind: "drag", cdAxial: 0.1, cdSide: 0, depth: depth }] };   // the sideways push is the fin force; this is just its own skin drag
}

function makeLeg(side, c) {          // a bar from the tank wall down and out
  const end = [side * 1.5, -1.7], len = Math.hypot(end[0], end[1]);
  return { id: "leg", name: "leg", kind: "leg", color: "#95a5a6",
           at: [c.px + side * c.half, c.jy], mass: len * RULES.legPerM, verts: bar(end, 0.2),
           joint: { at: [c.px + side * c.half, c.jy] },
           forces: [{ kind: "drag", cdAxial: 1.0, cdSide: 1.0, depth: 0.15 }] };
}

/* ---- the library. kind "stack" parts join end to end; kind "side" parts hang on a tank.
        params say what a part's settings may be: a list of choices, or a range in steps. ---- */
const PART_TYPES = {
  tank:   { label: "Tank", kind: "stack", sideOK: true,
            params: { width: { choices: RULES.tankWidths }, length: { min: RULES.gridM, max: RULES.tankMaxLength, step: RULES.gridM } },
            make: function (s) { return tank(s.width, s.length); } },
  engine: { label: "Engine", kind: "stack", sideOK: false,
            params: { thrust: { choices: RULES.engineSizes } },
            make: function (s) { return engine(s.thrust); } },
  nose:   { label: "Nose cone", kind: "stack", sideOK: false,
            params: { width: { choices: RULES.tankWidths }, length: { min: RULES.gridM, max: RULES.noseMaxLength, step: RULES.gridM } },
            make: function (s) { return nose(s.width, s.length); } },
  fin:    { label: "Fin", kind: "side", params: {}, make: function (s, side, c) { return makeFin(side, c); } },
  leg:    { label: "Leg", kind: "side", params: {}, make: function (s, side, c) { return makeLeg(side, c); } }
};
