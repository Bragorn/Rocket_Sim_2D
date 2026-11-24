"use strict";

/* =====================================================================
   RENDER  (js/render.js)
   Drawing only. The canvas fills the window. The top part is the world
   (flight view or map view) with a small readout panel; a bar along the
   bottom (BAR_H tall) holds the gauges, the rocket numbers, the message
   log and the key hints. Reads `sim` and `controls`, never changes them.
   The zoom and the map toggle are view settings and live here.
   ===================================================================== */

const cv = document.getElementById("view"), c = cv.getContext("2d");
const BAR_H = 84;                    // height of the bottom bar, px
let W = 0, Hh = 0;                   // width of the window, and height of the WORLD area (window minus the bar)
let S = 9, St = 9;                   // flight view zoom, pixels per meter: now, and where it is heading
let mapMode = false, mapS = 1e-4, mapSt = 1e-4;   // M: the whole-planet view and its zoom (now, target)
const ZOOM_EASE = 10;                // bigger = the zoom catches up with its target faster

function resize() {
  const k = Math.min(window.devicePixelRatio || 1, 2);    // sharp text on retina screens
  W = window.innerWidth;
  Hh = Math.max(200, window.innerHeight - BAR_H);
  cv.width = Math.floor(W * k); cv.height = Math.floor((Hh + BAR_H) * k);
  cv.style.width = W + "px"; cv.style.height = (Hh + BAR_H) + "px";
  c.setTransform(k, 0, 0, k, 0, 0);
}

function zoomBy(f) {                 // asks for a zoom; updateView() eases toward it
  if (mapMode) mapSt = Math.min(1e-2, Math.max(1e-6, mapSt * f));
  else St = Math.min(60, Math.max(0.2, St * f));
}

function updateView(dt) {            // ease the zoom toward its target, a bit every frame
  const k = 1 - Math.exp(-ZOOM_EASE * dt);
  S *= Math.pow(St / S, k);
  mapS *= Math.pow(mapSt / mapS, k);
  updateAirFx(dt);
}

function toggleMap() {
  mapMode = !mapMode;
  if (mapMode) {                     // fit the whole orbit (or at least the planet) on screen
    const p = sim.hull.body.getPosition(), o = orbitInfo(p, sim.hull.body.getLinearVelocity());
    const far = Math.max(R * 1.15, Math.min(o.ra, 8 * R), o.r);
    mapS = mapSt = 0.40 * Math.min(W, Hh) / (far + o.r);       // the view is centred on the rocket, so the far side of the orbit is up to (its height + the orbit's size) away
  }
}

function niceStep(x) {
  const mag = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), r = x / mag;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
}

