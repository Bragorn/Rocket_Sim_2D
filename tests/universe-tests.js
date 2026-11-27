/* =====================================================================
   UNIVERSE TESTS  (tests/universe-tests.js)
   Runs the real game files without a browser. The browser's storage is replaced by a small
   stand-in that can be told to fail, so interrupted and broken saves can be tried on purpose.
   Needs Node.js. From the project folder:   node tests/universe-tests.js

   1. A new universe and the vessels in it.
   2. The pad rule: one vessel on the pad, and how it gets cleared.
   3. Checking the shape of a universe (what is refused, and the softer design warnings).
   4. Saving as text: checksum, versions and migrations.
   5. Keeping it in storage: save, load, interrupted saves, damage, a full or blocked browser.
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");

const planck = require("./fake-planck");   // the shared stand-in for the physics engine (design.js builds a rocket when it loads)
const ctx = { console, Math, Object, Array, Number, JSON, Date, Error, isFinite, parseInt, String, encodeURIComponent, decodeURIComponent, document: { body: {} }, window: { addEventListener() {} }, planck };
vm.createContext(ctx);
for (const f of ["util", "settings", "rules", "parts", "design", "universe"]) {
  let src = fs.readFileSync(path.join(root, "js", f + ".js"), "utf8");
  if (f === "settings") src = src.replace("const MAX_VESSELS = 200;", "const MAX_VESSELS = 4;");     // a small limit, so it can be reached in a test
  vm.runInContext(src, ctx, { filename: f + ".js" });
}
const run = (e) => vm.runInContext(e, ctx);
ctx.log = () => {};
let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
const clone = (o) => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DESIGN = run("DESIGN");
const fn = (name) => run(name);
const addVessel = fn("universeAddVessel"), removeVessel = fn("universeRemoveVessel"), setActive = fn("universeSetActive"), updateVessel = fn("universeUpdateVessel");
const problemsOf = fn("universeProblems"), toText = fn("universeToText"), fromText = fn("universeFromText");
const save = fn("universeSave"), load = fn("universeLoad"), erase = fn("universeErase");
const KEY = run("UNIVERSE_KEY");

/* a stand-in for localStorage. failOn(n): the n-th write from now throws (like a full disk or a closed tab) */
function fakeStore() {
  const data = {}; let writes = 0, failAt = 0;
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { writes++; if (failAt && writes === failAt) { failAt = 0; throw new Error("storage full"); } data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    failOn: (n) => { writes = 0; failAt = n; }
  };
}
const stateOf = (extra) => Object.assign({ pos: { x: 0, y: 700000 }, vel: { x: 7500, y: 0 }, angle: 1.5, angVel: 0, fuel: { tank: 1234.5 }, stageNext: 1, activeEngines: ["engine"], detached: [], throttle: 0 }, extra);
/* a universe with one vessel in orbit and one on the pad */
function twoVessels() {
  let u = fn("universeNew")();
  u = addVessel(u, DESIGN, "Alpha").universe;
  u = updateVessel(u, "v1", { status: "orbit", state: stateOf() }).universe;
  u = addVessel(u, DESIGN, "Beta").universe;
  return u;
}

