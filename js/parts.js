"use strict";

/* =====================================================================
   PARTS  (js/parts.js)
   The rocket as plain data. Nothing here touches planck.
   Each part has:
     id, name, color
     at     = [x, y] where the part's centre sits, in meters above the rocket's bottom (engine bottom)
     verts  = its shape, [x, y] points around its centre
     mass   = kg
     joint  = { to: id of another part, at: [x, y] } weld it to that part at that point (same units as "at")
     forces = a list of forces the part produces. Kinds so far:
                thrust  an engine: max, minThrottle, gimbalMax, gimbalRate, and "at" (the nozzle, relative to the part)
                drag    air drag on the part: cdAxial and cdSide (drag coefficients along and across the part),
                        depth (how far the part reaches into the screen, m). Areas come from the shape.
                fin     a tail surface: a sideways push that grows with the angle of the air: cn, depth
   Special flags: hull (the body that steering torque turns and the camera follows),
                  fuel (the part that holds fuel: dry and full mass, kg).
   ===================================================================== */

const PAD_CLEARANCE = 0.5 + 0.02;    // the engine's bottom starts this high: feet hang 0.5 m lower and start 2 cm off the ground

function bar(end, th) {              // a thin straight bar from (0,0) to end, th thick
  const L = Math.hypot(end[0], end[1]), nx = -end[1] / L * th / 2, ny = end[0] / L * th / 2;
  return [[nx, ny], [end[0] + nx, end[1] + ny], [end[0] - nx, end[1] - ny], [-nx, -ny]];
}

function fin(side) {                 // side: -1 = left fin, 1 = right fin. Fixed to the tank wall near the bottom
  const v = [[-0.7, -1.2], [0.7, -1.2], [0.7, -0.4], [-0.7, 1.2]].map(function (p) { return [side * p[0], p[1]]; });
  return { id: side < 0 ? "finL" : "finR", name: side < 0 ? "left fin" : "right fin", color: "#c0392b",
           at: [side * 1.7, 1.2], mass: FIN_MASS, verts: v, joint: { to: "tank", at: [side * 1, 1.2] },
           forces: [{ kind: "fin", cn: FIN_CN, depth: 2 },
                    { kind: "drag", cdAxial: 0.1, cdSide: 0, depth: 2 }] };   // the sideways push is the fin force; this is just its own skin drag
}

const ROCKET = {
  parts: [
    { id: "engine", name: "engine", color: "#7f8c8d", at: [0, 0.4], mass: 300,
      verts: [[-0.5, -0.4], [0.5, -0.4], [0.6, 0.4], [-0.6, 0.4]],
      joint: { to: "tank", at: [0, 0.8] },
      forces: [{ kind: "thrust", at: [0, -0.4], max: MAX_THRUST, minThrottle: MIN_THROTTLE, gimbalMax: GIMBAL_MAX, gimbalRate: GIMBAL_RATE },
               { kind: "drag", cdAxial: 0.3, cdSide: 0.6, depth: 1.2 }] },

    { id: "tank", name: "tank", color: "#ecf0f1", at: [0, 2.8], mass: TANK_DRY + FUEL_FULL,
      verts: [[-1, -2], [1, -2], [1, 2], [-1, 2]],
      hull: true, fuel: { dry: TANK_DRY, full: FUEL_FULL },
      forces: [{ kind: "drag", cdAxial: 0.1, cdSide: 0.8, depth: 2 }] },

    { id: "nose", name: "nose", color: "#e67e22", at: [0, 5.55], mass: 150,
      verts: [[-1, -0.75], [1, -0.75], [0.2, 0.75], [-0.2, 0.75]],
      joint: { to: "tank", at: [0, 4.8] },
      forces: [{ kind: "drag", cdAxial: 0.3, cdSide: 0.8, depth: 2 }] },

    { id: "legL", name: "left leg", color: "#95a5a6", at: [-1, 1.2], mass: 50,
      verts: bar([-1.5, -1.7], 0.2),
      joint: { to: "tank", at: [-1, 1.2] },
      forces: [{ kind: "drag", cdAxial: 1.0, cdSide: 1.0, depth: 0.15 }] },

    { id: "legR", name: "right leg", color: "#95a5a6", at: [1, 1.2], mass: 50,
      verts: bar([1.5, -1.7], 0.2),
      joint: { to: "tank", at: [1, 1.2] },
      forces: [{ kind: "drag", cdAxial: 1.0, cdSide: 1.0, depth: 0.15 }] },

    fin(-1),
    fin(1)
  ]
};
