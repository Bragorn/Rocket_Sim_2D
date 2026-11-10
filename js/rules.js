"use strict";

/* =====================================================================
   RULES  (js/rules.js)
   The rules EVERY part has to follow. Parts (parts.js) only say what
   size they are; mass, fuel, thrust and efficiency are worked out here,
   so nothing can quietly be better than real life allows.
   checkRules() tests a finished rocket against the rules: the game logs
   any breach when it starts, and tests/rules-tests.js runs it too.
   The numbers are real-world figures, rounded (kerosene + liquid oxygen).
   ===================================================================== */

const RULES = {
  propDensity: 1000,        // kg/m3, kerosene + liquid oxygen mixed
  tankAreal: 25,            // kg per m2 of tank wall (walls, caps and insulation)
  engineTWR: 60,            // engine thrust (vacuum) / engine weight: a bit below real engines
  ispSl: 280,               // s, engine efficiency at sea level
  ispVac: 310,              // s, in vacuum
  minThrottle: 0.4,         // an engine cannot run below this fraction of its thrust once lit
  engineThrustPerM2: 0.6e6, // an engine's width is sqrt(thrust / this): thrust per square meter of its footprint.
                            // Real engines manage about 1 MN per m2 or more, so these are a little bulkier than real
  engineAspect: 1.8,        // an engine is this many times longer than it is wide (the bell included)
  noseAreal: 15,            // kg per m2 of nose skin
  finAreal: 10,             // kg per m2 of fin (planform: shape area x depth)
  legPerM: 25,              // kg per meter of landing leg
  tankWidths: [1, 2, 4],    // the width classes (m)
  engineSizes: [100e3, 250e3, 600e3, 1500e3],   // the engines on offer: vacuum thrust, N
  tankMaxLength: 8, noseMaxLength: 4,   // m
  sideGridM: 0.1,           // fins and legs slide along a tank in steps of this (m)
  gridM: 0.5,               // tank and nose lengths come in multiples of this (m)
  tankDryMin: 0.02, tankDryMax: 0.20   // dry mass / fuel mass of a tank must land in this band (small tanks are
                                         // heavier for their fuel, big ones lighter: wall area grows slower than volume)
};

function tankSpec(width, length) {   // a cylinder: volume, fuel, dry mass
  const r = width / 2, volume = Math.PI * r * r * length;
  const area = Math.PI * width * length + 2 * Math.PI * r * r;
  return { volume: volume, fuel: volume * RULES.propDensity, dry: area * RULES.tankAreal };
}

function engineSpec(vacN) {          // everything about an engine from its vacuum thrust
  const w = Math.sqrt(vacN / RULES.engineThrustPerM2);
  return { vac: vacN, sl: vacN * RULES.ispSl / RULES.ispVac,       // thrust in vacuum and at sea level
           mass: vacN / (RULES.engineTWR * G0), width: w, length: w * RULES.engineAspect,
           mdot: vacN / (RULES.ispVac * G0) };                     // fuel burned per second at full throttle, kg/s
}

function noseSpec(width, length) {   // a cone with a blunt tip: skin area and mass
  const r1 = width / 2, r2 = 0.1 * width;
  const area = Math.PI * (r1 + r2) * Math.hypot(length, r1 - r2);
  return { area: area, mass: area * RULES.noseAreal };
}

/* Test a list of parts (ROCKET.parts) against the rules. Returns a list of breaches (empty = all good). */
function checkRules(parts) {
  const bad = [], ids = {};
  for (const d of parts) {
    if (ids[d.id]) bad.push(d.id + ": id used twice");
    ids[d.id] = true;
    if (!(d.mass > 0)) bad.push(d.id + ": mass must be above 0");
    if (d.joint && !parts.some(function (o) { return o.id === d.joint.to; })) bad.push(d.id + ": joined to a part that does not exist");
    if (d.fuel) {
      const frac = d.fuel.dry / d.fuel.full;
      if (frac < RULES.tankDryMin || frac > RULES.tankDryMax) bad.push(d.id + ": tank dry mass is " + (frac * 100).toFixed(1) + "% of its fuel (allowed " + RULES.tankDryMin * 100 + "-" + RULES.tankDryMax * 100 + "%)");
      if (Math.abs(d.mass - d.fuel.dry - d.fuel.full) > 1e-6) bad.push(d.id + ": mass is not dry + fuel");
      if (RULES.tankWidths.indexOf(d.width) < 0) bad.push(d.id + ": tank width " + d.width + " m is not one of " + RULES.tankWidths.join(", "));
    }
    if (d.kind === "tank" || d.kind === "nose") {
      const k = d.length / RULES.gridM;
      if (Math.abs(k - Math.round(k)) > 1e-9) bad.push(d.id + ": length " + d.length + " m is not a multiple of " + RULES.gridM + " m");
    }
    for (const f of d.forces || []) {
      if (f.kind !== "thrust") continue;
      if (d.mass < f.vac / (RULES.engineTWR * G0) - 1e-9) bad.push(d.id + ": engine is lighter than the rules allow (thrust-to-weight above " + RULES.engineTWR + ")");
      if (f.vac / (f.mdot * G0) > RULES.ispVac + 1e-9) bad.push(d.id + ": engine efficiency above " + RULES.ispVac + " s in vacuum");
      if (f.sl > f.vac * RULES.ispSl / RULES.ispVac * (1 + 1e-9)) bad.push(d.id + ": engine efficiency above " + RULES.ispSl + " s at sea level");
      if (f.minThrottle < RULES.minThrottle) bad.push(d.id + ": engine throttles lower than " + RULES.minThrottle * 100 + "%");
    }
  }
  return bad;
}
