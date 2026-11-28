"use strict";

/* =====================================================================
   MAP VESSELS  (js/mapvessels.js)
   The other vessels of the universe on the map screen (M): the ones in orbit, drawn with their orbits and moving along them as time passes
   (rails.js), the ones on the ground as dots on the planet. Click one to select it: a small panel says what it is, and offers to switch to it,
   or says why it cannot be switched to yet (the same rules as the Vessels list: this rocket has to be safe to leave first).
   render.js calls drawMapVessels while it draws the map, and main.js passes mouse clicks to mapMouseDown.
   ===================================================================== */

let mapOthers = { clock: 0, vessels: [] };   // the other vessels (flightstate.js flightMapVessels), looked up about once a second
let mapOthersAt = -1e9;                      // when (performance.now) that was
let mapOthersTime = 0;                       // the universe clock when it was
let mapSelected = null;                      // the id of the vessel clicked on
const mapMarkers = [];                       // { id, x, y }: where each vessel was drawn on the screen, remade each frame
const mapButtons = [];                       // the panel's Switch button: { x, y, w, h, fn }
const MAP_COLORS = { orbit: "#7fd1ff", landed: "#9be58a", pad: "#e8eef2", flying: "#ffb35c" };

function mapVesselsReset() { mapSelected = null; mapOthersAt = -1e9; }          // the map has just been opened

function mapOthersNow(nowMs) {
  if (nowMs - mapOthersAt > 1000) {
    mapOthers = flightMapVessels(); mapOthersAt = nowMs; mapOthersTime = flightUniverseClock();
    if (mapSelected && !mapOthers.vessels.some(function (v) { return v.id === mapSelected; })) mapSelected = null;   // scrapped or switched to meanwhile
  }
  return mapOthers;
}

/* the universe time now, and where a listed vessel is at it */
function mapClockNow() { return mapOthers.clock + (flightUniverseClock() - mapOthersTime); }
function mapVesselPos(v) { return vesselStateAt({ status: v.status, state: v.state, epoch: v.epoch }, mapClockNow()).pos; }

/* How far from the planet's centre the farthest other vessel (or the far end of its orbit) goes, so the map can be zoomed to fit them. */
function mapVesselsExtent() {
  let far = 0;
  for (const v of flightMapVessels().vessels) {
    far = Math.max(far, Math.hypot(v.pos.x, v.pos.y));
    if (v.orbit) for (const q of v.orbit) far = Math.max(far, Math.hypot(q.x, q.y));
  }
  return far;
}

/* What the panel says about a vessel: { title, where, canSwitch, reasons }. `leave` is flightCanLeave(). */
function mapPanelInfo(v, leave) {
  return { title: v.name, where: v.where + (v.status === "flying" ? " (left mid-flight)" : ""), canSwitch: leave.ok, reasons: leave.ok ? [] : leave.reasons.slice(0, 3) };
}

function drawMapVessels(c, M) {
  mapMarkers.length = 0; mapButtons.length = 0;
  const list = mapOthersNow(performance.now());
  if (list.vessels.length === 0) return;
  c.font = "11px monospace"; c.textBaseline = "middle"; c.textAlign = "left";
  const label = list.vessels.length <= 8;
  for (const v of list.vessels) {
    const color = MAP_COLORS[v.status] || "#fff", sel = v.id === mapSelected;
    if (v.orbit) {                                          // its orbit, a thin line (brighter if selected)
      c.strokeStyle = sel ? color : "rgba(127,209,255,0.4)"; c.lineWidth = sel ? 1.8 : 1; c.beginPath();
      for (let i = 0; i < v.orbit.length; i++) { const s = M(v.orbit[i].x, v.orbit[i].y); if (i === 0) c.moveTo(s[0], s[1]); else c.lineTo(s[0], s[1]); }
      c.stroke();
    }
    const p = mapVesselPos(v), s = M(p.x, p.y);
    if (!(s[0] > -20 && s[0] < W + 20 && s[1] > -20 && s[1] < Hh + 20)) continue;
    mapMarkers.push({ id: v.id, x: s[0], y: s[1] });
    c.fillStyle = color; c.strokeStyle = "#05070a"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(s[0], s[1] - 6); c.lineTo(s[0] + 6, s[1]); c.lineTo(s[0], s[1] + 6); c.lineTo(s[0] - 6, s[1]); c.closePath(); c.fill(); c.stroke();
    if (sel) { c.strokeStyle = color; c.lineWidth = 1.5; c.beginPath(); c.arc(s[0], s[1], 11, 0, 6.2832); c.stroke(); }
    if (label || sel) { c.fillStyle = color; c.fillText(v.name, s[0] + 10, s[1] - 9); }
  }
  c.fillStyle = "rgba(232,238,242,0.55)"; c.textAlign = "right";
  c.fillText(list.vessels.length + (list.vessels.length === 1 ? " other vessel: click it" : " other vessels: click one"), W - 12, 18);
  c.textAlign = "left";

  const sv = mapSelected && list.vessels.find(function (v) { return v.id === mapSelected; });
  if (sv) {                                                 // the panel
    const info = mapPanelInfo(sv, flightCanLeave()), x = 12, y = 12, w = 300;
    const lines = [info.where].concat(info.canSwitch ? [] : info.reasons.map(function (r) { return "Can't switch yet: " + r; }));
    const wrapped = [];
    for (const t of lines) { let s = t; while (s.length > 44) { let k = s.lastIndexOf(" ", 44); if (k < 10) k = 44; wrapped.push(s.slice(0, k)); s = s.slice(k).trim(); } wrapped.push(s); }
    const h = 34 + wrapped.length * 15 + (info.canSwitch ? 34 : 6);
    c.fillStyle = "rgba(10,14,20,0.88)"; c.strokeStyle = "#3d4a5c"; c.lineWidth = 1; c.fillRect(x, y, w, h); c.strokeRect(x, y, w, h);
    c.fillStyle = "#e8eef2"; c.font = "bold 13px monospace"; c.fillText(info.title, x + 10, y + 17);
    c.font = "11px monospace"; c.fillStyle = info.canSwitch ? "#b8c6d6" : "#ffcf8a";
    wrapped.forEach(function (t, i) { c.fillText(t, x + 10, y + 36 + i * 15); });
    if (info.canSwitch) {
      const bx = x + 10, by = y + h - 30, bw = w - 20, bh = 22;
      c.fillStyle = "#2c6e49"; c.fillRect(bx, by, bw, bh); c.strokeStyle = "#6fcf97"; c.strokeRect(bx, by, bw, bh);
      c.fillStyle = "#fff"; c.textAlign = "center"; c.fillText("Switch to this vessel", bx + bw / 2, by + bh / 2); c.textAlign = "left";
      const id = sv.id; mapButtons.push({ x: bx, y: by, w: bw, h: bh, fn: function () { doSwitch(id); } });
    }
  }
}

/* A click on the map at (x, y) on the screen. Returns true if it was used (a vessel selected, the button pressed, a selection cleared). */
function mapMouseDown(x, y) {
  for (const b of mapButtons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return true; }
  let best = null, bd = 14;
  for (const m of mapMarkers) { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m; } }
  if (best) { mapSelected = best.id; return true; }
  if (mapSelected) { mapSelected = null; return true; }
  return false;
}