/* ---- looks: repeatable random numbers, the stars, the air streaks, the planet's surface ---- */
function hash3(i, j, k) {            // a random-looking number from 0 up to 1 that is always the same for the same i, j, k
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawStars(sky, phi) {       // they fade in as the sky goes dark, and barely move (they are very far away): a slow slide as you go round the planet
  const a = clamp((sky - 0.35) / 0.55, 0, 1);
  if (a <= 0) return;
  const drift = phi * W * 0.06;
  for (let k = 0; k < 140; k++) {
    const x = ((hash3(k, 0, 7) * W - drift) % W + W) % W, y = hash3(k, 1, 7) * Hh * 0.9, b = hash3(k, 2, 7), s = b > 0.85 ? 2 : 1;
    c.fillStyle = "rgba(255,255,255," + (a * (0.25 + 0.6 * b)).toFixed(2) + ")";
    c.fillRect(x, y, s, s);
  }
}

/* ---- exhaust smoke ----
   An engine that is burning in air leaves a trail of soft puffs: they start at the nozzle, slow down quickly, grow and fade, and stay where they were left (the air is
   still), so the rocket draws a smoke trail across the sky. Thick near the ground, gone by about 40 km where the air is too thin to show it. Frozen while paused,
   and off above 2x time warp. (Air effects on the rocket itself, and heating glow, are not drawn: that comes with real heating.) */
const FX_MAX = 900;                  // puffs alive at once
const FX_RATE = 45;                  // puffs per second from each engine at full throttle at the ground
const FX_ALPHA = 0.30;               // how opaque a fresh puff is
const fx = { head: 0, x: new Float64Array(FX_MAX), y: new Float64Array(FX_MAX), vx: new Float64Array(FX_MAX), vy: new Float64Array(FX_MAX),
             size: new Float64Array(FX_MAX), dens: new Float64Array(FX_MAX), age: new Float64Array(FX_MAX), life: new Float64Array(FX_MAX) };

function emitSmoke(dts) {
  for (const part of sim.parts) for (const f of part.forces) {
    if (f.kind !== "thrust" || f.now <= 0) continue;
    const n = part.body.getWorldPoint(P(part.ox + f.at[0], part.oy + f.at[1])), dens = Math.sqrt(airDensity(Math.hypot(n.x, n.y) - R) / RHO0);
    if (dens < 0.03) continue;                                // too thin for smoke
    const a = part.body.getAngle() + f.angle, ex = Math.sin(a), ey = -Math.cos(a);       // the way the exhaust goes (against the push)
    const rate = FX_RATE * (f.now / f.vac) * dens * dts;
    let count = Math.floor(rate) + (Math.random() < rate - Math.floor(rate) ? 1 : 0);
    while (count-- > 0) {
      const i = fx.head, sp = 25 + 20 * Math.random(), side = (Math.random() - 0.5) * 8;
      fx.head = (fx.head + 1) % FX_MAX;
      fx.x[i] = n.x + ex * f.scale * 0.5 + (Math.random() - 0.5) * 0.3; fx.y[i] = n.y + ey * f.scale * 0.5 + (Math.random() - 0.5) * 0.3;
      fx.vx[i] = ex * sp - ey * side; fx.vy[i] = ey * sp + ex * side;
      fx.size[i] = Math.max(0.3, f.scale * 0.5); fx.dens[i] = dens; fx.age[i] = 0; fx.life[i] = 2.5 + 2 * Math.random();
    }
  }
}

/* ---- the air trails off the rocket (Pause menu: "Air effects": off, ribbons, haze, both) ----
   Each piece of rocket moving through air fast enough leaves a trail from three points: its front, and its two widest points (the edges of fins and legs).
   Every frame a sample of where each point is goes into its trail, and stays where it was left (the air is still), so each trail is the real path the point took
   through the air. Ribbons draw it as a line that thickens and fades as it ages, haze as soft puffs that grow and fade. Both spread wider with age, and only
   show in dense air at speed. Nothing is drawn in front of the rocket: the trails only hold places the rocket has already been. */
let airLook = "off";
const AIR_LOOKS = ["off", "ribbons", "haze", "both"];
const TRAIL_LIFE = 1.6;              // seconds a bit of trail lasts
const trails = {}, bodyIds = new WeakMap();
let bodyCount = 0;
function bodyId(b) { let id = bodyIds.get(b); if (id === undefined) { id = ++bodyCount; bodyIds.set(b, id); } return id; }

function updateTrails(dts) {
  for (const key in trails) {                                   // age what is there
    const t = trails[key];
    for (const p of t.pts) p.age += dts;
    while (t.pts.length && t.pts[0].age > TRAIL_LIFE) t.pts.shift();
    if (t.pts.length === 0) delete trails[key];
  }
  if (airLook === "off") return;
  const bodies = [];
  for (const part of sim.parts) if (bodies.indexOf(part.body) < 0) bodies.push(part.body);
  for (const body of bodies) {                                  // each piece of rocket on its own body
    const v = body.getLinearVelocity(), speed = Math.hypot(v.x, v.y);
    if (speed < 30) continue;
    const cw = body.getWorldCenter(), air = clamp(Math.sqrt(airDensity(Math.hypot(cw.x, cw.y) - R) / RHO0) * 1.5, 0, 1) * clamp((speed - 30) / 120, 0, 1);
    if (air < 0.02) continue;
    const dx = v.x / speed, dy = v.y / speed;
    let tp = -Infinity, tw = null, lo = Infinity, lw = null, hi = -Infinity, hw = null, width = 0.5;
    for (const part of sim.parts) {
      if (part.body !== body) continue;
      width = Math.max(width, part.def.width || 1);
      for (const q of part.verts) {
        const w = body.getWorldPoint(P(part.ox + q.x, part.oy + q.y)), pr = w.x * dx + w.y * dy, lt = -w.x * dy + w.y * dx;
        if (pr > tp) { tp = pr; tw = w; }
        if (lt < lo) { lo = lt; lw = w; }
        if (lt > hi) { hi = lt; hw = w; }
      }
    }
    const id = bodyId(body);
    const add = function (k, w, side, s) {
      const key = id + ":" + k, t = trails[key] || (trails[key] = { pts: [], side: side, w: width });
      t.w = width; t.pts.push({ x: w.x, y: w.y, age: 0, dx: dx, dy: dy, s: s });
      if (t.pts.length > 150) t.pts.shift();
    };
    add(0, tw, 0, air); add(1, lw, -1, air * 0.6); add(2, hw, 1, air * 0.6);
  }
}

function updateAirFx(dt) {           // called every frame (from updateView): the exhaust smoke and the air trails. Frozen while paused, off above 2x time warp
  if (paused || !sim) return;
  const w = typeof warp !== "undefined" ? warp : 1;
  if (w > 2) { fx.life.fill(0); for (const key in trails) delete trails[key]; return; }
  const dts = dt * w, k = Math.exp(-2.5 * dts);
  for (let i = 0; i < FX_MAX; i++) {
    if (!(fx.age[i] < fx.life[i])) continue;
    fx.x[i] += fx.vx[i] * dts; fx.y[i] += fx.vy[i] * dts; fx.vx[i] *= k; fx.vy[i] *= k; fx.age[i] += dts;
  }
  emitSmoke(dts);
  updateTrails(dts);
}

function fxScreen(cam, x, y, out) {  // where a world point is on the flight view
  out[0] = W / 2 + ((x - R * cam.ux) * cam.ex + (y - R * cam.uy) * cam.ey) * cam.Z;
  out[1] = cam.hy - ((x * cam.ux + y * cam.uy - R) - cam.alt) * cam.Z;
}

let smokeSprite = null;
function smokePuff() {               // a soft round puff, painted once
  if (smokeSprite) return smokeSprite;
  const cv2 = document.createElement("canvas");
  cv2.width = 64; cv2.height = 64;
  const k = cv2.getContext("2d"), g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(230,230,235,1)"); g.addColorStop(0.5, "rgba(230,230,235,0.4)"); g.addColorStop(1, "rgba(230,230,235,0)");
  k.fillStyle = g; k.fillRect(0, 0, 64, 64);
  smokeSprite = cv2;
  return cv2;
}

function drawSmoke(cam) {            // behind the rocket
  const sp = [0, 0];
  for (let i = 0; i < FX_MAX; i++) {
    if (!(fx.age[i] < fx.life[i])) continue;
    fxScreen(cam, fx.x[i], fx.y[i], sp);
    const t = fx.age[i] / fx.life[i], rPx = Math.max(2, fx.size[i] * (0.5 + 3 * t) * cam.Z);
    if (sp[0] < -rPx || sp[0] > W + rPx || sp[1] < -rPx || sp[1] > Hh + rPx) continue;
    c.globalAlpha = FX_ALPHA * fx.dens[i] * Math.pow(1 - t, 1.5);
    c.drawImage(smokePuff(), sp[0] - rPx, sp[1] - rPx, 2 * rPx, 2 * rPx);
  }
  c.globalAlpha = 1;
}

function drawAirTrails(cam) {        // behind the rocket
  if (airLook === "off") return;
  const sp = [0, 0], sq = [0, 0], Z = cam.Z, ribbons = airLook === "ribbons" || airLook === "both", haze = airLook === "haze" || airLook === "both";
  for (const key in trails) {
    const t = trails[key], pts = t.pts;
    if (haze) {
      for (const p of pts) {
        const a = p.age / TRAIL_LIFE, o = t.side * t.w * (0.15 + 1.2 * a), r = Math.max(2, t.w * (0.3 + 2 * a) * Z);
        fxScreen(cam, p.x - p.dy * o, p.y + p.dx * o, sp);
        if (sp[0] < -r || sp[0] > W + r || sp[1] < -r || sp[1] > Hh + r) continue;
        c.globalAlpha = 0.16 * p.s * Math.pow(1 - a, 1.5);
        c.drawImage(smokePuff(), sp[0] - r, sp[1] - r, 2 * r, 2 * r);
      }
      c.globalAlpha = 1;
    }
    if (ribbons) {
      c.lineCap = "round";
      for (let i = 0; i + 1 < pts.length; i++) {
        const p0 = pts[i], p1 = pts[i + 1], a = p0.age / TRAIL_LIFE;
        const o0 = t.side * t.w * (0.15 + 1.2 * a), o1 = t.side * t.w * (0.15 + 1.2 * p1.age / TRAIL_LIFE);
        fxScreen(cam, p0.x - p0.dy * o0, p0.y + p0.dx * o0, sp); fxScreen(cam, p1.x - p1.dy * o1, p1.y + p1.dx * o1, sq);
        if (sp[0] < -60 || sp[0] > W + 60 || sp[1] < -60 || sp[1] > Hh + 60) continue;
        c.lineWidth = 1.2 + 4 * a; c.strokeStyle = "rgba(255,255,255," + (0.5 * p0.s * Math.pow(1 - a, 1.3)).toFixed(3) + ")";
        c.beginPath(); c.moveTo(sp[0], sp[1]); c.lineTo(sq[0], sq[1]); c.stroke();
      }
      c.lineCap = "butt";
    }
  }
}

/* A part's own colour, turning green, yellow, orange and red as the last impact on it nears what it can take. */
function stressColor(hex, s) {
  const base = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const stops = [[0.0, [60, 200, 90]], [0.4, [241, 196, 15]], [0.75, [255, 140, 30]], [1.0, [255, 50, 40]]], x = clamp(s, 0, 1);
  let hue = stops[stops.length - 1][1];
  for (let i = 0; i + 1 < stops.length; i++) if (x <= stops[i + 1][0]) { const u = (x - stops[i][0]) / (stops[i + 1][0] - stops[i][0]); hue = stops[i][1].map(function (v, k) { return v + (stops[i + 1][1][k] - v) * u; }); break; }
  const m = clamp(s / 0.2, 0, 1);
  return "rgb(" + base.map(function (v, k) { return Math.round(v + (hue[k] - v) * m); }).join(",") + ")";
}

/* The engine's flame, drawn in the rocket's own frame so it stays on the nozzle. Its shape comes from the pressure of the exhaust against the air round it:
   exhaust pressure = EXIT_ATM x (how hard the engine is throttled), air pressure thins with height. Much higher than the air: the exhaust spreads out and
   swells and pinches along its length (the pinches are where the Mach diamonds are, brightest where the pressures are far apart). The same as the air: a clean,
   straight flame, no diamonds. Lower than the air (low down): squeezed narrower. Nothing is placed by hand: the pinch positions come from the same formula. */
const EXIT_ATM = 0.5;                // nozzle exit pressure at full throttle, as a share of sea-level air pressure (so the flame is straightest about 9 km up)
function drawPlume(part, f, T) {
  const a = part.body.getAngle() + f.angle, dx = -Math.sin(a), dy = Math.cos(a);           // the way the engine pushes; the flame goes the other way
  const n = part.body.getWorldPoint(P(part.ox + f.at[0], part.oy + f.at[1])), pf = clamp(sim.rho / RHO0, 0.0005, 1);
  const Dn = f.scale, ratio = EXIT_ATM * clamp(f.level || 0, 0.05, 1) / pf, grow = Math.pow(clamp(ratio, 0.3, 60), 0.25);
  const amp = clamp(Math.abs(Math.log(ratio)), 0, 3) * 0.1, lam = 1.4 * Dn * grow, phase = (Math.random() - 0.5) * 0.4;
  const L = (1.2 + 4 * f.now / f.vac) * Dn * (0.92 + Math.random() * 0.16) * clamp(0.85 + 0.2 * grow, 0.85, 2.2);
  const at = function (s, u) { return T({ x: n.x - dx * s + dy * u, y: n.y - dy * s - dx * u }); };     // s along the flame, u across it
  const half = function (s, len) {                                                          // half the width of the flame, s along it
    const env = 1 + (grow - 1) * (1 - Math.exp(-s / (1.2 * Dn))), osc = 1 + amp * Math.cos(6.2832 * s / lam + phase) * Math.exp(-s / (4 * Dn));
    return 0.45 * Dn * env * osc * Math.sqrt(Math.max(0, 1 - Math.pow(s / len, 1.6)));
  };
  const shape = function (len, k) {
    c.beginPath();
    for (let i = 0; i <= 32; i++) { const s = len * i / 32, p = at(s, half(s, len) * k); if (i === 0) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]); }
    for (let i = 32; i >= 0; i--) { const s = len * i / 32, p = at(s, -half(s, len) * k); c.lineTo(p[0], p[1]); }
    c.closePath();
  };
  const s0 = at(0, 0), s1 = at(L, 0);
  let g = c.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
  g.addColorStop(0, "rgba(255,235,170,0.95)"); g.addColorStop(0.35, "rgba(255,150,50,0.8)"); g.addColorStop(1, "rgba(255,90,30,0)");
  c.fillStyle = g; shape(L, 1.25); c.fill();
  g = c.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
  g.addColorStop(0, "rgba(255,255,240,1)"); g.addColorStop(0.5, "rgba(255,230,140,0.7)"); g.addColorStop(1, "rgba(255,200,80,0)");
  c.fillStyle = g; shape(L * 0.62, 0.5); c.fill();
  c.globalCompositeOperation = "lighter";                                                   // bright where the flame pinches
  for (let m = 0; m < 12; m++) {
    const s = (Math.PI * (2 * m + 1) - phase) * lam / 6.2832;
    if (s > 0.8 * L) break;
    if (s < 0.25 * Dn) continue;
    const w = half(s, L) * 0.9, h = lam * 0.14, al = clamp(amp * 6, 0, 0.85) * Math.pow(1 - s / L, 0.8);
    if (al < 0.03) continue;
    const p1 = at(s - h, 0), p2 = at(s, w), p3 = at(s + h, 0), p4 = at(s, -w);
    c.fillStyle = "rgba(255,250,225," + al.toFixed(2) + ")"; c.beginPath();
    c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.lineTo(p3[0], p3[1]); c.lineTo(p4[0], p4[1]); c.closePath(); c.fill();
  }
  c.globalCompositeOperation = "source-over";
}

