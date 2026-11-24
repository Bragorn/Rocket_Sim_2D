"use strict";

/* =====================================================================
   LAB  (js/lab.js, open lab.html)
   The looks lab. It runs the game's own drawing code (render.js) on a rocket that is not flown at all: sliders set its speed, height, the angle the air
   hits it at, throttle and how hard its legs are hit, and the rocket is moved along the planet at that speed so trails and smoke are real. Nothing here
   is for flying: use it to tune looks (air effects in the pause menu, flame shape, part colours) and read the numbers off the sliders.
   ===================================================================== */

var warp = 1, warpI = 0, warpActual = 1;        // main.js owns these in the game; the drawing code reads them
function setWarp() {}
var currentDesign = DESIGN;
function resetAll() { loadRocket(lab.rocket); }

const labTank = (id, w, l, extra) => Object.assign({ id: id, type: "tank", width: w, length: l }, extra);
const labEng = (id, parent, dx, thrust) => ({ id: id, type: "engine", thrust: thrust, parent: parent, anchor: "bottom", dx: dx });
const LAB_ROCKETS = {
  "Starting rocket (250 kN)": DESIGN,
  "Two stages (250 + 100 kN)": { version: 1, name: "two stages", stages: [["eng1"], ["dec", "eng2"]], parts: [
    labTank("tank2", 2, 2), labEng("eng2", "tank2", 0, 100000), { id: "dec", type: "decoupler", width: 2, parent: "eng2", anchor: "bottom", dx: 0 },
    labTank("tank1", 2, 4, { parent: "dec", anchor: "bottom", dx: 0 }), labEng("eng1", "tank1", 0, 250000),
    { id: "nose", type: "nose", width: 2, length: 1.5, parent: "tank2", anchor: "top", dx: 0 },
    { id: "leg", type: "leg", parent: "tank1", anchor: "side", side: 0, y: 0.4 }, { id: "fin", type: "fin", parent: "tank1", anchor: "side", side: 0, y: 0.6 }] },
  "Big: four 600 kN engines": { version: 1, name: "big", parts: [
    labTank("t", 4, 8), labEng("a", "t", -1.5, 600000), labEng("b", "t", -0.5, 600000), labEng("c", "t", 0.5, 600000), labEng("d", "t", 1.5, 600000),
    { id: "n", type: "nose", width: 4, length: 2, parent: "t", anchor: "top", dx: 0 },
    { id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4, drop: 4 }, { id: "f", type: "fin", parent: "t", anchor: "side", side: 0, y: 1 }] },
  "Huge: two 1.5 MN engines": { version: 1, name: "huge", parts: [
    labTank("t", 4, 8), labEng("a", "t", -1, 1500000), labEng("b", "t", 1, 1500000),
    { id: "n", type: "nose", width: 4, length: 2, parent: "t", anchor: "top", dx: 0 },
    { id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4, drop: 5 }] },
  "Small: 100 kN, 1 m wide": { version: 1, name: "small", parts: [
    labTank("t", 1, 4), labEng("e", "t", 0, 100000), { id: "n", type: "nose", width: 1, length: 1, parent: "t", anchor: "top", dx: 0 },
    { id: "l", type: "leg", parent: "t", anchor: "side", side: 0, y: 0.4, drop: 1.5 }, { id: "f", type: "fin", parent: "t", anchor: "side", side: 0, y: 0.4 }] }
};

const lab = { rocket: "Starting rocket (250 kN)", speed: 600, alt: 8000, aoa: 0, throttle: 0.6, stress: 0, phi: 0, note: "" };

function loadRocket(name) {
  lab.rocket = name;
  const d = LAB_ROCKETS[name], bad = validateDesign(d);
  lab.note = bad.length ? "this design is not valid: " + bad.join("; ") : "";
  ROCKET = assemble(d); currentDesign = d;
  buildWorld();
  for (const p of sim.parts) if (p.def.kind === "engine") p.active = true;
  for (const key in trails) delete trails[key];
  fx.life.fill(0);
}

