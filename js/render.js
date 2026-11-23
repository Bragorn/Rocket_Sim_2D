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

/* ---- the air coming off the rocket ----
   Every piece of rocket that is moving through air fast enough sheds air from its leading point (the nose, the front edge of a tank) and from its widest points
   (shoulders, fin and leg tips). Mostly it is mist: soft puffs that start small and thick where they come off, then spread and fade as the rocket leaves them behind
   (the air is still, so each puff stays where it was shed and the rocket drags a wake out behind it). A few are wind streaks. Fast in thin air it is heated:
   white mist turns orange, then white-hot, with a glow on the nose. The heat number is only for the look for now:
   heat = sqrt(air density / ground density) x (speed in km/s)^3, so it follows how hard the air is hit. When parts really heat up, it is the number to use. */
const FX_MAX = 1500;                 // bits of air alive at once
const FX_VAPOUR = 50, FX_PLASMA = 100;   // bits shed per second from the leading point: in thick air, and when hot (the shoulders shed 60% of that)
const FX_STREAKS = 0.25;             // the share of those that are wind streaks (the rest is mist)
const FX_HEAT_START = 0.12, FX_HEAT_FULL = 0.6;   // the glow starts at this heat number, and is full this much higher
const FX_COLORS = ["255,255,255", "255,190,110", "255,145,60", "255,236,190"], FX_ALPHA = [0.35, 0.55, 0.7, 0.8], FX_WIDTH = [1, 1.5, 2.2, 3], FX_MIST = [0.2, 0.28, 0.32, 0.36];
const fx = { head: 0, pieces: [], x: new Float64Array(FX_MAX), y: new Float64Array(FX_MAX), vx: new Float64Array(FX_MAX), vy: new Float64Array(FX_MAX),
             dx: new Float64Array(FX_MAX), dy: new Float64Array(FX_MAX), len: new Float64Array(FX_MAX), spd: new Float64Array(FX_MAX), size: new Float64Array(FX_MAX),
             age: new Float64Array(FX_MAX), life: new Float64Array(FX_MAX), hb: new Uint8Array(FX_MAX), kind: new Uint8Array(FX_MAX) };   // kind 0 = mist, 1 = streak

function emitAirBit(wx, wy, dx, dy, speed, glow, lead, side, size) {
  const i = fx.head; fx.head = (fx.head + 1) % FX_MAX;
  const streak = Math.random() < FX_STREAKS, lat = side * (0.03 + 0.08 * Math.random()) * speed;     // thrown a little sideways, so the wake widens
  fx.x[i] = wx + (Math.random() - 0.5) * 0.2; fx.y[i] = wy + (Math.random() - 0.5) * 0.2;
  fx.vx[i] = -dy * lat; fx.vy[i] = dx * lat;
  fx.dx[i] = dx; fx.dy[i] = dy; fx.spd[i] = speed; fx.len[i] = speed * 0.03 * (0.6 + 0.8 * Math.random()); fx.size[i] = size;
  fx.age[i] = 0; fx.kind[i] = streak ? 1 : 0;
  fx.life[i] = streak ? (0.5 + 0.5 * Math.random()) : (1.0 + 0.8 * Math.random()) * (0.7 + 0.3 * lead);
  fx.hb[i] = glow < 0.08 ? 0 : glow < 0.4 ? 1 : glow < 0.9 ? 2 : 3;
}

function emitAirFx(dts) {
  fx.pieces = [];
  const bodies = [];
  for (const part of sim.parts) if (bodies.indexOf(part.body) < 0) bodies.push(part.body);
  for (const body of bodies) {                                  // each piece of rocket on its own body (a dropped stage has its own wake)
    const v = body.getLinearVelocity(), speed = Math.hypot(v.x, v.y);
    if (speed < 30) continue;
    const cw = body.getWorldCenter(), rho = airDensity(Math.hypot(cw.x, cw.y) - R), rr = Math.sqrt(rho / RHO0);
    const air = clamp(rr * 1.5, 0, 1) * clamp((speed - 30) / 120, 0, 1), heat = rr * Math.pow(speed / 1000, 3), glow = clamp((heat - FX_HEAT_START) / (FX_HEAT_FULL - FX_HEAT_START), 0, 1.5);
    if (air < 0.02 && glow <= 0) continue;
    const dx = v.x / speed, dy = v.y / speed, tips = [];
    let best = -Infinity;
    for (const part of sim.parts) {
      if (part.body !== body) continue;
      let tp = -Infinity, tw = null, lo = Infinity, lw = null, hi = -Infinity, hw = null;       // the most forward point, and the two widest (left and right of the way it is going)
      for (const q of part.verts) {
        const w = body.getWorldPoint(P(part.ox + q.x, part.oy + q.y)), pr = w.x * dx + w.y * dy, lt = -w.x * dy + w.y * dx;
        if (pr > tp) { tp = pr; tw = w; }
        if (lt < lo) { lo = lt; lw = w; }
        if (lt > hi) { hi = lt; hw = w; }
      }
      tips.push({ w: tw, pr: tp, left: lw, right: hw, width: part.def.width || 1 });
      if (tp > best) best = tp;
    }
    for (const t of tips) {
      const lead = t.pr > best - 0.3 ? 1 : 0.45, rate = (FX_VAPOUR * air + FX_PLASMA * Math.min(1, glow)) * lead * dts, size = Math.max(0.3, t.width * 0.35);
      const shed = function (w, share, side) {
        const n = rate * share;
        let count = Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
        while (count-- > 0) emitAirBit(w.x, w.y, dx, dy, speed, glow, lead, side, size);
      };
      shed(t.w, 1, (Math.random() < 0.5 ? -1 : 1) * 0.5);
      shed(t.left, 0.6, -1); shed(t.right, 0.6, 1);
      if (lead === 1 && glow > 0.03) fx.pieces.push({ x: t.w.x, y: t.w.y, dx: dx, dy: dy, glow: glow, w: t.width });
    }
  }
}