function drawMapStars() {            // fixed on the screen: they are very far away
  for (let k = 0; k < 120; k++) {
    const b = hash3(k, 2, 9);
    c.fillStyle = "rgba(255,255,255," + (0.2 + 0.5 * b).toFixed(2) + ")";
    c.fillRect(hash3(k, 0, 9) * W, hash3(k, 1, 9) * Hh, b > 0.9 ? 2 : 1, b > 0.9 ? 2 : 1);
  }
}

function drawFlight(alt, phi) {
  const p = sim.hull.body.getPosition();
  const ux = Math.sin(phi), uy = Math.cos(phi), ex = Math.cos(phi), ey = -Math.sin(phi), HOR = 0.62;
  const T = (wp) => [W / 2 + ((wp.x - R * ux) * ex + (wp.y - R * uy) * ey) * S,
                     Hh * HOR - ((wp.x * ux + wp.y * uy - R) - alt) * S];

  const sky = clamp(alt / 70000, 0, 1);
  c.fillStyle = "rgb(" + Math.round(135 - 125 * sky) + "," + Math.round(190 - 175 * sky) + "," + Math.round(235 - 195 * sky) + ")";
  c.fillRect(0, 0, W, Hh);
  drawStars(sky, phi);

  const gyS = Hh * HOR + alt * S;                            // ground and its marks
  if (gyS < Hh) {
    const top = Math.max(0, gyS);
    c.fillStyle = "#3d5a2e"; c.fillRect(0, top, W, Hh - top);
    c.fillStyle = "#2c4321"; c.fillRect(0, gyS, W, 3);
    const stepX = Math.max(1, niceStep(140 / S)), sF = R * phi;
    c.strokeStyle = "rgba(255,255,255,0.45)"; c.fillStyle = "rgba(255,255,255,0.8)";
    c.textAlign = "center"; c.textBaseline = "top";
    c.beginPath();
    for (let k = Math.ceil((sF - W / 2 / S) / stepX), n = 0; k * stepX <= sF + W / 2 / S && n < 80; k++, n++) {
      const X = Math.round(W / 2 + (k * stepX - sF) * S) + 0.5;
      c.moveTo(X, gyS); c.lineTo(X, gyS + 8);
      c.fillText(fmtAlt(k * stepX), X, gyS + 11);
    }
    c.stroke();
    c.textAlign = "left";
  }

  const cam = { ux: ux, uy: uy, ex: ex, ey: ey, hy: Hh * HOR, alt: alt, Z: S };
  drawSmoke(cam);                                            // the exhaust smoke left in the air, behind the rocket
  drawAirTrails(cam);                                        // the air trails off the rocket (pause menu: Air effects)

  for (const part of sim.parts) for (const f of part.forces) {   // the plume of every engine that is burning
    if (f.kind !== "thrust" || f.now <= 0) continue;
    drawPlume(part, f, T);
  }

  if (S * 6.3 < 16) {                                        // too small to see: an arrow pointing the way the nose points (same as the map)
    const m = T(p), tilt = sim.hull.body.getAngle() + phi, dx = -Math.sin(tilt), dy = -Math.cos(tilt);
    c.fillStyle = "#e74c3c"; c.strokeStyle = "#fff"; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(m[0] + dx * 11, m[1] + dy * 11);
    c.lineTo(m[0] - dx * 7 - dy * 6, m[1] - dy * 7 + dx * 6);
    c.lineTo(m[0] - dx * 7 + dy * 6, m[1] - dy * 7 - dx * 6);
    c.closePath(); c.fill(); c.stroke();
    return;
  }
  for (const part of sim.parts) {                            // the parts (each shape is placed on its body: ox, oy is where the part sits there)
    c.fillStyle = part.stress > 0.02 ? stressColor(part.color, part.stress) : part.color; c.beginPath();
    part.verts.forEach(function (q, i) {
      const s = T(part.body.getWorldPoint(P(part.ox + q.x, part.oy + q.y)));
      if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]);
    });
    c.closePath(); c.fill();
  }
}

