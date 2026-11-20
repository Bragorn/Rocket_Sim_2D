"use strict";

/* =====================================================================
   SETTINGS  (js/settings.js)
   Every number you will want to tune. SI units: meters, kilograms,
   seconds, newtons. The numbers that DEFINE parts (fuel density, engine
   weight, tank walls...) are in rules.js, not here.
   ===================================================================== */

/* ---- planet and physics ---- */
const R = 600000;                    // planet radius, m
const G0 = 9.81;                     // surface gravity, m/s2
const MU = G0 * R * R;               // gravity strength: force = m * MU / r^2
const DT = 1 / 60;                   // physics step, s
const VEL_IT = 16, POS_IT = 6;       // solver effort per step (more = stiffer joints, slower)

/* ---- steering ---- */
const GIMBAL_MAX = 6 * Math.PI / 180;// how far an engine can swivel, radians
const GIMBAL_RATE = 1.0;             // how fast it swivels, rad/s
const DAMP_PER_TORQUE = 2 / 3;       // how hard "rotation damping" fights spin: N*m per rad/s for every N*m of reaction wheel torque.
                                     // The torque itself comes from the reaction wheels in the rocket (nose cones have one built in, see rules.js)

/* ---- atmosphere ---- */
const RHO0 = 1.225;                  // air density at the ground, kg/m3
const SCALE_HEIGHT = 8500;           // the air thins by a factor of e every 8.5 km. Air pressure thins the same way

/* ---- fins ---- */
const FIN_CN = 5.0;                  // how hard a fin pushes sideways per radian of angle (bigger = stronger)
const FIN_STALL = 0.35;              // past about 20 degrees of angle the fin stops gaining push

/* ---- space ---- */
const SPACE_ALT = 70000;             // above this the air is too thin to matter: "reached space" and "in orbit" are measured from here

/* ---- the pad ---- */
const PAD_GAP = 0.02;                // the lowest point of the rocket starts this far above the ground, m

/* ---- breaking ---- */
const MIN_IMPACT_SPEED = 0.5;        // m/s: a part touching the ground slower than this is never damaged (guards against numerical noise).
                                     // How much a part can take is in rules.js (impactJPerKg)

/* ---- autopilot (autopilot.js) ---- */
const AP_AUTHORITY = 0.5;            // the autopilot plans its turns using this fraction of the turning power the rocket has, so it keeps some in reserve for disturbances
const AP_GAIN = 1.2;                 // 1/s: how hard it pulls on a small angle error (bigger = snappier, too big and it wobbles)
const AP_SETTLE = 0.15;              // s: how quickly it tries to get the spin it wants (must be well under 1 / (4 x AP_GAIN))
const AP_MAX_RATE = 1.0;             // rad/s: it never asks for a faster spin than this
const AP_KI = 0.8;                   // steer per (rad x s): the slow push that cancels a steady push on the rocket (air, an off-centre engine)
const AP_MIN_SPEED = 1;              // m/s: slower than this there is no "prograde" or "retrograde", so it keeps the direction it had
const AP_RETRO_HANDOFF = 8;          // m/s: holding retrograde, slower than this and near the ground, it hands over to "up"
const AP_RETRO_ALT = 3000;           // m: how close to the ground counts as "near" for that hand-over

/* The engine's built-in speed cap (2 m per step) would hold everything below 120 m/s.
   Raising it is what lets orbits work. */
try {
  planck.Settings.maxTranslation = 1000;
  planck.Settings.maxTranslationSquared = 1e6;
} catch (e) { log("could not raise the speed cap: " + e.message); }
