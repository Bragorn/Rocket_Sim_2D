"use strict";

/* =====================================================================
   LANDING  (js/landing.js)
   The landing program. Press 5 (or the Land button) while you are coming down: it holds the rocket against its path (the autopilot's
   retrograde), waits with the engine off, lights the engine at the right moment and throttles so that the rocket arrives at the ground
   going slowly enough for its legs. It only does what you could do by hand: it sets the throttle (controls.throttle) and the steering
   (through the autopilot). It works from what the rocket is right now (weight, thrust, height, speed), so it needs no settings per rocket.
   The idea, every physics step:
     1. How much thrust would stop the rocket exactly at the ground, at the speed it wants to touch down at, if the engine pointed straight
        against the path and stayed at one setting from now on?   (needed = (speed^2 - target^2) / (2 x distance left along the path) + the part of gravity along the path)
     2. Armed: the engine is off until that needs LAND_IGNITE (80%) of the thrust the engines have. The other 20% is the reserve.
     3. Burning: throttle so the thrust is what step 1 says. Worked out again every step, so if it is early, late, heavier or lighter than
        expected, the answer moves and the throttle follows.
     4. The engines cannot go below their lowest setting. If the answer is below it the engine is switched off until it is not, which near the
        end is the same pulsing you do by hand.
   It aims for a touchdown speed of LAND_SAFE of the speed that would break the rocket's feet (worked from its own legs and its weight now).
   If it is switched on too late to stop in time it says so and burns flat out. W, S, Z or X takes the throttle back (and switches it off).
   ===================================================================== */

const LAND_IGNITE = 0.80;            // the burn starts when stopping in time needs this fraction of full thrust (the rest is reserve)
const LAND_SAFE = 0.40;              // it aims to touch down at this fraction of the speed that would break the rocket's feet
const LAND_VT_MIN = 1.0, LAND_VT_MAX = 4.0;   // m/s: but it never aims for less than the first, or more than the second
const LAND_H0 = 0.5;                 // m: the height of the lowest point where it wants to be going at that speed
const LAND_ALIGN = 20;               // degrees: it will not light the engine pointing further than this off "against the path" unless it is the last chance

const landing = { mode: "off", vt: 2, fReq: 0, h: 0, vd: 0, tooLate: false, lit: false };    // mode: off, armed, burn, landed

function landingReset() { landing.mode = "off"; landing.tooLate = false; landing.lit = false; landing.fReq = 0; }

function landingOff(why) {
  if (landing.mode !== "armed" && landing.mode !== "burn") return;
  log("Landing program off" + (why ? " (" + why + ")" : ""), "autopilot");
  landingReset();
}

/* What the engines that are on and have fuel can do right now: thrust at full throttle in this air, and at their lowest setting, N. */
function landingEngines() {
  const pf = sim.rho / RHO0;
  let full = 0, floor = 0;
  for (const p of sim.vessel) for (const f of p.forces) {
    if (f.kind !== "thrust" || !p.active || !p.zone || !(p.zone.fuel > 0)) continue;
    const t = f.vac - (f.vac - f.sl) * pf;
    full += t; floor += t * f.minThrottle;
  }
  return { full: full, floor: floor };
}

/* The speed to touch down at: a fraction of what would break the feet (the parts that reach lowest), from the rules' impact figures and the weight now. */
function landingTargetSpeed(m) {
  let low = Infinity;
  const bottom = function (p) { let b = Infinity; for (const q of p.verts) b = Math.min(b, p.def.at[1] + q.y); return b; };
  for (const p of sim.vessel) low = Math.min(low, bottom(p));
  let cap = 0, hull = false;
  for (const p of sim.vessel) {
    if (bottom(p) > low + 0.5) continue;
    if (!p.joint) hull = true; else cap += impactCapacity(p.def);
  }
  const vb = hull || cap <= 0 ? Infinity : Math.sqrt(2 * cap / m);
  return clamp(LAND_SAFE * vb, LAND_VT_MIN, LAND_VT_MAX);
}

function landingArm() {
  if (!sim) return;
  if (!(landingEngines().full > 0)) { log("Landing: no engine is on and fed. Fire the stage with the engine first.", "autopilot"); return; }
  const v = sim.hull.body.getLinearVelocity();
  if (groundHeight() < 3 && Math.hypot(v.x, v.y) < 1) { log("Landing: the rocket is already on the ground.", "autopilot"); return; }
  landing.mode = "armed"; landing.tooLate = false; landing.lit = false;
  if (autopilot.mode !== "retro" && autopilot.mode !== "up") autopilotSet("retro");
  log("Landing program armed. It holds the rocket against its path and lights the engine when stopping in time needs " + Math.round(LAND_IGNITE * 100) + "% of full thrust.", "autopilot");
  const cal = stabilityCal();                                      // coming down engine-first, the fins are on the wrong side if the rocket is stable nose-first
  if (cal !== null && cal > 0.3) log("Landing: this rocket is stable nose-first (" + cal.toFixed(1) + " cal), so engine-first in thick air it wants to flip. Fast and low it may tumble. Fins high on the tank, or none, hold engine-first.", "warning");
}

function landingToggle() {
  if (landing.mode === "armed" || landing.mode === "burn") landingOff("switched off"); else landingArm();
}

