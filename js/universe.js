"use strict";

/* =====================================================================
   UNIVERSE  (js/universe.js)
   The world that outlives a flight: every spacecraft that exists, which one you are flying,
   and the universe clock. It is plain data (it saves as text) and it knows nothing about planck,
   the screen or the builder, so the flight page and the builder page can both use it.
   This is the data layer only. Nothing in the game reads or writes it yet.

   A universe:  { version, clock, nextId, activeId, vessels: [ vessel, ... ] }
     clock     universe time in seconds. Resources and orbits will run off this, not off a flight's own clock
     nextId    the number the next vessel's id will get ("v1", "v2", ...); ids are never reused
     activeId  the vessel you are flying or have open (null = none)
   A vessel:    { id, name, design, status, state, revert }
     design    the rocket's design (design.js). It is what the vessel is built from, so it is kept whole
     status    "pad"     standing on the launch pad, untouched (state is null)
               "flying"  in the air under full physics when it was last saved
               "landed"  on the ground away from the pad
               "orbit"   above the air, to be moved along its orbit without full physics (a later milestone)
     state     null for a vessel on the pad. Otherwise where the vessel was and what it had left:
               { pos: {x, y}, vel: {x, y}, angle, angVel, fuel: { tankId: kg }, stageNext,
                 activeEngines: [ids], detached: [ids], throttle }   (positions from the planet's centre, SI units)
               THIS SHAPE IS PROVISIONAL: the next milestone (saving a real flight) will confirm it against the sim.
               Fields it does not know about are kept, so a later version can add some without breaking old saves.
     revert    true from the moment it is launched until the player leaves it (back to the builder or to another vessel). While it is
               true, "Revert to launch" works. Left out in saves from before this existed, which counts as false.

   Launching (universeLaunchBlock says why not): the pad must be clear (only one vessel can stand on it; it is cleared by
   recovering the vessel, by flying it off, or by taking an untouched one off), no vessel may be left mid-flight (status
   "flying": it has to be resumed and settled, or scrapped), and the universe must not be full (MAX_VESSELS).

   Like designs, a universe is never changed in place: every change returns a new one.

   Saving: the browser's storage, in three slots so an interrupted save (power cut, tab closed, storage full) cannot
   lose the universe. The new save is written to ".next" first, the old good save is copied to ".prev", then the main slot is
   written and ".next" removed. Loading takes the newest save that reads and checks out, and falls back to ".prev".
   Every save carries a checksum and a save number. Saves carry a version; older ones are brought up to date through
   UNIVERSE_MIGRATIONS, newer ones are refused (so an old copy of the game never overwrites a newer save).
   ===================================================================== */

const UNIVERSE_FORMAT = "rocketsim.universe";
const UNIVERSE_VERSION = 1;
const UNIVERSE_KEY = "rocketsim.universe";             // the main slot; UNIVERSE_KEY + ".next" is a save in progress, + ".prev" the save before
const VESSEL_STATUS = ["pad", "flying", "landed", "orbit"];

/* When the format changes: raise UNIVERSE_VERSION and add UNIVERSE_MIGRATIONS[old] = function (data) { ...; return data; }
   that turns a universe saved as version `old` into version old + 1 (the version number itself is set for you). */
const UNIVERSE_MIGRATIONS = {};

/* ---- making and changing a universe ---- */
function universeNew() {
  return { version: UNIVERSE_VERSION, clock: 0, nextId: 1, activeId: null, vessels: [] };
}

function universeCopy(u) { return JSON.parse(JSON.stringify(u)); }

function universeVessel(u, id) {       // the vessel with this id, or null
  return u.vessels.find(function (v) { return v.id === id; }) || null;
}

function padOccupant(u) {              // the vessel standing on the pad, or null
  return u.vessels.find(function (v) { return v.status === "pad"; }) || null;
}
function padIsClear(u) { return padOccupant(u) === null; }

/* Why a new rocket cannot go on the pad right now, or null if it can. */
function universeLaunchBlock(u) {
  const on = padOccupant(u);
  if (on) return "the pad is not clear: " + on.name + " is still on it";
  const air = u.vessels.find(function (v) { return v.status === "flying"; });
  if (air) return air.name + " was left mid-flight: resume it and bring it down or into orbit, or scrap it";
  if (typeof MAX_VESSELS !== "undefined" && u.vessels.length >= MAX_VESSELS) return "the universe is full (" + u.vessels.length + " vessels): scrap one first";
  return null;
}