function updateAirFx(dt) {           // called every frame (from updateView). Frozen while paused, and off at high time warp (the wake would be in dots)
  if (paused || !sim) return;
  const w = typeof warp !== "undefined" ? warp : 1;
  if (w > 2) { fx.life.fill(0); fx.pieces = []; return; }
  const dts = dt * w, k = Math.exp(-3 * dts);
  for (let i = 0; i < FX_MAX; i++) {
    if (!(fx.age[i] < fx.life[i])) continue;
    fx.x[i] += fx.vx[i] * dts; fx.y[i] += fx.vy[i] * dts; fx.vx[i] *= k; fx.vy[i] *= k; fx.age[i] += dts;
  }
  emitAirFx(dts);
}

function fxScreen(cam, x, y, out) {  // where a world point is on the flight view
  out[0] = W / 2 + ((x - R * cam.ux) * cam.ex + (y - R * cam.uy) * cam.ey) * cam.Z;
  out[1] = cam.hy - ((x * cam.ux + y * cam.uy - R) - cam.alt) * cam.Z;
}

const fxSprites = [];
function fxSprite(hb) {              // a soft round puff, painted once for each heat colour
  if (fxSprites[hb]) return fxSprites[hb];
  const cv2 = document.createElement("canvas");
  cv2.width = 64; cv2.height = 64;
  const k = cv2.getContext("2d"), g = k.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(" + FX_COLORS[hb] + ",1)"); g.addColorStop(0.5, "rgba(" + FX_COLORS[hb] + ",0.4)"); g.addColorStop(1, "rgba(" + FX_COLORS[hb] + ",0)");
  k.fillStyle = g; k.fillRect(0, 0, 64, 64);
  fxSprites[hb] = cv2;
  return cv2;
}

function drawAirTrails(cam) {        // the wake: mist that thickens where it is shed and spreads as it fades, with a few wind streaks. Drawn behind the rocket
  const sp = [0, 0], sq = [0, 0];
  for (let pass = 0; pass < 2; pass++) {                        // white mist first, then the hot mist added on top
    c.globalCompositeOperation = pass === 0 ? "source-over" : "lighter";
    for (let i = 0; i < FX_MAX; i++) {
      if (!(fx.age[i] < fx.life[i]) || fx.kind[i] !== 0 || (pass === 0) !== (fx.hb[i] === 0)) continue;
      fxScreen(cam, fx.x[i], fx.y[i], sp);
      const t = fx.age[i] / fx.life[i], rPx = Math.max(2, fx.size[i] * (0.4 + 2.2 * t) * cam.Z);
      if (sp[0] < -rPx || sp[0] > W + rPx || sp[1] < -rPx || sp[1] > Hh + rPx) continue;
      c.globalAlpha = FX_MIST[fx.hb[i]] * Math.pow(1 - t, 1.5);
      c.drawImage(fxSprite(fx.hb[i]), sp[0] - rPx, sp[1] - rPx, 2 * rPx, 2 * rPx);
    }
  }
  c.globalAlpha = 1; c.lineCap = "round";
  for (let hb = 0; hb < 4; hb++) {                              // wind streaks, in groups of the same colour and age so each group is one stroke
    c.globalCompositeOperation = hb >= 1 ? "lighter" : "source-over";
    c.lineWidth = FX_WIDTH[hb];
    for (let ab = 0; ab < 4; ab++) {
      c.strokeStyle = "rgba(" + FX_COLORS[hb] + "," + (FX_ALPHA[hb] * Math.pow(1 - (ab + 0.5) / 4, 1.3)).toFixed(3) + ")";
      c.beginPath();
      let any = false;
      for (let i = 0; i < FX_MAX; i++) {
        if (!(fx.age[i] < fx.life[i]) || fx.kind[i] !== 1 || fx.hb[i] !== hb || Math.min(3, Math.floor(4 * fx.age[i] / fx.life[i])) !== ab) continue;
        fxScreen(cam, fx.x[i], fx.y[i], sp);
        if (sp[0] < -60 || sp[0] > W + 60 || sp[1] < -60 || sp[1] > Hh + 60) continue;
        const L = Math.min(fx.len[i], fx.spd[i] * fx.age[i], 40 / cam.Z);          // never longer than the way it has been left behind, so it never reaches in front of where it was shed
        fxScreen(cam, fx.x[i] + fx.dx[i] * L, fx.y[i] + fx.dy[i] * L, sq);
        c.moveTo(sp[0], sp[1]); c.lineTo(sq[0], sq[1]); any = true;
      }
      if (any) c.stroke();
    }
  }
  c.globalCompositeOperation = "source-over"; c.lineCap = "butt";
}

