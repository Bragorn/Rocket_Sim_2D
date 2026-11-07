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
}

function toggleMap() {
  mapMode = !mapMode;
  if (mapMode) {                     // fit the whole orbit (or at least the planet) on screen
    const p = sim.hull.body.getPosition(), o = orbitInfo(p, sim.hull.body.getLinearVelocity());
    const far = Math.max(R * 1.15, Math.min(o.ra, 8 * R), o.r);
    mapS = mapSt = 0.40 * Math.min(W, Hh) / far;
  }
}

function niceStep(x) {
  const mag = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), r = x / mag;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
}

function fmtAlt(m) {
  if (!isFinite(m)) return "escape";
  return Math.abs(m) < 10000 ? m.toFixed(0) + " m" : (m / 1000).toFixed(1) + " km";
}
function fmtTime(s) {
  if (s === null) return "-";
  return s < 120 ? s.toFixed(0) + " s" : Math.floor(s / 60) + " min " + Math.round(s % 60) + " s";
}

function drawFlight(alt, phi) {
  const p = sim.hull.body.getPosition();
  const ux = Math.sin(phi), uy = Math.cos(phi), ex = Math.cos(phi), ey = -Math.sin(phi), HOR = 0.62;
  const T = (wp) => [W / 2 + ((wp.x - R * ux) * ex + (wp.y - R * uy) * ey) * S,
                     Hh * HOR - ((wp.x * ux + wp.y * uy - R) - alt) * S];

  const sky = clamp(alt / 70000, 0, 1);
  c.fillStyle = "rgb(" + Math.round(135 - 125 * sky) + "," + Math.round(190 - 175 * sky) + "," + Math.round(235 - 195 * sky) + ")";
  c.fillRect(0, 0, W, Hh);

  const stepY = Math.max(5, niceStep(120 / S));              // altitude lines
  const yTop = alt + Hh * HOR / S, yBottom = alt - Hh * (1 - HOR) / S;
  c.strokeStyle = "rgba(255,255,255,0.25)"; c.fillStyle = "rgba(255,255,255,0.8)";
  c.font = "10px monospace"; c.textAlign = "left"; c.textBaseline = "bottom"; c.lineWidth = 1;
  c.beginPath();
  for (let k = Math.max(1, Math.ceil(yBottom / stepY)), n = 0; k * stepY <= yTop && n < 60; k++, n++) {
    const Y = Math.round(Hh * HOR - (k * stepY - alt) * S) + 0.5;
    c.moveTo(0, Y); c.lineTo(W, Y);
    c.fillText(fmtAlt(k * stepY), 8, Y - 2);
  }
  c.stroke();

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

  for (const part of sim.parts) for (const f of part.forces) {   // a flame for every engine that is burning
    if (f.kind !== "thrust" || f.now <= 0) continue;
    const a = part.body.getAngle() + f.angle, dx = -Math.sin(a), dy = Math.cos(a);
    const n = part.body.getWorldPoint(P(f.at[0], f.at[1])), L = (1.2 + 4 * f.now / f.max) * (0.85 + Math.random() * 0.3);
    const a1 = T({ x: n.x + dy * 0.28, y: n.y - dx * 0.28 }), a2 = T({ x: n.x - dy * 0.28, y: n.y + dx * 0.28 });
    const tip = T({ x: n.x - dx * L, y: n.y - dy * L });
    c.fillStyle = "#f1c40f"; c.beginPath(); c.moveTo(a1[0], a1[1]); c.lineTo(tip[0], tip[1]); c.lineTo(a2[0], a2[1]); c.closePath(); c.fill();
  }

  if (S * 6.3 < 16) {                                        // too small to see: show a marker instead
    const m = T(p);
    c.fillStyle = "#e74c3c"; c.strokeStyle = "#fff"; c.lineWidth = 1.5;
    c.beginPath(); c.arc(m[0], m[1], 5, 0, 6.2832); c.fill(); c.stroke();
    return;
  }
  for (const part of sim.parts) {                            // the parts
    c.fillStyle = part.color; c.beginPath();
    part.verts.forEach(function (q, i) {
      const s = T(part.body.getWorldPoint(q));
      if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]);
    });
    c.closePath(); c.fill();
  }
}