/* Put a new rocket on the pad. Only if universeLaunchBlock allows it and the design is one that can be launched.
   Returns { universe, id, problem }: id is the new vessel's id, or null (and problem says why) with the universe unchanged.
   It becomes the active vessel, and it can be reverted until it is left. */
function universeAddVessel(u, design, name) {
  const block = universeLaunchBlock(u);
  if (block) return { universe: u, id: null, problem: block };
  const bad = validateDesign(design);
  if (bad.length) return { universe: u, id: null, problem: "that design cannot be launched: " + bad[0] };
  const n = universeCopy(u), id = "v" + n.nextId++;
  n.vessels.push({ id: id, name: String(name || design.name || "rocket"), design: JSON.parse(JSON.stringify(design)), status: "pad", state: null, revert: true });
  n.activeId = id;
  return { universe: n, id: id, problem: null };
}

/* Take a vessel out of the universe (recovered, or lost). If it was the active one, no vessel is active. */
function universeRemoveVessel(u, id) {
  if (!universeVessel(u, id)) return { universe: u, problem: "there is no vessel " + id };
  const n = universeCopy(u);
  n.vessels = n.vessels.filter(function (v) { return v.id !== id; });
  if (n.activeId === id) n.activeId = null;
  return { universe: n, problem: null };
}

function universeSetActive(u, id) {    // id = null: no vessel active
  if (id !== null && !universeVessel(u, id)) return { universe: u, problem: "there is no vessel " + id };
  const n = universeCopy(u);
  n.activeId = id;
  return { universe: n, problem: null };
}

/* Change a vessel's name, status, state or revert flag. Anything else in the patch (its id, its design) is ignored. */
function universeUpdateVessel(u, id, patch) {
  if (!universeVessel(u, id)) return { universe: u, problem: "there is no vessel " + id };
  const n = universeCopy(u), v = universeVessel(n, id);
  for (const k of ["name", "status", "state", "revert"]) if (patch && patch[k] !== undefined) v[k] = JSON.parse(JSON.stringify(patch[k]));
  return { universe: n, problem: null };
}

function universeAdvance(u, dt) {      // move the universe clock on by dt seconds (a bad or negative dt changes nothing)
  if (!(dt >= 0) || !isFinite(dt)) return u;
  const n = universeCopy(u);
  n.clock += dt;
  return n;
}

/* ---- checking ---- */
const uvNum = function (x) { return typeof x === "number" && isFinite(x); };
const uvXY = function (p) { return !!p && typeof p === "object" && uvNum(p.x) && uvNum(p.y); };
const uvIds = function (a) { return Array.isArray(a) && a.every(function (s) { return typeof s === "string"; }); };

function vesselStateProblems(s) {      // what is wrong with a vessel's state (empty = fine)
  const bad = [];
  if (!s || typeof s !== "object") return ["its state is missing"];
  if (!uvXY(s.pos)) bad.push("its position is not a pair of numbers");
  if (!uvXY(s.vel)) bad.push("its velocity is not a pair of numbers");
  if (!uvNum(s.angle)) bad.push("its angle is not a number");
  if (!uvNum(s.angVel)) bad.push("its spin is not a number");
  if (!s.fuel || typeof s.fuel !== "object" || Array.isArray(s.fuel)) bad.push("its fuel list is missing");
  else for (const k in s.fuel) if (!uvNum(s.fuel[k]) || s.fuel[k] < 0) bad.push("the fuel in " + k + " is not a number of kg (0 or more)");
  if (!Number.isInteger(s.stageNext) || s.stageNext < 0) bad.push("its next stage is not a whole number");
  if (s.activeEngines !== undefined && !uvIds(s.activeEngines)) bad.push("its list of lit engines is not a list of part ids");
  if (s.detached !== undefined && !uvIds(s.detached)) bad.push("its list of detached parts is not a list of part ids");
  if (s.throttle !== undefined && !(uvNum(s.throttle) && s.throttle >= 0 && s.throttle <= 1)) bad.push("its throttle is not between 0 and 1");
  return bad;
}

