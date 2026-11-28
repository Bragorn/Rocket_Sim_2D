/* =====================================================================
   SESSION TESTS  (tests/session-tests.js)
   The one-window-at-a-time guard (js/session.js). Each "tab" is a separate copy of the game's files with its own
   tab storage; all tabs share one stand-in for the browser's localStorage and a clock the test moves by hand.
   Needs Node.js. From the project folder:   node tests/session-tests.js
   ===================================================================== */
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const planck = require("./fake-planck");

let failures = 0;
function check(ok, text) { console.log((ok ? "  PASS  " : "  FAIL  ") + text); if (!ok) failures++; }
function fakeStore() { const data = {}; return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } }; }

/* a page's overlay needs a little fake page to be built in */
function fakeDocument() {
  const made = [];
  const mk = (tag) => { const e = { tag, style: {}, children: [], listeners: {}, textContent: "", appendChild(c) { this.children.push(c); return c; }, addEventListener(n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); } }; made.push(e); return e; };
  return { made, body: mk("body"), createElement: mk };
}
function newTab(shared, tabStore) {
  const doc = fakeDocument(), reloads = { n: 0 };
  const ctx = { console, Math, Object, Array, Number, JSON, Date, Error, isFinite, parseInt, String, encodeURIComponent, decodeURIComponent, document: doc, window: { addEventListener() {} }, location: { reload() { reloads.n++; } }, planck };
  vm.createContext(ctx);
  for (const f of ["util", "settings", "rules", "parts", "design", "session", "universe"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  const t = { ctx, doc, reloads, run: (e) => vm.runInContext(e, ctx) };
  t.start = (now) => ctx.sessionStart({ shared, tab: tabStore }, now);
  t.overlayShown = () => doc.made.some((e) => e.tag === "div" && e.style.display === "flex");
  t.button = (label) => doc.made.find((e) => e.tag === "button" && e.textContent === label);
  return t;
}

console.log("\nOne window at a time");
let shared = fakeStore();
const tabA = fakeStore(), tabB = fakeStore();
let A = newTab(shared, tabA);
check(A.start(1000) === true && !A.run("sessionBlocked") && A.run("sessionAllowsSave()"), "the first window claims the game");
check(JSON.parse(shared.data["rocketsim.session"]).beat === 1000 && JSON.parse(shared.data["rocketsim.session"]).tab === A.run("sessionTab"), "its heartbeat is written to the shared storage, with its tab's id");
check(!A.overlayShown(), "and no message is shown");

let B = newTab(shared, tabB);
check(B.start(1500) === false && B.run("sessionBlocked") && !B.run("sessionAllowsSave()"), "a second window opened while the first is running is blocked");
check(B.overlayShown() && /already open in another tab or window/.test(B.doc.made.find((e) => e.msg).msg.textContent), "and shows the message");
check(JSON.parse(shared.data["rocketsim.session"]).tab === A.run("sessionTab"), "and does not take the claim from the first");

/* the data layer refuses to save from a blocked window */
const uni = B.run("universeNew()");
check(B.run("universeSave")(uni).ok === false && /another window/.test(B.run("universeSave")(uni).problem), "a blocked window cannot save the universe (universe.js asks session.js)");
check(B.run("universeErase")() === false, "or erase it");
check(A.run("universeSave")(A.run("universeNew()"), fakeStore()).ok, "(saving to an explicit test store is not affected, as before)");

/* heartbeats */
A.ctx.sessionBeat(2500);
check(JSON.parse(shared.data["rocketsim.session"]).beat === 2500, "the running window keeps its claim fresh with a heartbeat each second");
B.ctx.sessionBeat(3500);
check(B.run("sessionBlocked"), "a blocked window stays blocked when it beats: it waits for the player to choose");

/* check again: only works once the other is gone */
check(B.ctx.sessionCheckAgain(3600) === false && B.run("sessionBlocked"), "Check again while the first window is alive: still blocked");
check(B.ctx.sessionCheckAgain(2500 + 4000 + 1) === true && !B.run("sessionBlocked") && !B.overlayShown(), "Check again after the first window has gone quiet for 4 seconds: this window carries on, message gone");
check(JSON.parse(shared.data["rocketsim.session"]).tab === B.run("sessionTab"), "and now holds the claim");

/* take over */
A.ctx.sessionBeat(7000);
check(A.run("sessionBlocked") && /taken over/.test(A.doc.made.filter((e) => e.msg).map((e) => e.msg.textContent).join("")), "the first window notices the claim is no longer its own and blocks itself, saying it was taken over");
A.ctx.sessionTakeOver(7100);
check(!A.run("sessionBlocked") && JSON.parse(shared.data["rocketsim.session"]).tab === A.run("sessionTab"), "Use this window takes the claim back");
B.ctx.sessionBeat(8200);
check(B.run("sessionBlocked"), "and the other window blocks itself in turn");
const useBtn = B.button("Use this window");
useBtn.listeners.click.forEach((f) => f());
check(B.reloads.n === 1 && !B.run("sessionBlocked"), "the Use this window button takes over and reloads the page (what it held may be out of date)");

/* the builder and the flight are two pages in one tab: not a clash */
shared = fakeStore();
const tabC = fakeStore();
const flightPage = newTab(shared, tabC); flightPage.start(1000);
const builderPage = newTab(shared, tabC);
check(builderPage.start(1200) === true && !builderPage.run("sessionBlocked"), "a second page in the same tab (the flight, then the builder) is not blocked: it is the same tab");
shared = fakeStore(); const p1 = newTab(shared, fakeStore()); p1.start(1000);
p1.ctx.sessionRelease();
check(!("rocketsim.session" in shared.data) && newTab(shared, fakeStore()).start(1100) === true, "a window that is closed lets go at once: the next one can start immediately");
const blockedB = newTab(shared, fakeStore()); shared.data["rocketsim.session"] = JSON.stringify({ tab: "someone-else", beat: 1000 }); 
check(blockedB.start(1500) === false, "(a claim by someone else is respected)");
blockedB.ctx.sessionRelease();
check(JSON.parse(shared.data["rocketsim.session"]).tab === "someone-else", "a blocked window closing does not remove the claim of the window that has the game");
shared = fakeStore(); const crashed = newTab(shared, fakeStore()); crashed.start(1000);
check(newTab(shared, fakeStore()).start(1000 + 3000) === false && newTab(shared, fakeStore()).start(1000 + 4001) === true, "a window that crashed (never let go) is forgotten after 4 seconds");

/* no storage at all */
const none = newTab(null, null);
check(none.ctx.sessionStart(undefined, 1000) === true && none.run("sessionAllowsSave()"), "a browser with no usable storage: nothing to clash over, so the window runs");

console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
