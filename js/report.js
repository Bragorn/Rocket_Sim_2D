"use strict";

/* =====================================================================
   REPORT  (js/report.js)
   The flight report, a card in the pause menu: the numbers, one small
   graph for each thing the recorder tracked, the event log, and the CSV
   export. The graphs are drawn once, when the report is opened, never while
   flying. It shows this flight and the last few recovered ones.
   ===================================================================== */

let reportPick = 0;                  // 0 = this flight, 1.. = recovered flights, newest first
const REPORT_GRAPHS = [
  { title: "Altitude (km)", ch: [1], mul: 0.001 },        { title: "Speed (m/s)", ch: [2], mul: 1 },             { title: "Acceleration (g)", ch: [5], mul: 1 },
  { title: "Thrust (kN)", ch: [6], mul: 0.001 },          { title: "Fuel (t)", ch: [8], mul: 0.001 },            { title: "Mass (t)", ch: [9], mul: 0.001 },
  { title: "Delta-v left (m/s)", ch: [10], mul: 1 },      { title: "Drag (kN)", ch: [11], mul: 0.001 },          { title: "Dynamic pressure (kPa)", ch: [13], mul: 0.001 },
  { title: "Angle of attack (deg)", ch: [14], mul: 1 },   { title: "Tilt (deg)", ch: [15], mul: 1 },             { title: "Apoapsis / Periapsis (km)", ch: [16, 17], mul: 0.001 }
];
const GRAPH_COLORS = ["#4aa3ff", "#ff9f43"];

function reportFlights() { return [teleSnapshot("This flight", flightEnded ? "recovered" : "in progress")].concat(flightLog.slice().reverse()); }