/* What is wrong with the SHAPE of a universe (empty = fine). These are the problems that make a universe unusable: it is not saved
   and not loaded. Whether each design still passes today's rules is a separate, softer question: see universeDesignWarnings. */
function universeProblems(u) {
  const bad = [];
  if (!u || typeof u !== "object" || !Array.isArray(u.vessels)) return ["that is not a universe"];
  if (!Number.isInteger(u.version) || u.version < 1) bad.push("the version is not a whole number");
  if (!uvNum(u.clock) || u.clock < 0) bad.push("the clock is not a time in seconds (0 or more)");
  if (!Number.isInteger(u.nextId) || u.nextId < 1) bad.push("the next id is not a whole number");
  const seen = {};
  let maxId = 0, pad = 0;
  for (const v of u.vessels) {
    const at = (v && v.id) || "a vessel";
    if (!v || typeof v.id !== "string" || !/^v\d+$/.test(v.id)) { bad.push("a vessel has no proper id"); continue; }
    if (seen[v.id]) bad.push(v.id + ": id used twice");
    seen[v.id] = true;
    maxId = Math.max(maxId, parseInt(v.id.slice(1), 10));
    if (typeof v.name !== "string") bad.push(at + ": it has no name");
    if (VESSEL_STATUS.indexOf(v.status) < 0) bad.push(at + ": status " + JSON.stringify(v.status) + " is not one of " + VESSEL_STATUS.join(", "));
    if (!v.design || typeof v.design !== "object" || !Array.isArray(v.design.parts)) bad.push(at + ": it has no design");
    if (v.revert !== undefined && typeof v.revert !== "boolean") bad.push(at + ": its revert flag is not true or false");
    if (v.status === "pad") pad++;
    if (v.status !== "pad" && VESSEL_STATUS.indexOf(v.status) >= 0 && v.state === null) bad.push(at + ": it is " + v.status + " but has no state");
    if (v.state !== null && v.state !== undefined) for (const m of vesselStateProblems(v.state)) bad.push(at + ": " + m);
  }
  if (Number.isInteger(u.nextId) && u.nextId <= maxId) bad.push("the next id (" + u.nextId + ") is not above the highest vessel id (v" + maxId + ")");
  if (pad > 1) bad.push("more than one vessel is on the pad");
  if (u.activeId !== null && !seen[u.activeId]) bad.push("the active vessel " + u.activeId + " does not exist");
  return bad;
}

/* Vessels whose design would not pass today's rules (rules.js numbers get tuned, so an old save can hold one).
   They are kept, never thrown away: this only lists them. Returns [{ id, name, problems }]. */
function universeDesignWarnings(u) {
  const out = [];
  for (const v of u.vessels) {
    let p;
    try { p = validateDesign(v.design); } catch (e) { p = ["the design could not be checked: " + e.message]; }
    if (p.length) out.push({ id: v.id, name: v.name, problems: p });
  }
  return out;
}