/* ---- 1. a new universe and the vessels in it ---- */
console.log("\n1. A new universe and the vessels in it");
const u0 = fn("universeNew")();
check(u0.version === run("UNIVERSE_VERSION") && u0.clock === 0 && u0.nextId === 1 && u0.activeId === null && u0.vessels.length === 0, "a new universe is empty, at time 0, with no active vessel");
check(problemsOf(u0).length === 0, "a new universe passes the shape check");
const a1 = addVessel(u0, DESIGN, "Alpha");
check(a1.id === "v1" && a1.problem === null && a1.universe.vessels.length === 1, "adding a rocket gives it the id v1");
const v1 = a1.universe.vessels[0];
check(v1.name === "Alpha" && v1.status === "pad" && v1.state === null, "it stands on the pad with no flight state yet");
check(a1.universe.activeId === "v1", "the new vessel becomes the active one");
check(same(v1.design, DESIGN) && v1.design !== DESIGN, "it keeps a copy of the whole design");
check(u0.vessels.length === 0 && u0.nextId === 1 && u0.activeId === null, "the universe it was added to is not changed (every change returns a new one)");
check(addVessel(u0, DESIGN).universe.vessels[0].name === DESIGN.name, "with no name given it takes the design's name");
const bad = addVessel(u0, { version: 1, name: "x", parts: [] });
check(bad.id === null && /cannot be launched/.test(bad.problem) && bad.universe === u0, "a design that cannot be launched is refused, and the universe is returned as it was");
check(problemsOf(twoVessels()).length === 0, "a universe with an orbiting vessel and a vessel on the pad passes the shape check");
let u = twoVessels();
check(u.vessels.map((v) => v.id).join() === "v1,v2" && u.nextId === 3 && u.activeId === "v2", "ids count up, and the newest vessel is active");
u = setActive(u, "v1").universe;
check(u.activeId === "v1", "switching the active vessel works");
check(setActive(u, "v9").problem !== null && setActive(u, "v9").universe === u, "switching to a vessel that does not exist is refused");
check(setActive(u, null).universe.activeId === null, "no vessel active is allowed");
let r = updateVessel(u, "v1", { id: "v7", design: { parts: [] }, name: "Renamed", status: "landed", state: stateOf({ vel: { x: 0, y: 0 } }) });
const w1 = r.universe.vessels[0];
check(w1.id === "v1" && same(w1.design, DESIGN) && w1.name === "Renamed" && w1.status === "landed" && w1.state.vel.x === 0, "update changes name, status and state, and ignores an attempt to change the id or the design");
check(updateVessel(u, "v9", { name: "x" }).problem !== null, "updating a vessel that does not exist is refused");
const un = removeVessel(u, "v1").universe;
check(un.vessels.length === 1 && un.activeId === null, "removing the active vessel leaves no vessel active");
check(removeVessel(un, "v2").universe.nextId === 3, "ids are never reused: nextId stays where it was");
check(removeVessel(u, "v9").problem !== null, "removing a vessel that does not exist is refused");
check(fn("universeAdvance")(u, 90.5).clock === 90.5 && u.clock === 0, "the clock moves on and the old universe is untouched");
check(fn("universeAdvance")(u, -5) === u && fn("universeAdvance")(u, NaN) === u, "a negative or broken time step changes nothing");

/* ---- 2. the pad rule ---- */
console.log("\n2. The pad rule");
u = twoVessels();
check(fn("padOccupant")(u).id === "v2" && !fn("padIsClear")(u), "the vessel with status pad is the one on the pad");
const second = addVessel(u, DESIGN, "Gamma");
check(second.id === null && /pad is not clear/.test(second.problem) && /Beta/.test(second.problem) && second.universe === u, "a new rocket cannot be loaded while another is on the pad, and the message says which");
u = removeVessel(u, "v2").universe;
check(fn("padIsClear")(u) && addVessel(u, DESIGN, "Gamma").id === "v3", "recovering the rocket on the pad clears it: a new one can go on");
u = twoVessels();
u = updateVessel(u, "v2", { status: "landed", state: stateOf({ pos: { x: 0, y: 600005 }, vel: { x: 0, y: 0 } }) }).universe;
check(fn("padIsClear")(u) && addVessel(u, DESIGN, "Gamma").id === "v3", "flying the rocket off the pad and putting it down elsewhere clears the pad");
u = twoVessels();
u = updateVessel(u, "v2", { status: "flying", state: stateOf({ pos: { x: 0, y: 600100 }, vel: { x: 0, y: 40 } }) }).universe;
const midair = addVessel(u, DESIGN, "Gamma");
check(fn("padIsClear")(u) && midair.id === null && /Beta was left mid-flight/.test(midair.problem) && midair.universe === u, "off the pad but still mid-flight: no new launch until it is brought down, into orbit, or scrapped");
u = twoVessels();
u.vessels.push(Object.assign(clone(u.vessels[0]), { id: "v3", status: "pad", state: null })); u.nextId = 4;
check(problemsOf(u).some((m) => /more than one vessel is on the pad/.test(m)), "a universe with two vessels on the pad fails the shape check");

/* ---- the limits on launching ---- */
console.log("\n2b. Launch limits and the revert flag");
u = fn("universeNew")();
check(addVessel(u, DESIGN, "A").universe.vessels[0].revert === true, "a newly launched vessel can be reverted");
check(updateVessel(addVessel(u, DESIGN, "A").universe, "v1", { revert: false }).universe.vessels[0].revert === false, "the revert flag can be switched off (when the vessel is left)");
check(mut0(function (x) { x.vessels[0].revert = "yes"; }).some((m) => /revert flag/.test(m)), "a revert flag that is not true or false: refused");
check(mut0(function (x) { delete x.vessels[0].revert; }).length === 0, "a vessel with no revert flag (an older save) is fine");
const noBlock = fn("universeLaunchBlock");
check(noBlock(fn("universeNew")()) === null, "an empty universe: nothing blocks a launch");
u = fn("universeNew")();
for (let i = 0; i < 4; i++) { const a = addVessel(u, DESIGN, "R" + i); u = updateVessel(a.universe, a.id, { status: "landed", state: stateOf({ pos: { x: 100 * i, y: 600000 } }) }).universe; }
const full = addVessel(u, DESIGN, "Extra");
check(u.vessels.length === 4 && full.id === null && /full \(4 vessels\)/.test(full.problem) && full.universe === u, "at the vessel limit (4 here) a new launch is refused and the message says so");
check(addVessel(removeVessel(u, "v1").universe, DESIGN, "Extra").id === "v5", "scrapping one makes room");
function mut0(f) { const x = twoVessels(); f(x); return problemsOf(x); }

