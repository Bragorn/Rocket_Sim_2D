"use strict";

/* =====================================================================
   TELEMETRY  (js/telemetry.js)
   The flight recorder. From ignition on it saves a sample about 20 times a
   second of flight time into fixed arrays (no garbage while flying). It
   draws nothing: the flight report (report.js) and the CSV export read from
   here. When the arrays fill up, every second sample is dropped and the
   rate halves, so a flight of any length fits. Peaks are tracked on every
   step, so thinning the samples never loses them.
   ===================================================================== */

const TELE_CHANNELS = [              // index = position in tele.data
  { key: "t",      label: "Time",              csv: "t_s" },
  { key: "alt",    label: "Altitude",          csv: "altitude_m" },
  { key: "speed",  label: "Speed",             csv: "speed_ms" },
  { key: "vert",   label: "Vertical speed",    csv: "vertical_ms" },
  { key: "along",  label: "Sideways speed",    csv: "sideways_ms" },
  { key: "accel",  label: "Acceleration",      csv: "accel_g" },
  { key: "thrust", label: "Thrust",            csv: "thrust_N" },
  { key: "thr",    label: "Throttle",          csv: "throttle" },
  { key: "fuel",   label: "Fuel",              csv: "fuel_kg" },
  { key: "mass",   label: "Mass",              csv: "mass_kg" },
  { key: "dv",     label: "Delta-v left",      csv: "dv_left_ms" },
  { key: "drag",   label: "Drag",              csv: "drag_N" },
  { key: "rho",    label: "Air density",       csv: "air_density" },
  { key: "q",      label: "Dynamic pressure",  csv: "dynpressure_Pa" },
  { key: "aoa",    label: "Angle of attack",   csv: "aoa_deg" },
  { key: "tilt",   label: "Tilt",              csv: "tilt_deg" },
  { key: "apo",    label: "Apoapsis",          csv: "apoapsis_m" },
  { key: "peri",   label: "Periapsis",         csv: "periapsis_m" },
  { key: "range",  label: "Distance from pad", csv: "range_m" }
];
const TELE_MAX = 3000;               // samples kept (about 2.5 minutes at full rate, then it thins)
const TELE_RATE = 20;                // samples per second of flight time to start with

const tele = { n: 0, interval: 1 / TELE_RATE, nextT: 0, data: [], max: null, flags: null, dvUsed: 0, prevVert: 0 };
for (let c = 0; c < TELE_CHANNELS.length; c++) tele.data.push(new Float32Array(TELE_MAX));
const flightLog = [];                // recovered flights of this visit (the last 3), for the report
let flightCount = 0;                 // how many have been recovered, for their names

function teleReset() {
  tele.n = 0; tele.interval = 1 / TELE_RATE; tele.nextT = 0; tele.dvUsed = 0; tele.prevVert = 0;
  tele.max = { alt: 0, speed: 0, g: 0, q: 0, qAlt: 0 };
  tele.flags = {};
}

function teleDecimate() {
  const half = tele.n >> 1;
  for (let c = 0; c < tele.data.length; c++) { const a = tele.data[c]; for (let i = 0; i < half; i++) a[i] = a[2 * i]; }
  tele.n = half; tele.interval *= 2;
}

function teleRecord(p, v, r, alt, speed, vert) {
  if (tele.n >= TELE_MAX) teleDecimate();
  const i = tele.n++, d = tele.data, ux = p.x / r, uy = p.y / r, mass = totalMass();
  const o = orbitInfo(p, v), a = sim.hull.body.getAngle(), phi = Math.atan2(p.x, p.y);
  let tilt = (a + phi) * 180 / Math.PI; tilt = ((tilt + 180) % 360 + 360) % 360 - 180;
  const ang = Math.atan2(sim.p0.x * p.y - sim.p0.y * p.x, sim.p0.x * p.x + sim.p0.y * p.y);
  d[0][i] = sim.t;            d[1][i] = alt;                d[2][i] = speed;            d[3][i] = vert;
  d[4][i] = v.x * uy - v.y * ux;                            d[5][i] = sim.accG;         d[6][i] = sim.thrust;
  d[7][i] = controls.throttle; d[8][i] = sim.fuel;          d[9][i] = mass;
  d[10][i] = vacIsp() * G0 * Math.log(mass / Math.max(1, mass - sim.fuel));
  d[11][i] = sim.dragN;       d[12][i] = sim.rho;           d[13][i] = sim.q;           d[14][i] = sim.aoa;
  d[15][i] = tilt;            d[16][i] = o.bound ? o.ra - R - sim.refOffset : NaN;      d[17][i] = o.rp - R - sim.refOffset;
  d[18][i] = R * Math.abs(ang);
  if (o.bound && o.rp - R - sim.refOffset >= SPACE_ALT && !tele.flags.orbit) {
    tele.flags.orbit = true;
    log("In orbit: apoapsis " + fmtAlt(o.ra - R - sim.refOffset) + ", periapsis " + fmtAlt(o.rp - R - sim.refOffset), "flight");
  }
}