function drawMap(o) {                                        // the whole planet, not rotating, orbit drawn on it
  const cx = W / 2, cy = Hh / 2, M = (x, y) => [cx + x * mapS, cy - y * mapS];
  c.fillStyle = "#05070a"; c.fillRect(0, 0, W, Hh);
  c.fillStyle = "#2f4a25"; c.strokeStyle = "#6f9a52"; c.lineWidth = 2;
  c.beginPath(); c.arc(cx, cy, R * mapS, 0, 6.2832); c.fill(); c.stroke();

  const pad = M(0, R);                                       // the launch pad
  c.fillStyle = "#e8eef2"; c.fillRect(pad[0] - 2, pad[1] - 2, 4, 4);

  const q = { x: -o.ey * o.dir, y: o.ex * o.dir };           // the path itself
  const nuMax = o.bound ? Math.PI : Math.acos(-1 / o.e) * 0.98;
  c.strokeStyle = o.rp - R > 0 ? "#4aa3ff" : "#ff9f43"; c.lineWidth = 1.5;   // blue = clears the ground, orange = hits it
  c.beginPath();
  for (let i = 0; i <= 240; i++) {
    const nu = -nuMax + 2 * nuMax * i / 240, rr = o.pLat / (1 + o.e * Math.cos(nu));
    const s = M(rr * (Math.cos(nu) * o.ex + Math.sin(nu) * q.x), rr * (Math.cos(nu) * o.ey + Math.sin(nu) * q.y));
    if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]);
  }
  c.stroke();

  c.font = "11px monospace"; c.textBaseline = "middle"; c.textAlign = "left";
  const pe = M(o.rp * o.ex, o.rp * o.ey);
  c.fillStyle = "#e8eef2"; c.beginPath(); c.arc(pe[0], pe[1], 3, 0, 6.2832); c.fill();
  c.fillText("Pe " + fmtAlt(o.rp - R - REF_OFFSET), pe[0] + 7, pe[1]);
  if (o.bound) {
    const ap = M(-o.ra * o.ex, -o.ra * o.ey);
    c.beginPath(); c.arc(ap[0], ap[1], 3, 0, 6.2832); c.fill();
    c.fillText("Ap " + fmtAlt(o.ra - R - REF_OFFSET), ap[0] + 7, ap[1]);
  }

  const p = sim.hull.body.getPosition(), a = sim.hull.body.getAngle();   // the rocket: an arrow pointing the way its nose points
  const m = M(p.x, p.y), dx = -Math.sin(a), dy = -Math.cos(a);
  c.fillStyle = "#e74c3c"; c.strokeStyle = "#fff"; c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(m[0] + dx * 11, m[1] + dy * 11);
  c.lineTo(m[0] - dx * 7 - dy * 6, m[1] - dy * 7 + dx * 6);
  c.lineTo(m[0] - dx * 7 + dy * 6, m[1] - dy * 7 - dx * 6);
  c.closePath(); c.fill(); c.stroke();
  c.textAlign = "left";
}