/* ---- 3. checking the shape of a universe ---- */
console.log("\n3. Checking the shape of a universe");
const mut = (f) => { const x = twoVessels(); f(x); return problemsOf(x); };
check(mut((x) => { x.vessels[1].id = "v1"; }).some((m) => /used twice/.test(m)), "two vessels with the same id: refused");
check(mut((x) => { x.vessels[0].id = "rocket"; }).some((m) => /no proper id/.test(m)), "an id that is not v and a number: refused");
check(mut((x) => { x.nextId = 2; }).some((m) => /next id/.test(m)), "a next id that is not above the highest vessel id: refused");
check(mut((x) => { x.activeId = "v9"; }).some((m) => /does not exist/.test(m)), "an active vessel that does not exist: refused");
check(mut((x) => { x.vessels[0].status = "docked"; }).some((m) => /status/.test(m)), "an unknown status: refused");
check(mut((x) => { x.vessels[0].state = null; }).some((m) => /orbit but has no state/.test(m)), "an orbiting vessel with no state: refused (it could not be put back)");
check(mut((x) => { x.vessels[0].state.pos.x = NaN; }).some((m) => /position/.test(m)), "a position that is not a number: refused");
check(mut((x) => { x.vessels[0].state.fuel.tank = -1; }).some((m) => /fuel in tank/.test(m)), "negative fuel: refused");
check(mut((x) => { x.vessels[0].state.stageNext = 1.5; }).some((m) => /next stage/.test(m)), "half a stage: refused");
check(mut((x) => { x.vessels[0].state.throttle = 2; }).some((m) => /throttle/.test(m)), "a throttle above 1: refused");
check(mut((x) => { x.clock = -1; }).some((m) => /clock/.test(m)), "a negative clock: refused");
check(mut((x) => { delete x.vessels[0].design; }).some((m) => /no design/.test(m)), "a vessel with no design: refused");
check(problemsOf(null).length > 0 && problemsOf({}).length > 0, "things that are not universes: refused");
check(mut((x) => { x.vessels[0].state.somethingNew = [1, 2]; }).length === 0, "extra fields in a state are allowed (a later version can add some)");
const old = twoVessels(); old.vessels[0].design.parts[0].width = 3;     // 3 m is not a tank width any more, as if rules.js had been tuned
check(problemsOf(old).length === 0 && fn("universeDesignWarnings")(old).length === 1 && fn("universeDesignWarnings")(old)[0].id === "v1", "a design that no longer passes the rules is only a warning: the universe is still valid");
check(fn("universeDesignWarnings")(twoVessels()).length === 0, "good designs give no warnings");

/* ---- 4. saving as text ---- */
console.log("\n4. Saving as text");
u = twoVessels(); u = fn("universeAdvance")(u, 1234.5678);
const text = toText(u, 7);
let back = fromText(text);
check(back.universe && same(back.universe, u) && back.saveCount === 7 && !back.migrated, "a universe survives being written and read back exactly");
check(back.universe.vessels[0].state.fuel.tank === 1234.5 && back.universe.clock === 1234.5678, "decimals come back exactly");
check(fromText(text.slice(0, text.length - 20)).universe === null && /cut short/.test(fromText(text.slice(0, text.length - 20)).problems[0]), "a save that was cut short is refused");
const env = JSON.parse(text), tampered = JSON.stringify(Object.assign({}, env, { body: env.body.replace("Alpha", "Alpho") }));
check(fromText(tampered).universe === null && /checksum/.test(fromText(tampered).problems[0]), "a save that was changed after it was written fails its checksum");
check(fromText("hello").universe === null && fromText(JSON.stringify({ a: 1 })).universe === null && fromText("").universe === null, "text that is not a save is refused");
const newer = (() => { const x = clone(u); x.version = run("UNIVERSE_VERSION") + 1; const body = JSON.stringify(x); return JSON.stringify({ format: run("UNIVERSE_FORMAT"), version: x.version, saveCount: 1, check: run("universeChecksum")(body), body }); })();
check(fromText(newer).universe === null && /newer version/.test(fromText(newer).problems[0]), "a save from a newer version of the game is refused (never overwritten by an old copy)");
const oldSave = (v, mutate) => { const x = clone(u); x.version = v; if (mutate) mutate(x); const body = JSON.stringify(x); return JSON.stringify({ format: run("UNIVERSE_FORMAT"), version: v, saveCount: 3, check: run("universeChecksum")(body), body }); };
check(/no way to bring it up to date/.test(fromText(oldSave(0)).problems[0] || ""), "an older save with no migration written for it is refused, with a reason");
const migrations = run("UNIVERSE_MIGRATIONS");
migrations[0] = (d) => { d.clock = d.oldClock; delete d.oldClock; return d; };       // pretend version 0 called the clock oldClock
back = fromText(oldSave(0, (x) => { x.oldClock = 42; delete x.clock; }));
check(back.universe && back.universe.clock === 42 && back.universe.version === run("UNIVERSE_VERSION") && back.migrated, "an older save is brought up to date by its migration, and marked as migrated");
migrations[0] = () => { throw new Error("boom"); };
check(fromText(oldSave(0)).universe === null && /failed/.test(fromText(oldSave(0)).problems[0]), "a migration that fails refuses the save instead of loading half of it");
delete migrations[0];