/* Called at the end of every physics step. Does nothing until the engine has been lit. */
function telemetryStep() {
  if (!sim.started) return;
  const f = tele.flags, m = tele.max, b = sim.hull.body, p = b.getPosition(), v = b.getLinearVelocity();
  const r = Math.hypot(p.x, p.y), alt = r - R - sim.refOffset, speed = Math.hypot(v.x, v.y), vert = (v.x * p.x + v.y * p.y) / r;
  if (!f.ignition) { f.ignition = true; log("Ignition", "flight"); }
  if (alt > m.alt) m.alt = alt;
  if (speed > m.speed) m.speed = speed;
  if (sim.accG > m.g) m.g = sim.accG;
  if (sim.q > m.q) { m.q = sim.q; m.qAlt = alt; }
  tele.dvUsed += sim.thrust / totalMass() * DT;
  if (!f.apogee && alt > 200 && tele.prevVert > 0 && vert <= 0) { f.apogee = true; log("Apogee " + fmtAlt(alt), "flight"); }
  tele.prevVert = vert;
  if (!f.space && alt >= SPACE_ALT) { f.space = true; log("Reached space (" + SPACE_ALT / 1000 + " km)", "flight"); }
  if (!f.maxq && m.q > 2000 && sim.q < m.q * 0.85) { f.maxq = true; log("Max Q " + (m.q / 1000).toFixed(1) + " kPa at " + fmtAlt(m.qAlt), "flight"); }
  if (sim.t >= tele.nextT) { teleRecord(p, v, r, alt, speed, vert); tele.nextT += tele.interval; }
}

/* ---- what the flight added up to ---- */
function flightSummary() {
  const p = sim.hull.body.getPosition(), ang = Math.atan2(sim.p0.x * p.y - sim.p0.y * p.x, sim.p0.x * p.x + sim.p0.y * p.y);
  return { time: sim.t, maxAlt: tele.max.alt, maxSpeed: tele.max.speed, maxG: tele.max.g, maxQ: tele.max.q, maxQAlt: tele.max.qAlt,
           touchdown: sim.touchdownSpeed, fuelLeft: sim.fuel, fuelUsed: sim.fuelFull - sim.fuel, dvSpent: tele.dvUsed,
           range: R * Math.abs(ang), samples: tele.n };
}

function summaryRows(s) {            // [label, text] pairs, for the recovery card and the report
  return [["Flight time", fmtTime(s.time)], ["Highest point", fmtAlt(s.maxAlt)], ["Top speed", s.maxSpeed.toFixed(0) + " m/s"],
          ["Peak acceleration", s.maxG.toFixed(1) + " g"], ["Max Q", (s.maxQ / 1000).toFixed(1) + " kPa at " + fmtAlt(s.maxQAlt)],
          ["Delta-v spent", s.dvSpent.toFixed(0) + " m/s"], ["Fuel left", s.fuelLeft.toFixed(0) + " kg of " + (s.fuelLeft + s.fuelUsed).toFixed(0) + " kg"],
          ["Distance from the pad", fmtAlt(s.range)], ["Touchdown speed", s.touchdown === null ? "-" : s.touchdown.toFixed(1) + " m/s"]];
}

/* Can the rocket be recovered now? It has to have flown, be down, and be (nearly) still. */
function recoverable() {
  if (!sim.flown) return { ok: false, reason: "Nothing to recover yet: launch first." };
  if (sim.airborne) return { ok: false, reason: "Still in the air." };
  const v = sim.hull.body.getLinearVelocity(), speed = Math.hypot(v.x, v.y), spin = Math.abs(sim.hull.body.getAngularVelocity());
  if (speed > 0.3) return { ok: false, reason: "Still moving (" + speed.toFixed(1) + " m/s). Wait until it is at rest." };
  if (spin > 0.1) return { ok: false, reason: "Still tipping over." };
  return { ok: true, reason: "" };
}

/* ---- snapshots (for the report and the export) ---- */
function teleSnapshot(label, status) {
  const channels = [];
  for (let c = 0; c < tele.data.length; c++) channels.push(tele.data[c].slice(0, tele.n));
  return { label: label, status: status || "in progress", n: tele.n, channels: channels, design: typeof currentDesign !== "undefined" && currentDesign ? currentDesign.name || "Rocket" : "Rocket",
           events: logAll.map(function (e) { return { t: e.t, kind: e.kind, text: e.text }; }), summary: flightSummary() };
}

function archiveFlight(status) {
  const snap = teleSnapshot("Flight " + (++flightCount), status);
  flightLog.push(snap);
  if (flightLog.length > 3) flightLog.shift();
  try { localStorage.setItem("rocketsim.lastFlight", JSON.stringify({ design: snap.design, status: status, summary: snap.summary, events: snap.events.slice(-40) })); } catch (e) { /* storage blocked: fine */ }
  return snap;
}

function buildCsv(snap) {
  snap = snap || teleSnapshot("this flight");
  const lines = [TELE_CHANNELS.map(function (c) { return c.csv; }).join(",")];
  for (let i = 0; i < snap.n; i++) {
    const row = [];
    for (let c = 0; c < TELE_CHANNELS.length; c++) { const x = snap.channels[c][i]; row.push(isFinite(x) ? x.toFixed(4) : ""); }
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function exportCsv(snap) {
  snap = snap || teleSnapshot("this flight");
  if (snap.n === 0) return false;
  const blob = new Blob([buildCsv(snap)], { type: "text/csv" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "flight-" + (snap.design.replace(/[^\w\- ]+/g, "").trim() || "rocket").replace(/ +/g, "-") + "-" + snap.label.toLowerCase().replace(/ +/g, "-") + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  return true;
}