/* The engine's plume (drawn in the rocket's own frame, so it stays on the nozzle): an orange outer flame, a yellow body, a white core, thin streaks flickering along it,
   and bright "Mach diamonds" along the middle that show more the thinner the air (the exhaust spreads out wider than the air round it). */
function drawPlume(part, f, T) {
  const a = part.body.getAngle() + f.angle, dx = -Math.sin(a), dy = Math.cos(a);           // the way the engine pushes; the plume goes the other way
  const n = part.body.getWorldPoint(P(part.ox + f.at[0], part.oy + f.at[1])), pf = clamp(sim.rho / RHO0, 0, 1);
  const L = (1.2 + 4 * f.now / f.vac) * f.scale * (0.85 + Math.random() * 0.3) * (1 + 0.5 * (1 - pf)), wd = 0.28 * f.scale * (1 + 0.8 * (1 - pf));
  const at = function (s, u) { return T({ x: n.x - dx * s + dy * u, y: n.y - dy * s - dx * u }); };     // s along the plume, u across it
  const tri = function (len, wide, style) {
    const p1 = at(0, wide), p2 = at(0, -wide), tip = at(len, 0);
    c.fillStyle = style; c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(tip[0], tip[1]); c.lineTo(p2[0], p2[1]); c.closePath(); c.fill();
  };
  tri(L, wd * 1.35, "rgba(255,120,40,0.55)");
  tri(L * 0.82, wd, "rgba(241,196,15,0.9)");
  tri(L * 0.5, wd * 0.42, "rgba(255,250,225,0.95)");
  c.globalCompositeOperation = "lighter";
  c.lineWidth = 1; c.strokeStyle = "rgba(255,215,140,0.55)"; c.beginPath();
  for (let k = 0; k < 9; k++) {                                                            // streaks that flicker (new ones every frame)
    const u = (Math.random() * 2 - 1) * wd * 0.8, s0 = Math.random() * L * 0.15, s1 = L * (0.45 + 0.6 * Math.random()) * (1 - 0.3 * Math.abs(u) / wd);
    const p1 = at(s0, u), p2 = at(s1, u * 0.85);
    c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]);
  }
  c.stroke();
  const thin = 0.15 + 0.85 * (1 - pf);                                                     // diamonds show in thin air
  for (let k = 1; k <= 4; k++) {
    const s = L * 0.2 * k, w = wd * 0.6 * (1 - 0.17 * k), h = L * 0.05, al = thin * (0.75 - 0.15 * k);
    if (al <= 0.02) continue;
    const p1 = at(s - h, 0), p2 = at(s, w), p3 = at(s + h, 0), p4 = at(s, -w);
    c.fillStyle = "rgba(255,250,225," + al.toFixed(2) + ")"; c.beginPath();
    c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.lineTo(p3[0], p3[1]); c.lineTo(p4[0], p4[1]); c.closePath(); c.fill();
  }
  c.globalCompositeOperation = "source-over";
}

