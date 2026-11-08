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
const WHEEL_MAX = 36000;             // reaction wheel torque, N*m
const DAMP_K = 24000;                // how hard "rotation damping" fights spin (N*m per rad/s)

/* ---- atmosphere ---- */
const RHO0 = 1.225;                  // air density at the ground, kg/m3
const SCALE_HEIGHT = 8500;           // the air thins by a factor of e every 8.5 km. Air pressure thins the same way

/* ---- fins ---- */
const FIN_CN = 5.0;                  // how hard a fin pushes sideways per radian of angle (bigger = stronger)
const FIN_STALL = 0.35;              // past about 20 degrees of angle the fin stops gaining push

/* ---- display ---- */
const REF_OFFSET = 3.3;              // height of the tank's centre when the rocket stands on its legs. Altitudes
                                     // are shown minus this, so the pad reads 0

/* The engine's built-in speed cap (2 m per step) would hold everything below 120 m/s.
   Raising it is what lets orbits work. */
try {
  planck.Settings.maxTranslation = 1000;
  planck.Settings.maxTranslationSquared = 1e6;
} catch (e) { log("could not raise the speed cap: " + e.message); }