/* ---- saving as text ---- */
function universeChecksum(s) {         // FNV-1a over the text: catches a save that was cut short or damaged
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

function universeToText(u, saveCount) {
  const body = JSON.stringify(u);
  return JSON.stringify({ format: UNIVERSE_FORMAT, version: u.version, saveCount: saveCount || 0, savedAt: Date.now(), check: universeChecksum(body), body: body });
}

/* Read a save. Returns { universe, problems, saveCount, migrated }: universe is null when it cannot be used (and problems says why). */
function universeFromText(text) {
  const fail = function (msg) { return { universe: null, problems: [msg], saveCount: 0, migrated: false }; };
  let env, u;
  try { env = JSON.parse(text); } catch (e) { return fail("the save does not read (cut short or damaged)"); }
  if (!env || env.format !== UNIVERSE_FORMAT || typeof env.body !== "string") return fail("that is not a universe save");
  if (universeChecksum(env.body) !== env.check) return fail("the save is damaged (its checksum does not match)");
  try { u = JSON.parse(env.body); } catch (e) { return fail("the save does not read (cut short or damaged)"); }
  if (!u || !Number.isInteger(u.version)) return fail("the save has no version");
  if (u.version > UNIVERSE_VERSION) return fail("the save is from a newer version of the game (version " + u.version + ", this one knows up to " + UNIVERSE_VERSION + ")");
  let migrated = false;
  while (u.version < UNIVERSE_VERSION) {
    const step = UNIVERSE_MIGRATIONS[u.version];
    if (typeof step !== "function") return fail("the save is version " + u.version + " and there is no way to bring it up to date");
    const from = u.version;
    try { u = step(u); } catch (e) { return fail("bringing the save up from version " + from + " failed: " + e.message); }
    u.version = from + 1;
    migrated = true;
  }
  const bad = universeProblems(u);
  if (bad.length) return { universe: null, problems: bad, saveCount: 0, migrated: migrated };
  return { universe: u, problems: [], saveCount: env.saveCount || 0, migrated: migrated };
}

/* ---- keeping it in the browser ---- */
function universeStorage() {           // the browser's storage, or null if there is none or it is blocked
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
}

/* Save. `store` is for the tests; leave it out to use the browser's. Returns { ok, problem, saveCount }.
   A universe with a broken shape is refused, so a bug can never overwrite a good save with garbage. */
function universeSave(u, store) {
  const s = store === undefined ? universeStorage() : store;
  if (!s) return { ok: false, problem: "this browser does not let the game keep saves", saveCount: 0 };
  const bad = universeProblems(u);
  if (bad.length) return { ok: false, problem: "not saved: the universe is broken (" + bad[0] + ")", saveCount: 0 };
  const n = universeLoad(s).saveCount + 1, text = universeToText(u, n);
  try {
    s.setItem(UNIVERSE_KEY + ".next", text);                       // 1. the new save, in its own slot: the old one is untouched so far
    const old = s.getItem(UNIVERSE_KEY);
    if (old && universeFromText(old).universe) s.setItem(UNIVERSE_KEY + ".prev", old);   // 2. keep the old save, but only if it was a good one
    s.setItem(UNIVERSE_KEY, text);                                 // 3. the main slot
    s.removeItem(UNIVERSE_KEY + ".next");                          // 4. done
  } catch (e) {
    return { ok: false, problem: "could not save: " + e.message, saveCount: 0 };   // (if step 3 did not happen, ".next" still holds the new save and the next load finds it)
  }
  return { ok: true, problem: null, saveCount: n };
}

/* Load the newest save that checks out. Returns { universe, status, problems, warnings, saveCount }:
     status "none"        nothing has been saved (universe is null: start a new one)
            "ok"          the main save was fine
            "recovered"   the main save was missing or bad and an interrupted save or the backup was used (problems says what was wrong)
            "unreadable"  something is saved but none of it can be used (universe is null; do NOT overwrite it without asking)
     warnings             designs that no longer pass the rules (universeDesignWarnings) */
function universeLoad(store) {
  const s = store === undefined ? universeStorage() : store;
  const none = { universe: null, status: "none", problems: [], warnings: [], saveCount: 0 };
  if (!s) return none;
  const slots = [["main", ""], ["next", ".next"], ["prev", ".prev"]], good = {}, problems = [];
  let found = false;
  for (const sl of slots) {
    let text = null;
    try { text = s.getItem(UNIVERSE_KEY + sl[1]); } catch (e) { text = null; }
    if (!text) continue;
    found = true;
    const r = universeFromText(text);
    if (r.universe) good[sl[0]] = r; else problems.push(sl[0] + " slot: " + r.problems[0]);
  }
  if (!found) return none;
  let pick = null;
  for (const name of ["main", "next"]) if (good[name] && (!pick || good[name].saveCount > good[pick].saveCount)) pick = name;   // main wins a tie
  if (!pick && good.prev) pick = "prev";
  if (!pick) return { universe: null, status: "unreadable", problems: problems, warnings: [], saveCount: 0 };
  const r = good[pick], clean = pick === "main" && problems.length === 0;
  return { universe: r.universe, status: clean ? "ok" : "recovered", problems: problems, warnings: universeDesignWarnings(r.universe), saveCount: r.saveCount };
}

function universeErase(store) {        // forget everything (a new game)
  const s = store === undefined ? universeStorage() : store;
  if (!s) return false;
  try { for (const k of ["", ".next", ".prev"]) s.removeItem(UNIVERSE_KEY + k); return true; } catch (e) { return false; }
}
