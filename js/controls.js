"use strict";

/* =====================================================================
   CONTROLS  (js/controls.js)
   The ONE place the sim reads its controls from:
     controls.throttle  0 to 1
     controls.steer     -1 to 1 (+1 turns the rocket counter-clockwise, nose to the left)
     controls.damping   true = the reaction wheel fights any spin
   updateControls() fills them in from the keyboard, or, while an autopilot
   hold is on (autopilot.js), steer comes from the autopilot instead (same number,
   so sim.js never changes and the autopilot gets no powers you do not have).
   ===================================================================== */

const controls = { throttle: 0, steer: 0, damping: true };
const keys = {};                     // which keys are held right now
let paused = false;                  // the pause menu sets this: while true the sim does not step and flight keys do nothing

function controlsReset() {
  controls.throttle = 0; controls.steer = 0; controls.damping = true;
  if (typeof autopilotReset === "function") autopilotReset();
}

function updateControls(dt) {        // called once per physics step, before the forces are worked out
  if (keys.KeyW) controls.throttle = Math.min(1, controls.throttle + 0.5 * dt);
  if (keys.KeyS) controls.throttle = Math.max(0, controls.throttle - 0.5 * dt);
  const hand = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  if (typeof autopilotSteer === "function" && autopilot.mode !== "off") {
    if (hand !== 0) { autopilotOverride(); controls.steer = hand; return; }   // A or D: you steer while held
    autopilotRelease();                                                       // let go: it takes over again
    controls.steer = autopilotSteer(dt); return;
  }
  controls.steer = hand;
}

window.addEventListener("keydown", function (e) {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0) e.preventDefault();
  if (paused) return;
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "KeyZ") controls.throttle = 1;
  else if (e.code === "KeyX") controls.throttle = 0;
  else if (e.code === "KeyT") controls.damping = !controls.damping;
});
window.addEventListener("keyup", function (e) { keys[e.code] = false; });