function drawMap(o) {                                        // the map: centred on the rocket, not rotating, planet and orbit drawn round it
  const p = sim.hull.body.getPosition(), cx = W / 2, cy = Hh / 2, M = (x, y) => [cx + (x - p.x) * mapS, cy - (y - p.y) * mapS];
  c.fillStyle = "#05070a"; c.fillRect(0, 0, W, Hh);
  drawMapStars();
  const mid = M(0, 0), rad = R * mapS;                       // the planet's centre on screen (it moves: the view follows the rocket) and its radius
  const th = Math.max(SPACE_ALT * mapS, 5);                  // the air: gone by 70 km, drawn at least 5 px thick so it can be seen
  const ag = c.createRadialGradient(mid[0], mid[1], rad, mid[0], mid[1], rad + th);
  ag.addColorStop(0, "rgba(130,190,255,0.6)"); ag.addColorStop(0.3, "rgba(100,165,255,0.25)"); ag.addColorStop(1, "rgba(80,140,255,0)");
  c.fillStyle = ag; c.beginPath(); c.arc(mid[0], mid[1], rad + th, 0, 6.2832); c.fill();
  c.fillStyle = "#2f4a25"; c.strokeStyle = "#6f9a52"; c.lineWidth = 2;      // the planet
  c.beginPath(); c.arc(mid[0], mid[1], rad, 0, 6.2832); c.fill(); c.stroke();

  const pad = M(0, R);                                       // the launch pad
  c.fillStyle = "#e8eef2"; c.fillRect(pad[0] - 2, pad[1] - 2, 4, 4);

  /* the path itself, the whole ellipse (a thrown ball makes the same curve; the planet just gets in the way). Sampled evenly round the ellipse so it is smooth,
     solid where it is above the ground and dashed where it would be inside the planet. */
  const q = { x: -o.ey * o.dir, y: o.ex * o.dir }, pts = [];
  if (o.bound) {
    const a = o.pLat / (1 - o.e * o.e), bb = a * Math.sqrt(1 - o.e * o.e), N = 480;
    for (let i = 0; i <= N; i++) { const E = -Math.PI + 2 * Math.PI * i / N, xa = a * (Math.cos(E) - o.e), ya = bb * Math.sin(E); pts.push([xa * o.ex + ya * q.x, xa * o.ey + ya * q.y]); }
  } else {
    const nuMax = Math.acos(-1 / o.e) * 0.98;
    for (let i = 0; i <= 240; i++) { const nu = -nuMax + 2 * nuMax * i / 240, rr = o.pLat / (1 + o.e * Math.cos(nu)); pts.push([rr * (Math.cos(nu) * o.ex + Math.sin(nu) * q.x), rr * (Math.cos(nu) * o.ey + Math.sin(nu) * q.y)]); }
  }
  const scr = pts.map(function (w) { return M(w[0], w[1]); }), rr2 = pts.map(function (w) { return Math.hypot(w[0], w[1]); });
  c.strokeStyle = o.rp - R > 0 ? "#4aa3ff" : "#ff9f43"; c.lineWidth = 1.5; c.lineJoin = "round";   // blue = clears the ground, orange = hits it
  for (const inside of [false, true]) {
    c.beginPath();
    let pen = false;
    for (let i = 0; i < scr.length; i++) {
      if ((rr2[i] < R) !== inside) { pen = false; continue; }
      if (!pen) { c.moveTo(scr[i][0], scr[i][1]); pen = true; } else c.lineTo(scr[i][0], scr[i][1]);
    }
    c.setLineDash(inside ? [5, 5] : []); c.globalAlpha = inside ? 0.55 : 1; c.stroke();
  }
  c.setLineDash([]); c.globalAlpha = 1;

  c.font = "11px monospace"; c.textBaseline = "middle"; c.textAlign = "left";
  const pe = M(o.rp * o.ex, o.rp * o.ey);
  c.fillStyle = "#e8eef2"; c.beginPath(); c.arc(pe[0], pe[1], 3, 0, 6.2832); c.fill();
  c.fillText("Pe " + fmtAlt(o.rp - R - sim.refOffset), pe[0] + 7, pe[1]);
  if (o.bound) {
    const ap = M(-o.ra * o.ex, -o.ra * o.ey);
    c.beginPath(); c.arc(ap[0], ap[1], 3, 0, 6.2832); c.fill();
    c.fillText("Ap " + fmtAlt(o.ra - R - sim.refOffset), ap[0] + 7, ap[1]);
  }

  const a = sim.hull.body.getAngle();                        // the rocket: an arrow pointing the way its nose points
  const m = M(p.x, p.y), dx = -Math.sin(a), dy = -Math.cos(a);
  c.fillStyle = "#e74c3c"; c.strokeStyle = "#fff"; c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(m[0] + dx * 11, m[1] + dy * 11);
  c.lineTo(m[0] - dx * 7 - dy * 6, m[1] - dy * 7 + dx * 6);
  c.lineTo(m[0] - dx * 7 + dy * 6, m[1] - dy * 7 - dx * 6);
  c.closePath(); c.fill(); c.stroke();
  c.textAlign = "left";
}

