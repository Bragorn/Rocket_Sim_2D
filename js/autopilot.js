"use strict";

/* =====================================================================
   AUTOPILOT  (js/autopilot.js)
   Holds the rocket pointing a certain way. It does NOT turn the rocket itself: it only works out
   a steer number (-1 to 1) and hands it to controls.steer, exactly where the A and D keys put theirs.
   From there the real reaction wheels and engine gimbal do the turning, so:
     - it can only turn as fast as the rocket's turning power allows (a big rocket turns slowly)
     - air, an off-centre engine or a knock can still push the rocket off, and it has to fight back
     - with no wheel and the engine off it has nothing to turn with, and says so
   Modes:  hold (the way the rocket pointed when you switched it on), pro (along its path),
           retro (against its path), up (away from the planet). Press the same one again, or Off, to switch it off.
           Touching A or D takes the steering back and switches it off.
   How it decides: it looks at how far it is from the wanted direction and how fast it is spinning, and asks for the
   spin that would just stop it on the target using about half of its turning power (AP_AUTHORITY), then steers to get that
   spin. A slow extra push (AP_KI) cancels a steady disturbance. Numbers are in settings.js.
   It also draws its own buttons in the bottom bar (wrapping drawBar from render.js), and adds its keys to the menu's key list.
   ===================================================================== */

const AP_MODES = [["hold", "Hold", "Digit1", "hold the heading it has now"], ["pro", "Pro", "Digit2", "hold prograde (along the path)"],
                  ["retro", "Retro", "Digit3", "hold retrograde (against the path)"], ["up", "Up", "Digit4", "hold up (away from the planet)"]];
const AP_NAMES = { hold: "hold heading", pro: "prograde", retro: "retrograde", up: "up" };
const autopilot = { mode: "off", target: 0, lastTarget: null, rate: 0, integ: 0, err: 0, onTarget: false, satTime: 0, noPower: false, lastWarn: -99, manual: false };