function labStep(dt) {               // put the rocket where the sliders say, moving along the planet at that height
  const b = sim.hull.body, r = R + lab.alt + sim.refOffset - PAD_GAP;
  lab.phi += lab.speed / r * dt;
  const ex = Math.cos(lab.phi), ey = -Math.sin(lab.phi);                    // along the ground, the way it is going
  b.setTransform(P(r * Math.sin(lab.phi), r * Math.cos(lab.phi)), Math.atan2(-ex, ey) + lab.aoa * Math.PI / 180);
  b.setLinearVelocity(P(ex * lab.speed, ey * lab.speed)); b.setAngularVelocity(0);
  sim.rho = airDensity(lab.alt); sim.q = 0.5 * sim.rho * lab.speed * lab.speed; sim.aoa = Math.abs(lab.aoa);
  const pf = sim.rho / RHO0;
  controls.throttle = lab.throttle; sim.thrust = 0;
  for (const p of sim.parts) {
    for (const f of p.forces) if (f.kind === "thrust") { f.level = lab.throttle > 0 ? f.minThrottle + (1 - f.minThrottle) * lab.throttle : 0; f.now = f.level * (f.vac - (f.vac - f.sl) * pf); sim.thrust += f.now; }
    if (p.joint) p.stress = lab.stress;                                      // legs, fins, engines: the parts that can break off
  }
}

/* ---- the panel of sliders ---- */
function labPanel() {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:10px;top:130px;width:270px;padding:10px;background:rgba(10,14,18,0.85);border:1px solid rgba(255,255,255,0.2);font:12px monospace;color:#e8eef2;z-index:5";
  const add = function (el) { box.appendChild(el); return el; };
  const row = function (text) { const d = document.createElement("div"); d.textContent = text; d.style.cssText = "margin:8px 0 2px;color:#8a98a3"; return add(d); };
  const slider = function (label, key, min, max, step, fmt, onchange) {
    const head = row(""), s = document.createElement("input");
    s.type = "range"; s.min = min; s.max = max; s.step = step; s.value = lab[key]; s.style.width = "100%";
    const show = function () { head.textContent = label + ": " + fmt(lab[key]); };
    s.addEventListener("input", function () { lab[key] = parseFloat(s.value); show(); if (onchange) onchange(); });
    show(); add(s); return s;
  };
  row("Rocket");
  const sel = document.createElement("select"); sel.style.cssText = "width:100%;font:inherit";
  for (const n in LAB_ROCKETS) { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); }
  sel.addEventListener("change", function () { loadRocket(sel.value); }); add(sel);
  slider("Speed", "speed", 0, 3000, 10, v => v.toFixed(0) + " m/s");
  slider("Height", "alt", 0, 100000, 100, v => (v / 1000).toFixed(1) + " km");
  slider("Angle of the air on the nose", "aoa", -180, 180, 1, v => v.toFixed(0) + " deg (180 = engine first)");
  slider("Throttle", "throttle", 0, 1, 0.01, v => Math.round(v * 100) + "%");
  slider("Last hit on legs, fins, engines", "stress", 0, 1.3, 0.01, v => Math.round(v * 100) + "% of what they can take");
  slider("Zoom", "zoomLog", -1, 2, 0.01, v => Math.pow(10, v).toFixed(1) + " px per m", function () { St = Math.pow(10, lab.zoomLog); });
  const hint = row("Pause menu (Esc): Air effects off / ribbons / haze / both. Mouse wheel zooms.");
  hint.style.color = "#5f6e78";
  lab.noteEl = add(document.createElement("div")); lab.noteEl.style.color = "#f0b33c";
  document.body.appendChild(box);
}

lab.zoomLog = Math.log10(9);
let labLast = performance.now();
function labFrame(now) {
  const dt = Math.min(0.1, (now - labLast) / 1000);
  labLast = now;
  labStep(dt);
  updateView(dt);
  draw();
  lab.noteEl.textContent = lab.note;
  requestAnimationFrame(labFrame);
}

window.addEventListener("resize", resize);
window.addEventListener("wheel", function (e) { if (menuIsOpen()) return; e.preventDefault(); zoomBy(Math.exp(-clamp(e.deltaY, -100, 100) * 0.0015)); }, { passive: false });
window.addEventListener("keydown", function (e) { if (e.code === "Escape" && !e.repeat) { if (menuIsOpen()) menuBack(); else openMenu(); } });
resize();
loadRocket(lab.rocket);
labPanel();
requestAnimationFrame(labFrame);