/* ---- the text is rebuilt 10 times a second, not every frame: easier to read and much less work for the browser ---- */
const barButtons = [];               // clickable chips in the bottom bar, remade each frame: { x, y, w, h, fn }
let textAt = 0, hudText = null, panelLines = [], barText = { fuelFrac: 1, fuelLabel: "", thrLabel: "", cols: [] };
let showPerf = false;                // the pause menu switches this
const perf = { frame: 16.7, sim: 0, draw: 0, steps: 0 };   // filled in by main.js

function rebuildText() {
  const fb = sim.hull.body, p = fb.getPosition(), v = fb.getLinearVelocity();
  const r = Math.hypot(p.x, p.y), phi = Math.atan2(p.x, p.y);
  const ux = Math.sin(phi), uy = Math.cos(phi), ex = Math.cos(phi), ey = -Math.sin(phi);
  const alt = r - R, o = orbitInfo(p, v);
  const speed = Math.hypot(v.x, v.y), vert = v.x * ux + v.y * uy, side = v.x * ex + v.y * ey;
  let tilt = (fb.getAngle() + phi) * 180 / Math.PI; tilt = ((tilt + 180) % 360 + 360) % 360 - 180;
  const mass = totalMass();
  const dv = vacIsp() * G0 * Math.log(mass / Math.max(1, mass - sim.fuel));
  const twr = maxThrust() / (mass * MU / (r * r));
  const peAlt = o.rp - R - sim.refOffset, cal = stabilityCal();
  hudText = { alt: fmtBig(groundHeight()), ground: groundCountdown(), speed: (speed < 10 ? speed.toFixed(1) : speed.toFixed(0)) + " m/s",
              vert: (vert >= 0 ? "\u25B2 " : "\u25BC ") + (Math.abs(vert) < 10 ? Math.abs(vert).toFixed(1) : Math.abs(vert).toFixed(0)) + " m/s" };
  panelLines = [
    "Apoapsis   " + fmtAlt(o.ra - R - sim.refOffset),
    "Periapsis  " + fmtAlt(peAlt) + (o.bound && peAlt > 0 ? "  IN ORBIT" : ""),
    "Period     " + fmtTime(o.period)
  ];
  const stab = cal === null ? "none" : cal.toFixed(1) + " cal" + (cal < 0 ? "  UNSTABLE" : cal < 0.5 ? "  marginal" : "");
  barText = {
    fuelFrac: sim.fuelFull > 0 ? sim.fuel / sim.fuelFull : 0, fuelLabel: "FUEL " + sim.fuel.toFixed(0) + " kg", thrLabel: "THROTTLE " + Math.round(controls.throttle * 100) + "%", thr: controls.throttle,
    cols: [[190, ["Mass       " + mass.toFixed(0) + " kg", "Delta-v vac " + dv.toFixed(0) + " m/s", "T/W        " + twr.toFixed(2), "Stability  " + stab]],
           [395, ["Tilt       " + tilt.toFixed(1) + " deg", "AoA        " + sim.aoa.toFixed(1) + " deg", "Damping    " + (controls.damping ? "ON" : "off"), "Time       " + (sim.started ? "T+" + sim.t.toFixed(1) + " s" : "on the pad")]],
           [555, ["Air        " + sim.rho.toFixed(3) + " kg/m3", "Dyn press  " + (sim.q / 1000).toFixed(2) + " kPa", "Max Q      " + (sim.maxQ / 1000).toFixed(2) + " kPa", "Thrust     " + (sim.thrust / 1000).toFixed(0) + " kN"]]],
    warpNote: warpActual < warp * 0.9 ? "running " + warpActual.toFixed(1) + "x" : ""
  };
}

