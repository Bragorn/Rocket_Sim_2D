"use strict";

/* =====================================================================
   WORLD  (js/world.js)
   Turns the data in parts.js into a planck world: the planet, one body
   per part, weld joints, and gravity. `sim` is everything about the
   current flight; buildWorld() replaces it (that is what reset does).
   ===================================================================== */

let sim = null;

function addGravity(world) {         // pull every dynamic body toward the planet's center (0, 0)
  for (let b = world.getBodyList(); b; b = b.getNext()) {
    if (!b.isDynamic()) continue;
    const p = b.getPosition(), r = Math.hypot(p.x, p.y), k = -b.getMass() * MU / (r * r * r);
    b.applyForceToCenter(P(p.x * k, p.y * k), true);
  }
}

function buildWorld() {
  const world = new planck.World({ gravity: P(0, 0) });
  const ground = world.createBody({ type: "static", position: P(0, 0) });
  ground.createFixture({ shape: new planck.Circle(R), friction: 0.8 });

  const base = R + PAD_GAP;           // the rocket's lowest point sits this far above the ground
  const parts = [], byId = {}, joints = [], tanks = [];

  for (const def of ROCKET.parts) {   // one body per part
    const verts = def.verts.map(function (v) { return P(v[0], v[1]); });
    const body = world.createBody({ type: "dynamic", position: P(def.at[0], base + def.at[1]) });
    // filterGroupIndex -1: the parts of one rocket never collide with each other (only with the ground)
    const fixture = body.createFixture({ shape: new planck.Polygon(verts), density: def.mass / polyArea(verts), friction: 0.8, restitution: 0, filterGroupIndex: -1 });
    const part = { def: def, name: def.name, color: def.color, body: body, verts: verts,
                   forces: (def.forces || []).map(function (f) { return Object.assign({ now: 0, angle: 0 }, f); }) };   // now = force this step, angle = gimbal
    for (const f of part.forces) prepareAero(part, f);
    if (def.fuel) tanks.push({ part: part, fixture: fixture, area: polyArea(verts), dry: def.fuel.dry, full: def.fuel.full });
    parts.push(part);
    byId[def.id] = part;
  }

  for (const part of parts) {         // weld the parts together
    const jd = part.def.joint;
    if (!jd) continue;
    const j = world.createJoint(new planck.WeldJoint({ frequencyHz: 0, dampingRatio: 0 }, byId[jd.to].body, part.body, P(jd.at[0], base + jd.at[1])));
    joints.push({ name: part.name, j: j, force: 0, peak: 0 });
  }

  const hull = byId[ROCKET.hull.id];
  let hx0 = Infinity, hx1 = -Infinity;
  for (const v of hull.verts) { hx0 = Math.min(hx0, v.x); hx1 = Math.max(hx1, v.x); }
  const fuelFull = tanks.reduce(function (s, t) { return s + t.full; }, 0);
  sim = { world: world, ground: ground, parts: parts, joints: joints, hull: hull, hullWidth: hx1 - hx0,
          tanks: tanks, fuelFull: fuelFull, fuel: fuelFull,             // all tanks share one pool of fuel, drained evenly
          refOffset: ROCKET.hull.at[1] + PAD_GAP,                       // height of the hull's centre on the pad: altitudes are shown minus this
          thrust: 0, airborne: false, t: 0, emptyLogged: false,
          started: false, flown: false, touchdownSpeed: null,           // started = engine lit once (the flight clock runs); flown = has been in the air
          dragN: 0, accG: 1, pvx: 0, pvy: 0, p0: { x: hull.body.getPosition().x, y: hull.body.getPosition().y },
          rho: RHO0, q: 0, maxQ: 0, aoa: 0 };
  teleReset();

  world.on("begin-contact", function (ct) {          // the first touch after being in the air gets reported
    const A = ct.getFixtureA().getBody(), B = ct.getFixtureB().getBody();
    if (A !== ground && B !== ground) return;
    if (!sim.airborne) return;
    sim.airborne = false;
    const body = A === ground ? B : A, p = body.getPosition(), r = Math.hypot(p.x, p.y);
    const ux = p.x / r, uy = p.y / r, v = body.getLinearVelocity();
    const vert = v.x * ux + v.y * uy, side = v.x * uy - v.y * ux;
    sim.touchdownSpeed = Math.abs(vert);
    const who = (parts.find(function (q) { return q.body === body; }) || { name: "?" }).name;
    log("T+" + sim.t.toFixed(1) + " s: touchdown, " + who + " first, " + Math.abs(vert).toFixed(1) + " m/s down, " + Math.abs(side).toFixed(1) + " m/s sideways");
  });
  log("new rocket on the pad. Throttle starts at 0: press W to light the engine.");
}

function totalMass() {
  return sim.parts.reduce(function (m, q) { return m + q.body.getMass(); }, 0);
}

function maxThrust() {               // thrust of all engines at full throttle, in the air pressure right now, N
  const pf = sim.rho / RHO0;
  let t = 0;
  for (const p of sim.parts) for (const f of p.forces) if (f.kind === "thrust") t += f.vac - (f.vac - f.sl) * pf;
  return t;
}

function vacIsp() {                  // efficiency of the engines together in vacuum, s (0 = no engines)
  let thrust = 0, flow = 0;
  for (const p of sim.parts) for (const f of p.forces) if (f.kind === "thrust") { thrust += f.vac; flow += f.mdot; }
  return flow > 0 ? thrust / (flow * G0) : 0;
}