/* ---- 5. keeping it in storage ---- */
console.log("\n5. Keeping it in storage");
let st = fakeStore();
check(load(st).status === "none" && load(st).universe === null, "nothing saved yet: status none");
u = twoVessels();
let sv = save(u, st);
check(sv.ok && sv.saveCount === 1 && st.data[KEY] && !st.data[KEY + ".next"] && !st.data[KEY + ".prev"], "the first save fills the main slot and leaves no save-in-progress behind");
let ld = load(st);
check(ld.status === "ok" && same(ld.universe, u) && ld.saveCount === 1 && ld.problems.length === 0, "loading gives the same universe back, status ok");
const u2 = fn("universeAdvance")(u, 60);
sv = save(u2, st);
check(sv.saveCount === 2 && st.data[KEY + ".prev"] && same(fromText(st.data[KEY + ".prev"]).universe, u) && same(load(st).universe, u2), "the second save keeps the first as the backup and becomes the main one");
st.data[KEY] = st.data[KEY].slice(0, 100);                                            // damage the main slot
ld = load(st);
check(ld.status === "recovered" && same(ld.universe, u) && ld.problems.some((m) => /main slot/.test(m)), "a damaged main save: the backup is used and the player can be told");
st = fakeStore(); save(u, st);
st.failOn(3);                                                                         // the write to the main slot fails (storage full or tab closed)
sv = save(u2, st);
check(!sv.ok && /could not save/.test(sv.problem), "a failed write is reported");
ld = load(st);
check(ld.status === "recovered" && same(ld.universe, u2), "if the save stopped before the main slot was written, the finished new save in the .next slot is found and used");
st = fakeStore(); save(u, st);
st.failOn(1);                                                                         // even writing the .next slot fails
sv = save(u2, st);
check(!sv.ok && load(st).status === "ok" && same(load(st).universe, u), "if the very first write fails the old save is untouched");
st = fakeStore(); save(u, st);
st.data[KEY + ".next"] = toText(u2, 2).slice(0, 80);                                  // a half-written save-in-progress
ld = load(st);
check(same(ld.universe, u) && ld.status === "recovered", "a half-written .next slot is ignored: the good main save is used");
st = fakeStore(); save(u, st); save(u2, st);
st.data[KEY] = "garbage"; st.data[KEY + ".prev"] = "garbage";
ld = load(st);
check(ld.status === "unreadable" && ld.universe === null && ld.problems.length === 2, "everything damaged: status unreadable, with the reasons, and nothing thrown away");
check(Object.keys(st.data).length === 2, "...and loading never deletes anything from storage");
st = fakeStore(); save(u, st);
const broken = clone(u); broken.activeId = "v9";
check(!save(broken, st).ok && /broken/.test(save(broken, st).problem) && same(load(st).universe, u), "a universe with a broken shape is not saved, so it cannot overwrite a good save");
st = fakeStore(); save(old, st);
ld = load(st);
check(ld.status === "ok" && ld.universe.vessels.length === 2 && ld.warnings.length === 1 && ld.warnings[0].id === "v1", "a save holding a design that fails today's rules still loads, with a warning");
st = fakeStore(); save(u, st); save(u2, st); save(u2, st);
check(load(st).saveCount === 3 && erase(st) && load(st).status === "none" && Object.keys(st.data).length === 0, "save numbers count up, and erase forgets all three slots");
check(!save(u, null).ok && load(null).status === "none" && erase(null) === false, "a browser with no usable storage: saving says no, loading finds nothing, nothing throws");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