function drawReportGraph(snap, g) {
  const cv = document.createElement("canvas"); cv.width = 280; cv.height = 130;
  const k = cv.getContext("2d"), n = snap.n, t = snap.channels[0], L = 8, R2 = 8, T = 22, B = 16, pw = cv.width - L - R2, ph = cv.height - T - B;
  k.fillStyle = "#0d1318"; k.fillRect(0, 0, cv.width, cv.height);
  let lo = 0, hi = 0, any = false;
  for (const c of g.ch) for (let i = 0; i < n; i++) { const x = snap.channels[c][i] * g.mul; if (isFinite(x)) { any = true; lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  if (hi - lo < 1e-9) hi = lo + 1;
  hi += (hi - lo) * 0.06;
  const tMax = Math.max(5, n ? t[n - 1] : 0), span = hi - lo;
  k.font = "11px monospace"; k.textBaseline = "top"; k.textAlign = "left"; k.fillStyle = "#e8eef2"; k.fillText(g.title, L, 5);
  k.strokeStyle = "rgba(255,255,255,0.35)"; k.lineWidth = 1; k.beginPath(); k.moveTo(L, T + ph + 0.5); k.lineTo(L + pw, T + ph + 0.5); k.stroke();
  if (!any) { k.fillStyle = "#8a98a3"; k.textAlign = "center"; k.fillText("no data", cv.width / 2, cv.height / 2); return cv; }
  k.strokeStyle = "rgba(255,255,255,0.18)"; k.beginPath();                      // the events, as faint vertical lines
  for (const e of snap.events) if (e.kind === "flight" || e.kind === "event") { const x = Math.round(L + e.t / tMax * pw) + 0.5; k.moveTo(x, T); k.lineTo(x, T + ph); }
  k.stroke();
  if (lo < 0) { const zy = Math.round(T + ph - (0 - lo) / span * ph) + 0.5; k.strokeStyle = "rgba(255,255,255,0.25)"; k.beginPath(); k.moveTo(L, zy); k.lineTo(L + pw, zy); k.stroke(); }
  const stride = Math.max(1, Math.floor(n / pw));
  let peak = -Infinity, last = NaN;
  g.ch.forEach(function (c, s) {
    const a = snap.channels[c];
    k.strokeStyle = GRAPH_COLORS[s]; k.lineWidth = 1.5; k.beginPath();
    let pen = false;
    for (let i = 0; i < n; i += stride) {
      const x = a[i] * g.mul;
      if (!isFinite(x)) { pen = false; continue; }
      const X = L + t[i] / tMax * pw, Y = T + ph - (x - lo) / span * ph;
      if (!pen) { k.moveTo(X, Y); pen = true; } else k.lineTo(X, Y);
      if (x > peak) peak = x;
    }
    k.stroke();
    const v = a[n - 1] * g.mul; if (isFinite(v)) last = v;
  });
  const f = (x) => Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
  k.textAlign = "right"; k.fillStyle = "#e8eef2"; k.fillText(isFinite(last) ? "end " + f(last) : "", cv.width - R2, 5);
  k.font = "10px monospace"; k.textBaseline = "bottom"; k.fillStyle = "rgba(255,255,255,0.65)";
  k.textAlign = "center"; k.fillText(isFinite(peak) ? "peak " + f(peak) : "", cv.width / 2, cv.height - 2);
  k.textAlign = "right"; k.fillText(Math.round(tMax) + " s", cv.width - R2, cv.height - 2); k.textAlign = "left"; k.fillText("0 s", L, cv.height - 2);
  return cv;
}

function buildReport(box) {
  box.className = "mbox wide";
  const flights = reportFlights();
  if (reportPick >= flights.length) reportPick = 0;
  const snap = flights[reportPick];

  const head = mel("div"); head.style.display = "flex"; head.style.gap = "10px"; head.style.alignItems = "center"; head.style.marginBottom = "8px";
  head.appendChild(mel("div", "mh", "Flight report"));
  const sel = mel("select"); sel.style.cssText = "margin-left:auto;padding:4px;font:inherit;color:#e8eef2;background:#141b22;border:1px solid rgba(255,255,255,0.22)";
  flights.forEach(function (f, i) { const o = mel("option", "", (i === 0 ? "This flight" : f.label) + " (" + f.status + ")"); o.value = String(i); sel.appendChild(o); });
  sel.value = String(reportPick);
  sel.addEventListener("change", function () { reportPick = parseInt(sel.value, 10); showPanel("report"); });
  head.appendChild(sel);
  const ex = mel("button", "mb", "Export CSV"); ex.type = "button"; ex.style.cssText = "width:auto;padding:6px 12px;margin:0";
  ex.disabled = snap.n === 0; ex.addEventListener("click", function () { exportCsv(snap); });
  const back = mel("button", "mb", "Back"); back.type = "button"; back.style.cssText = "width:auto;padding:6px 12px;margin:0";
  back.addEventListener("click", function () { showPanel("main"); });
  head.appendChild(ex); head.appendChild(back); box.appendChild(head);

  if (snap.n === 0) { box.appendChild(mel("div", "ms", "No flight data yet: the recorder starts when the engine is lit.")); }

  const cols = mel("div"); cols.style.cssText = "display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px";
  const sum = mel("div"); sum.style.cssText = "min-width:300px;flex:1";
  for (const r of summaryRows(snap.summary)) { const row = mel("div", "mrow"); row.appendChild(mel("span", "k", r[0])); row.appendChild(mel("span", "", r[1])); sum.appendChild(row); }
  const ev = mel("div"); ev.style.cssText = "flex:1;min-width:300px;max-height:230px;overflow-y:auto";
  if (snap.events.length === 0) ev.appendChild(mel("div", "ms", "No messages."));
  for (const e of snap.events) {
    const line = mel("div", "mrow2"); line.appendChild(mel("span", "k", "T+" + e.t.toFixed(1)));
    const txt = mel("span", "", e.text); if (e.kind === "warning") txt.style.color = "#f0b33c"; else if (e.kind === "autopilot") txt.style.color = "#5fd38d";
    line.appendChild(txt); ev.appendChild(line);
  }
  cols.appendChild(sum); cols.appendChild(ev); box.appendChild(cols);

  const grid = mel("div"); grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px";
  for (const g of REPORT_GRAPHS) grid.appendChild(drawReportGraph(snap, g));
  box.appendChild(grid);
}