function fmtBig(m) {                 // a distance for the big readout: tenths of a meter under 100 m (for landing), km above 10 km
  if (!isFinite(m)) return "-";
  const a = Math.abs(m);
  return a < 100 ? m.toFixed(1) + " m" : a < 10000 ? m.toFixed(0) + " m" : (m / 1000).toFixed(1) + " km";
}

function drawHud() {                 // top middle: the three numbers to read at a glance
  const h = hudText;
  if (!h) return;
  const cells = [["ALTITUDE", h.alt], ["SPEED", h.speed], ["VERTICAL", h.vert]], cw = 140, x0 = W / 2 - cw * cells.length / 2;
  c.fillStyle = "rgba(10,14,18,0.55)"; c.fillRect(x0, 8, cw * cells.length, 52);
  c.textAlign = "center"; c.textBaseline = "top";
  cells.forEach(function (cell, i) {
    const x = x0 + cw * (i + 0.5);
    c.font = "10px monospace"; c.fillStyle = "#8a98a3"; c.fillText(cell[0], x, 13);
    c.font = "bold 22px monospace"; c.fillStyle = "#e8eef2"; c.fillText(cell[1], x, 27);
  });
  if (h.ground !== null && h.ground < 60) {                    // "ground in N s": if nothing changes (the engines as they are now)
    const t = h.ground, text = "GROUND IN " + (t < 10 ? t.toFixed(1) : t.toFixed(0)) + " s", w = 150;
    c.fillStyle = "rgba(10,14,18,0.55)"; c.fillRect(W / 2 - w / 2, 64, w, 22);
    c.font = "bold 14px monospace"; c.textAlign = "center"; c.fillStyle = t < 4 ? "#ff6b5e" : t < 10 ? "#f0b33c" : "#e8eef2"; c.fillText(text, W / 2, 68);
  }
  c.textAlign = "left";
}