function landingStep(dt) {           // called every physics step from updateControls
  if (landing.mode !== "armed" && landing.mode !== "burn") return;
  const b = sim.hull.body, p = b.getPosition(), v = b.getLinearVelocity(), r = Math.hypot(p.x, p.y), ux = p.x / r, uy = p.y / r;
  const vv = Math.hypot(v.x, v.y), vd = -(v.x * ux + v.y * uy), h = groundHeight(), g = MU / (r * r), m = totalMass(), en = landingEngines();
  landing.h = h; landing.vd = vd;

  if (sim.flown && h < 1.0 && vv < 0.6) {                        // down, and still
    controls.throttle = 0; landing.mode = "landed"; landing.lit = false;
    log("Landing: down. Touchdown " + (sim.touchdownSpeed === null ? "-" : sim.touchdownSpeed.toFixed(1)) + " m/s, " + sim.fuel.toFixed(0) + " kg of fuel left" + (landing.tooLate ? " (the burn started too late)" : ""), "autopilot");
    return;
  }
  if (typeof setWarp === "function" && typeof warp !== "undefined" && warp > 1) {   // slow time down for the last minute
    const tg = typeof groundCountdown === "function" ? groundCountdown() : null;
    if (landing.mode === "burn" || (tg !== null && tg < 60)) setWarp(0);
  }
  if (!(en.full > 0)) { controls.throttle = 0; if (landing.mode === "burn" && !landing.tooLate) { landing.tooLate = true; log("Landing: the engines have gone out (out of fuel?)", "warning"); } return; }

  const vt = landingTargetSpeed(m);
  const sinG = vv > 0.5 ? clamp(vd / vv, 0, 1) : 1;               // how steeply it is coming down (1 = straight down)
  const sEff = Math.max(h - LAND_H0, 0.3) / Math.max(sinG, 0.3);   // distance left along the path
  const aNeed = (vv * vv - vt * vt) / (2 * sEff) + g * sinG;      // thrust acceleration along the path that arrives at the ground going vt
  const nx = -Math.sin(b.getAngle()), ny = Math.cos(b.getAngle());
  const cosA = vv > 0.5 ? clamp(-(nx * v.x + ny * v.y) / vv, 0, 1) : clamp(nx * ux + ny * uy, 0, 1);   // how well the engine points against the path
  const fReq = aNeed * m / en.full;                               // as a fraction of the thrust the engines have
  landing.vt = vt; landing.fReq = fReq;

  if (landing.mode === "armed") {
    controls.throttle = 0;
    if (vd > 1 && fReq >= LAND_IGNITE && (cosA >= Math.cos(LAND_ALIGN * Math.PI / 180) || fReq >= 0.97)) {
      landing.mode = "burn";
      if (fReq > 1.02) { landing.tooLate = true; log("Landing: too late to stop in time (needs " + Math.round(fReq * 100) + "% of full thrust). Burning flat out.", "warning"); }
      else log("Landing burn: " + h.toFixed(0) + " m up, falling " + vd.toFixed(0) + " m/s, needs " + Math.round(fReq * 100) + "% thrust, aiming for " + vt.toFixed(1) + " m/s", "autopilot");
    } else return;
  }

  if (fReq > 1.02 && !landing.tooLate) { landing.tooLate = true; log("Landing: not enough thrust to stop in time (needs " + Math.round(fReq * 100) + "%). Burning flat out.", "warning"); }
  const f = fReq / Math.max(cosA, 0.5);                           // pointing a little off the path: ask for a little more
  const minL = en.floor / en.full;                                // the engines' lowest setting
  if (f >= minL) landing.lit = true; else if (!landing.lit || f < minL * 0.7) landing.lit = false;     // below the lowest setting: off (but not flickering)
  controls.throttle = landing.lit ? clamp((f - minL) / (1 - minL), 0.001, 1) : 0;
}

/* ---- keys, the bottom bar, the text under the big readout, the menu's key list ---- */
window.addEventListener("keydown", function (e) {
  if (paused) return;
  if (["KeyW", "KeyS", "KeyZ", "KeyX"].indexOf(e.code) >= 0 && (landing.mode === "armed" || landing.mode === "burn")) landingOff("you took the throttle");
  else if (e.code === "Digit5" && !e.repeat) landingToggle();
});

function drawLandingHud() {
  const y0 = Hh;
  c.font = "10px monospace"; c.textAlign = "left"; c.textBaseline = "bottom"; c.fillStyle = "rgba(255,255,255,0.55)";
  c.fillText("LANDING", 920, y0 + 58);
  chip(920, y0 + 60, 46, 18, "Land", landing.mode === "armed" || landing.mode === "burn", landingToggle);
  if (landing.mode === "off") return;
  let text, col;
  if (landing.mode === "landed") { text = "LANDED"; col = "#5fd38d"; }
  else if (landing.mode === "armed") { text = "LANDING ARMED   stopping needs " + (landing.vd > 1 ? Math.round(landing.fReq * 100) + "% thrust (burn at " + Math.round(LAND_IGNITE * 100) + "%)" : "nothing yet: not coming down"); col = "#f0b33c"; }
  else if (landing.tooLate) { text = "TOO LATE   needs " + Math.round(landing.fReq * 100) + "% thrust: burning flat out"; col = "#ff6b5e"; }
  else { text = "LANDING BURN   throttle " + Math.round(controls.throttle * 100) + "%   aiming for " + landing.vt.toFixed(1) + " m/s"; col = "#5fd38d"; }
  c.font = "bold 13px monospace"; c.textAlign = "center"; c.textBaseline = "top";
  const w = c.measureText(text).width + 20;
  c.fillStyle = "rgba(10,14,18,0.55)"; c.fillRect(W / 2 - w / 2, 88, w, 22);
  c.fillStyle = col; c.fillText(text, W / 2, 93);
  c.textAlign = "left";
}

if (typeof drawBar === "function") {
  const drawBarBefore = drawBar;
  drawBar = function () { drawBarBefore(); drawLandingHud(); };
}
if (typeof KEY_LIST !== "undefined") KEY_LIST.push(["5", "landing program: arm / switch off (W S Z X take the throttle back)"]);
