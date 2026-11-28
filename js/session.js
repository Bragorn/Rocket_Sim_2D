"use strict";

/* =====================================================================
   SESSION  (js/session.js)
   Only one browser window or tab should use the saved universe at a time: two of them would keep overwriting each other's saves.
   Every window writes a heartbeat ("this tab is using the game, as of now") into the browser's storage, and looks for one from
   another tab before it starts. If it finds one, this window is BLOCKED: it shows a message, does not run, and universe.js
   refuses to save from it (sessionAllowsSave). The message offers to use this window instead, which takes over; the other
   window then notices and blocks itself in turn.
   The builder and the flight are two pages but one tab: each tab has an id kept for the tab (sessionStorage), so going from one
   page to the other is never a clash. A closed tab lets go at once; a crashed one is forgotten after SESSION_STALE ms.
   ===================================================================== */

const SESSION_KEY = "rocketsim.session";
const SESSION_TAB_KEY = "rocketsim.tab";
const SESSION_BEAT = 1000;          // ms between heartbeats
const SESSION_STALE = 4000;         // ms without one before a window is taken to be gone

let sessionTab = null;              // this tab's id
let sessionBlocked = false;         // true: another window is using the game (or has taken over from this one)
let sessionWhy = "";                // what the overlay says
let sessionStores = null;           // { shared, tab } (the browser's, or stand-ins in the tests)

function sessionAllowsSave() { return !sessionBlocked; }

function sessionNow() { return Date.now(); }

function sessionRead() {            // the heartbeat in storage, or null
  try { const t = sessionStores.shared.getItem(SESSION_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
function sessionWrite(now) {
  try { sessionStores.shared.setItem(SESSION_KEY, JSON.stringify({ tab: sessionTab, beat: now })); } catch (e) { /* storage full or blocked: nothing to protect */ }
}
function sessionOther(now) {        // is a different tab using the game right now?
  const r = sessionRead();
  return !!r && r.tab !== sessionTab && now - r.beat < SESSION_STALE;
}

/* Start: pick this tab's id, and claim the game or find it taken. Returns true if this window may run.
   `stores` ({ shared, tab }) is for the tests; leave it out to use the browser's localStorage and sessionStorage. */
function sessionStart(stores, now) {
  if (stores) sessionStores = stores;
  else {
    try { sessionStores = { shared: localStorage, tab: sessionStorage }; } catch (e) { sessionStores = null; }
  }
  if (!sessionStores) { sessionBlocked = false; return true; }          // no storage at all: nothing can be saved, so nothing can clash
  const t = now === undefined ? sessionNow() : now;
  try { sessionTab = sessionStores.tab.getItem(SESSION_TAB_KEY); } catch (e) { sessionTab = null; }
  if (!sessionTab) {
    sessionTab = Math.random().toString(36).slice(2) + t.toString(36);
    try { sessionStores.tab.setItem(SESSION_TAB_KEY, sessionTab); } catch (e) { /* the id then lasts only for this page */ }
  }
  if (sessionOther(t)) { sessionBlocked = true; sessionWhy = "The game is already open in another tab or window."; }
  else { sessionBlocked = false; sessionWrite(t); }
  sessionShow();
  return !sessionBlocked;
}

/* Every SESSION_BEAT ms: keep the claim fresh, notice a takeover, and notice that a blocking window has gone. */
function sessionBeat(now) {
  if (!sessionStores) return;
  const t = now === undefined ? sessionNow() : now;
  if (sessionBlocked) return;                                           // a blocked window stays blocked until the player chooses (Check again / Use this window)
  if (sessionOther(t)) { sessionBlocked = true; sessionWhy = "The game was opened in another tab or window, which has taken over from this one."; sessionShow(); return; }
  sessionWrite(t);
}

function sessionTakeOver(now) {     // "Use this window": claim the game here. The page then reloads, since what it holds may be out of date.
  if (!sessionStores) return;
  sessionBlocked = false; sessionWrite(now === undefined ? sessionNow() : now); sessionShow();
}
function sessionCheckAgain(now) {   // "Check again": if the other window has gone, carry on here
  const t = now === undefined ? sessionNow() : now;
  if (!sessionOther(t)) { sessionBlocked = false; sessionWrite(t); }
  sessionShow();
  return !sessionBlocked;
}
function sessionRelease() {         // this page is going away: let go, unless this tab has already handed the game over
  if (!sessionStores || sessionBlocked) return;
  const r = sessionRead();
  if (r && r.tab === sessionTab) { try { sessionStores.shared.removeItem(SESSION_KEY); } catch (e) { /* nothing to do */ } }
}

/* ---- the message ---- */
let sessionOverlay = null;
function sessionShow() {
  if (typeof document === "undefined" || !document.body || typeof document.createElement !== "function") return;
  if (!sessionBlocked) { if (sessionOverlay) sessionOverlay.style.display = "none"; return; }
  if (!sessionOverlay) {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:rgba(5,7,10,0.94);color:#e8eef2;font:15px sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;";
    const msg = document.createElement("div"); msg.style.cssText = "max-width:460px;line-height:1.4;";
    const sub = document.createElement("div"); sub.style.cssText = "max-width:460px;opacity:0.7;font-size:13px;line-height:1.4;";
    sub.textContent = "Two windows saving at once would overwrite each other's game. Close the other one, or use this one instead.";
    const row = document.createElement("div"); row.style.cssText = "display:flex;gap:10px;";
    const mk = function (label, fn) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.style.cssText = "font:14px sans-serif;padding:8px 14px;cursor:pointer;"; b.addEventListener("click", fn); return b; };
    row.appendChild(mk("Check again", function () { if (sessionCheckAgain()) location.reload(); }));
    row.appendChild(mk("Use this window", function () { sessionTakeOver(); location.reload(); }));
    box.appendChild(msg); box.appendChild(sub); box.appendChild(row);
    document.body.appendChild(box);
    sessionOverlay = box; sessionOverlay.msg = msg;
  }
  sessionOverlay.msg.textContent = sessionWhy;
  sessionOverlay.style.display = "flex";
}

/* A page calls this once: start, keep the heartbeat, and let go when the page goes. Returns true if this window may run. */
function sessionInstall() {
  const ok = sessionStart();
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("pagehide", sessionRelease);
    window.addEventListener("storage", function () { sessionBeat(); });          // another tab wrote something: look at once
  }
  if (typeof setInterval === "function") setInterval(function () { sessionBeat(); }, SESSION_BEAT);
  return ok;
}