function drawPanel(lines) {          // top left: the numbers you watch while flying
  c.font = "12px monospace"; c.textAlign = "left"; c.textBaseline = "top";
  let w = 0;
  for (const l of lines) w = Math.max(w, c.measureText(l).width);
  c.fillStyle = "rgba(10,14,18,0.55)"; c.fillRect(8, 8, w + 16, lines.length * 15 + 10);
  c.fillStyle = "#e8eef2";
  for (let i = 0; i < lines.length; i++) c.fillText(lines[i], 16, 13 + i * 15);
}

/* ---- the bottom bar ---- */
function hbar(x, y, w, h, frac, color, text) {                // a horizontal gauge with its label on top
  c.fillStyle = "#e8eef2"; c.font = "11px monospace"; c.textAlign = "left"; c.textBaseline = "bottom";
  c.fillText(text, x, y - 2);
  c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w, h);
  c.fillStyle = color; c.fillRect(x + 1, y + 1, Math.round((w - 1) * clamp(frac, 0, 1)), h - 1);
}

function chip(x, y, w, h, label, on, fn) {                    // a small clickable button in the bar
  c.fillStyle = on ? "rgba(74,163,255,0.30)" : "#1b242c"; c.fillRect(x, y, w, h);
  c.strokeStyle = on ? "#4aa3ff" : "rgba(255,255,255,0.25)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.fillStyle = "#e8eef2"; c.font = "11px monospace"; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(label, x + w / 2, y + h / 2 + 0.5);
  barButtons.push({ x: x, y: y, w: w, h: h, fn: fn });
}