/* ---- the readout panel (top left, the numbers you watch while flying) ---- */
function drawPanel(lines) {
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

function drawBar(info) {
  const y0 = Hh;
  c.fillStyle = "#0a0e12"; c.fillRect(0, y0, W, BAR_H);
  c.fillStyle = "rgba(255,255,255,0.18)"; c.fillRect(0, y0, W, 1);

  const ff = sim.fuel / sim.fuelFull;
  hbar(12, y0 + 24, 150, 10, ff, ff > 0.2 ? "#e0b030" : "#e74c3c", "FUEL " + sim.fuel.toFixed(0) + " kg");
  hbar(12, y0 + 56, 150, 10, controls.throttle, "#4aa3ff", "THROTTLE " + Math.round(controls.throttle * 100) + "%");

  const cal = info.cal;
  const stab = cal === null ? "none" : cal.toFixed(1) + " cal" + (cal < 0 ? "  UNSTABLE" : cal < 0.5 ? "  marginal" : "");
  c.font = "11px monospace"; c.textAlign = "left"; c.textBaseline = "top"; c.fillStyle = "#e8eef2";
  const cols = [[190, ["Mass       " + info.mass.toFixed(0) + " kg", "Delta-v    " + info.dv.toFixed(0) + " m/s", "T/W        " + info.twr.toFixed(2), "Stability  " + stab]],
                [395, ["Tilt       " + info.tilt.toFixed(1) + " deg", "AoA        " + sim.aoa.toFixed(1) + " deg", "Damping    " + (controls.damping ? "ON" : "off"), "Time       " + sim.t.toFixed(1) + " s"]],
                [555, ["Air        " + sim.rho.toFixed(3) + " kg/m3", "Dyn press  " + (sim.q / 1000).toFixed(2) + " kPa", "Max Q      " + (sim.maxQ / 1000).toFixed(2) + " kPa", ""]],
                [720, ["View  " + (mapMode ? "MAP" : "flight"), "Warp  " + warp + "x" + (warpActual < warp * 0.9 ? " (running " + warpActual.toFixed(1) + "x)" : ""), "", ""]]];
  for (const col of cols) for (let i = 0; i < col[1].length; i++) c.fillText(col[1][i], col[0], y0 + 8 + i * 14);

  if (W > 1150) {                                             // the message log, newest at the bottom
    const n = Math.min(4, logLines.length);
    c.fillStyle = "#8a98a3";
    for (let i = 0; i < n; i++) c.fillText(logLines[logLines.length - n + i], 880, y0 + 8 + i * 12);
  }

  c.font = "10px monospace"; c.textBaseline = "bottom"; c.fillStyle = "rgba(255,255,255,0.55)";
  c.fillText("W/S throttle  Z full  X cut  A/D steer  T damping  R reset  M map  + - wheel zoom  < > time warp", 190, y0 + BAR_H - 5);
}

function draw() {
  const fb = sim.hull.body, p = fb.getPosition(), v = fb.getLinearVelocity();
  const r = Math.hypot(p.x, p.y), phi = Math.atan2(p.x, p.y);
  const ux = Math.sin(phi), uy = Math.cos(phi), ex = Math.cos(phi), ey = -Math.sin(phi);
  const alt = r - R, o = orbitInfo(p, v);

  c.save();                                                   // the world, kept out of the bar
  c.beginPath(); c.rect(0, 0, W, Hh); c.clip();
  if (mapMode) drawMap(o); else drawFlight(alt, phi);
  c.restore();

  const speed = Math.hypot(v.x, v.y), vert = v.x * ux + v.y * uy, side = v.x * ex + v.y * ey;
  let tilt = (fb.getAngle() + phi) * 180 / Math.PI; tilt = ((tilt + 180) % 360 + 360) % 360 - 180;
  const mass = totalMass();
  const dv = ISP * G0 * Math.log(mass / Math.max(1, mass - sim.fuel));
  const twr = maxThrust() / (mass * MU / (r * r));
  const peAlt = o.rp - R - REF_OFFSET;

  drawPanel([
    "Altitude   " + fmtAlt(alt - REF_OFFSET),
    "Speed      " + speed.toFixed(0) + " m/s  (up " + vert.toFixed(0) + ", along " + side.toFixed(0) + ")",
    "Apoapsis   " + fmtAlt(o.ra - R - REF_OFFSET),
    "Periapsis  " + fmtAlt(peAlt) + (o.bound && peAlt > 0 ? "  IN ORBIT" : ""),
    "Period     " + fmtTime(o.period)
  ]);
  drawBar({ mass: mass, dv: dv, twr: twr, tilt: tilt, cal: stabilityCal() });
}