function wrapAngle(x) { return ((x + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }
function tiltDeg(a) {                // the same angle the HUD calls tilt: 0 = pointing straight up from the planet
  const p = sim.hull.body.getPosition(), phi = Math.atan2(p.x, p.y);
  return wrapAngle(a + phi) * 180 / Math.PI;
}

function autopilotReset() { autopilot.mode = "off"; autopilot.lastTarget = null; autopilot.rate = 0; autopilot.integ = 0; autopilot.err = 0; autopilot.onTarget = false; autopilot.satTime = 0; autopilot.noPower = false; autopilot.manual = false; }

function autopilotOff(why) {
  if (autopilot.mode === "off") return;
  log("Autopilot off" + (why ? " (" + why + ")" : ""), "autopilot");
  autopilotReset();
}

function autopilotOverride() {       // A or D held: the autopilot stands aside but stays switched on
  if (!autopilot.manual) log("Autopilot: manual steering", "autopilot");
  autopilot.manual = true; autopilot.integ = 0; autopilot.onTarget = false;
}

function autopilotRelease() {        // A and D let go: hold re-locks where the rocket will have stopped turning; the others just carry on
  if (!autopilot.manual) return;
  autopilot.manual = false; autopilot.integ = 0; autopilot.rate = 0; autopilot.lastTarget = null;
  if (autopilot.mode === "hold") {
    const b = sim.hull.body, w = b.getAngularVelocity(), tp = turningPower(), a = AP_AUTHORITY * (tp.aW + tp.aG);
    autopilot.target = b.getAngle() + (a > 1e-9 ? w * Math.abs(w) / (2 * a) : 0);
    log("Autopilot: holding tilt " + tiltDeg(autopilot.target).toFixed(0) + " deg", "autopilot");
  }
}

function autopilotSet(mode) {        // switch a mode on, or off if it is already on
  if (!sim || mode === "off" || autopilot.mode === mode) { autopilotOff("switched off"); return; }
  const was = autopilot.mode;
  autopilotReset();
  autopilot.mode = mode;
  autopilot.target = sim.hull.body.getAngle();                      // until it has something better, the way the rocket points now
  autopilotAim(0);
  log("Autopilot: " + AP_NAMES[mode] + (mode === "hold" ? " (tilt " + tiltDeg(autopilot.target).toFixed(0) + " deg)" : "") + (was !== "off" ? ", was " + AP_NAMES[was] : ""), "autopilot");
}

/* The angle the rocket should point at. The rocket's nose points along (-sin a, cos a), so a direction (dx, dy) is the angle atan2(-dx, dy). */
function autopilotAim(dt) {
  const b = sim.hull.body, p = b.getPosition(), v = b.getLinearVelocity(), r = Math.hypot(p.x, p.y), sp = Math.hypot(v.x, v.y);
  let dx = 0, dy = 0, ok = false;
  if (autopilot.mode === "up" && r > 0) { dx = p.x / r; dy = p.y / r; ok = true; }
  else if (autopilot.mode === "pro" && sp >= AP_MIN_SPEED) { dx = v.x / sp; dy = v.y / sp; ok = true; }
  else if (autopilot.mode === "retro" && sp >= AP_MIN_SPEED) { dx = -v.x / sp; dy = -v.y / sp; ok = true; }
  if (ok) {
    autopilot.target = Math.atan2(-dx, dy);
    if (autopilot.lastTarget !== null && dt > 0) autopilot.rate += (wrapAngle(autopilot.target - autopilot.lastTarget) / dt - autopilot.rate) * 0.1;   // how fast the wanted direction itself is swinging round
    autopilot.lastTarget = autopilot.target;
  } else { autopilot.rate *= 0.9; autopilot.lastTarget = null; }
}

/* How much the rocket can speed up its turn per unit of steer, rad/s2: from its wheels, and from the engine swivelling while it burns. */
function turningPower() {
  const b = sim.hull.body, lc = b.getLocalCenter(), I = b.getInertia() - b.getMass() * (lc.x * lc.x + lc.y * lc.y);   // spin inertia about its centre of mass
  if (!(I > 0)) return { aW: 0, aG: 0 };
  const a = b.getAngle(), ax = -Math.sin(a), ay = Math.cos(a), cg = b.getWorldCenter();
  let g = 0;
  for (const p of sim.vessel) for (const f of p.forces) {
    if (f.kind !== "thrust" || !(f.now > 0)) continue;
    const n = p.body.getWorldPoint(P(p.ox + f.at[0], p.oy + f.at[1])), lever = Math.abs((n.x - cg.x) * ax + (n.y - cg.y) * ay);
    g += f.now * Math.sin(f.gimbalMax) * lever;
  }
  return { aW: sim.wheelMax / I, aG: g / I };
}

function autopilotSteer(dt) {
  const b = sim.hull.body, w = b.getAngularVelocity();
  autopilotAim(dt);
  const err = wrapAngle(autopilot.target - b.getAngle()), tp = turningPower(), aTot = tp.aW + tp.aG;
  autopilot.err = err;
  if (!(aTot > 1e-9)) {
    if (!autopilot.noPower) { autopilot.noPower = true; log("Autopilot: nothing to turn with (no reaction wheel, and no engine burning to swivel)", "autopilot"); }
    return 0;
  }
  autopilot.noPower = false;
  const aUse = AP_AUTHORITY * aTot, ae = Math.abs(err), e0 = 2 * aUse / (AP_GAIN * AP_GAIN);   // inside e0 it pulls gently, outside it follows the braking curve
  let wd = ae < e0 ? AP_GAIN * err : Math.sign(err) * Math.sqrt(2 * aUse * ae);
  wd = clamp(wd, -AP_MAX_RATE, AP_MAX_RATE) + autopilot.rate;
  const want = (wd - w) / AP_SETTLE;                                          // the turning acceleration it wants right now
  const damp = controls.damping ? DAMP_PER_TORQUE * tp.aW * w : 0;           // the wheels' own damping is working against it, so it asks for that much more
  let steer = (want + damp) / aTot + autopilot.integ;
  const out = clamp(steer, -1, 1);
  if (ae < 0.3 && out === steer) autopilot.integ = clamp(autopilot.integ + AP_KI * err * dt, -0.5, 0.5);   // wind up only when it is close and not at full steer
  if (!autopilot.onTarget && ae < 0.0175 && Math.abs(w) < 0.02) { autopilot.onTarget = true; log("Autopilot: on target (" + AP_NAMES[autopilot.mode] + ", within 1 deg)", "autopilot"); }
  else if (autopilot.onTarget && ae > 0.09) autopilot.onTarget = false;
  if (Math.abs(out) >= 1 && ae > 0.1) autopilot.satTime += dt; else autopilot.satTime = 0;
  if (autopilot.satTime > 4 && sim.t - autopilot.lastWarn > 10) { autopilot.lastWarn = sim.t; log("Autopilot: turning flat out and still " + (ae * 180 / Math.PI).toFixed(0) + " deg off (the rocket is too heavy for its wheels, or something is pushing it)", "autopilot"); }
  return out;
}

/* ---- keys, the bottom bar, and the menu's key list ---- */
window.addEventListener("keydown", function (e) {
  if (paused || e.repeat) return;
  for (const m of AP_MODES) if (e.code === m[2]) autopilotSet(m[0]);
});

function drawAutopilotChips(y0, note) {
  c.font = "10px monospace"; c.textAlign = "left"; c.textBaseline = "bottom"; c.fillStyle = "rgba(255,255,255,0.55)";
  c.fillText("AUTOPILOT", 720, y0 + 58);
  AP_MODES.forEach(function (m, i) { chip(720 + i * 50, y0 + 60, 46, 18, m[1], autopilot.mode === m[0], function () { autopilotSet(m[0]); }); });
  c.font = "11px monospace"; c.textBaseline = "middle"; c.textAlign = "left";
  if (autopilot.mode !== "off") {                                    // one status word: what it is doing right now
    const deg = Math.abs(autopilot.err * 180 / Math.PI).toFixed(1);
    let s, col = "#f0b33c";
    if (autopilot.manual) s = "MANUAL, re-holds when you let go";
    else if (autopilot.noPower) { s = "NO POWER to turn"; col = "#ff6b5e"; }
    else if (autopilot.onTarget) { s = AP_NAMES[autopilot.mode] + ": on target"; col = "#5fd38d"; }
    else s = AP_NAMES[autopilot.mode] + ": " + deg + " deg off";
    c.fillStyle = col; c.fillText(s, 926, y0 + 69.5);
  }
  if (note) { c.fillStyle = "#f0b33c"; c.fillText(note, 812, y0 + 41.5); }     // render.js draws the "running 3x" note in the corner these buttons use, so it is moved here
}

if (typeof drawBar === "function") {
  const drawBarBase = drawBar;
  drawBar = function () {            // the bar as render.js draws it, then the autopilot's buttons on top
    const note = barText.warpNote;
    barText.warpNote = "";
    drawBarBase();
    barText.warpNote = note;
    drawAutopilotChips(Hh, note);
  };
}
if (typeof KEY_LIST !== "undefined") KEY_LIST.push(["1 2 3 4", "autopilot: hold heading / prograde / retrograde / up (again = off; A or D takes over)"]);