function drawBar() {
  const y0 = Hh, t = barText;
  barButtons.length = 0;
  c.fillStyle = "#0a0e12"; c.fillRect(0, y0, W, BAR_H);
  c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(0, y0, W, 1);

  hbar(12, y0 + 24, 150, 10, t.fuelFrac, t.fuelFrac > 0.2 ? "#e0b030" : "#e74c3c", t.fuelLabel);
  hbar(12, y0 + 56, 150, 10, t.thr, "#4aa3ff", t.thrLabel);

  c.font = "11px monospace"; c.textAlign = "left"; c.textBaseline = "top"; c.fillStyle = "#e8eef2";
  for (const col of t.cols) for (let i = 0; i < col[1].length; i++) c.fillText(col[1][i], col[0], y0 + 8 + i * 14);

  chip(720, y0 + 8, 64, 18, "Map", mapMode, toggleMap);                           // view and time warp, as buttons
  chip(720, y0 + 32, 20, 18, "-", false, function () { setWarp(warpI - 1); });
  c.fillStyle = "#e8eef2"; c.font = "11px monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(warp + "x", 762, y0 + 41.5);
  chip(784, y0 + 32, 20, 18, "+", false, function () { setWarp(warpI + 1); });
  if (t.warpNote) { c.textAlign = "left"; c.fillStyle = "#f0b33c"; c.fillText(t.warpNote, 720, y0 + 62); }

  if (W > 1150) {                                             // the message log, newest at the bottom
    const n = Math.min(4, logLines.length);
    c.fillStyle = "#8a98a3"; c.textAlign = "left"; c.textBaseline = "top";
    for (let i = 0; i < n; i++) c.fillText(logLines[logLines.length - n + i], 880, y0 + 8 + i * 12);
  }

  c.font = "10px monospace"; c.textAlign = "left"; c.textBaseline = "bottom"; c.fillStyle = "rgba(255,255,255,0.55)";
  c.fillText("Esc: menu", 190, y0 + BAR_H - 5);
}

function drawStaging() {             // top right: the staging list. Fired rows are gone; the next one is lit. Space fires it.
  if (!sim.stages || sim.stages.length === 0) return;
  const lines = [{ t: "STAGING   (Space)", c: "#8a98a3" }];
  if (sim.stages.length - sim.stageNext <= 0) lines.push({ t: "all stages fired", c: "#8a98a3" });
  for (let i = sim.stageNext; i < sim.stages.length && lines.length < 14; i++) {
    lines.push({ t: "Stage " + (i + 1) + (i === sim.stageNext ? "   < next" : ""), c: i === sim.stageNext ? "#f0b33c" : "#8a98a3" });
    for (const id of sim.stages[i]) {
      const L = sim.labels[id] || { label: id, verb: "" };
      lines.push({ t: "  " + L.verb + " " + L.label, c: i === sim.stageNext ? "#e8eef2" : "#aab6bf" });
    }
  }
  const w = 210, h = lines.length * 15 + 10, x = W - w - 12, y = showPerf ? 100 : 8;
  c.font = "12px monospace"; c.textAlign = "left"; c.textBaseline = "top";
  c.fillStyle = "rgba(10,14,18,0.55)"; c.fillRect(x, y, w, h);
  for (let i = 0; i < lines.length; i++) { c.fillStyle = lines[i].c; c.fillText(lines[i].t, x + 8, y + 5 + i * 15); }
}

function drawPerf() {                                         // switched on from the pause menu
  const lines = ["FPS        " + (1000 / perf.frame).toFixed(0), "Frame      " + perf.frame.toFixed(1) + " ms", "Physics    " + perf.sim.toFixed(2) + " ms, " + perf.steps + " steps",
                 "Drawing    " + perf.draw.toFixed(2) + " ms (CPU)", "Samples    " + tele.n + " / " + TELE_MAX];
  c.font = "11px monospace"; c.textAlign = "left"; c.textBaseline = "top";
  let w = 0; for (const l of lines) w = Math.max(w, c.measureText(l).width);
  const x = W - w - 24;
  c.fillStyle = "rgba(10,14,18,0.6)"; c.fillRect(x - 8, 8, w + 16, lines.length * 14 + 10);
  c.fillStyle = "#e8eef2";
  for (let i = 0; i < lines.length; i++) c.fillText(lines[i], x, 13 + i * 14);
}

function draw() {
  const fb = sim.hull.body, p = fb.getPosition(), v = fb.getLinearVelocity();
  const r = Math.hypot(p.x, p.y), phi = Math.atan2(p.x, p.y);

  c.save();                                                   // the world, kept out of the bar
  c.beginPath(); c.rect(0, 0, W, Hh); c.clip();
  if (mapMode) drawMap(orbitInfo(p, v)); else drawFlight(r - R, phi);
  c.restore();

  const now = performance.now();
  if (now - textAt > 100) { textAt = now; rebuildText(); }
  drawPanel(panelLines);
  drawHud();
  drawBar();
  drawStaging();
  if (showPerf) drawPerf();
}