function drawPlasmaGlow(cam) {       // the hot glow on the leading point of anything moving fast enough, drawn over the rocket
  if (fx.pieces.length === 0) return;
  const sp = [0, 0], sq = [0, 0];
  c.globalCompositeOperation = "lighter";
  for (const g of fx.pieces) {
    fxScreen(cam, g.x, g.y, sp); fxScreen(cam, g.x + g.dx, g.y + g.dy, sq);
    let ax = sq[0] - sp[0], ay = sq[1] - sp[1];
    const al = Math.hypot(ax, ay) || 1; ax /= al; ay /= al;
    const rad = Math.max(7, g.w * cam.Z * 0.9) * (0.8 + 0.5 * Math.min(g.glow, 1.5)), a = Math.min(1, g.glow) * 0.8;
    c.save(); c.translate(sp[0] + ax * rad * 0.3, sp[1] + ay * rad * 0.3); c.rotate(Math.atan2(ay, ax)); c.scale(1.5, 1);
    const gr = c.createRadialGradient(0, 0, 0, 0, 0, rad);
    gr.addColorStop(0, "rgba(255,238,190," + a.toFixed(2) + ")"); gr.addColorStop(0.45, "rgba(255,160,70," + (a * 0.55).toFixed(2) + ")"); gr.addColorStop(1, "rgba(255,80,30,0)");
    c.fillStyle = gr; c.beginPath(); c.arc(0, 0, rad, 0, 6.2832); c.fill(); c.restore();
  }
  c.globalCompositeOperation = "source-over";
}

let planetTex = null;
function planetTexture() {           // the planet's surface, painted once and reused: ocean, a few continents (one on the launch pad's coast, at the top), thin cloud
  if (planetTex) return planetTex;
  const N = 512, h = N / 2, cv2 = document.createElement("canvas");
  cv2.width = N; cv2.height = N;
  const k = cv2.getContext("2d");
  k.fillStyle = "#1d4f80"; k.fillRect(0, 0, N, N);
  const og = k.createRadialGradient(h, h, 0, h, h, h); og.addColorStop(0, "rgba(50,125,185,0.5)"); og.addColorStop(1, "rgba(10,40,80,0.45)");
  k.fillStyle = og; k.fillRect(0, 0, N, N);
  const lands = ["#3e7a3a", "#4a8a40", "#6a9a4a", "#9a9058"];
  const blob = function (cx, cy, size, seed) {               // a lumpy island made of overlapping circles
    for (let i = 0; i < 14; i++) {
      const a = hash3(seed, i, 11) * 6.2832, d = hash3(seed, i, 12) * size * 0.8, r = size * (0.25 + 0.4 * hash3(seed, i, 13));
      k.fillStyle = lands[Math.floor(hash3(seed, i, 14) * lands.length)];
      k.beginPath(); k.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, r, 0, 6.2832); k.fill();
    }
  };
  blob(h, N * 0.07, N * 0.16, 1);
  for (let s = 2; s < 11; s++) { const a = hash3(s, 0, 15) * 6.2832, d = (0.2 + 0.65 * hash3(s, 1, 15)) * h; blob(h + Math.cos(a) * d, h + Math.sin(a) * d, N * (0.07 + 0.1 * hash3(s, 2, 15)), s); }
  k.fillStyle = "rgba(255,255,255,0.13)";
  for (let s = 0; s < 40; s++) { k.beginPath(); k.ellipse(hash3(s, 0, 16) * N, hash3(s, 1, 16) * N, N * (0.03 + 0.06 * hash3(s, 2, 16)), N * 0.012, hash3(s, 3, 16) * 3.14, 0, 6.2832); k.fill(); }
  planetTex = cv2;
  return cv2;
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
  drawAirTrails(cam);                                        // the air shed by the rocket, behind it

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
    c.fillStyle = part.color; c.beginPath();
    part.verts.forEach(function (q, i) {
      const s = T(part.body.getWorldPoint(P(part.ox + q.x, part.oy + q.y)));
      if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]);
    });
    c.closePath(); c.fill();
  }
  drawPlasmaGlow(cam);                                       // and the glow on the nose
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
  c.save();                                                  // the planet: its painted surface, lit from the left, dark on the far side
  c.beginPath(); c.arc(mid[0], mid[1], rad, 0, 6.2832); c.clip();
  c.drawImage(planetTexture(), mid[0] - rad, mid[1] - rad, 2 * rad, 2 * rad);
  const sg = c.createLinearGradient(mid[0] - rad, mid[1], mid[0] + rad, mid[1]);
  sg.addColorStop(0, "rgba(255,255,255,0.12)"); sg.addColorStop(0.45, "rgba(0,0,0,0)"); sg.addColorStop(1, "rgba(0,0,10,0.55)");
  c.fillStyle = sg; c.fillRect(mid[0] - rad, mid[1] - rad, 2 * rad, 2 * rad);
  c.restore();
  c.strokeStyle = "rgba(170,215,255,0.45)"; c.lineWidth = 1; c.beginPath(); c.arc(mid[0], mid[1], rad, 0, 6.2832); c.stroke();

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
