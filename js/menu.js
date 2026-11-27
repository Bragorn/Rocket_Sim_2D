"use strict";

/* =====================================================================
   MENU  (js/menu.js)
   The pause menu (Esc) and the cards it opens: the key list and the
   recovery summary. Ordinary page elements over the canvas: while the menu
   is closed it is hidden and costs nothing. The flight report is in report.js.
     Resume            back to the flight
     Revert to launch  the same rocket on the pad again, only during the flight it was launched in (not once it has been left)
     Back to builder   leave the rocket where it is, but only if it is safe to leave: still on the ground, or in a permanent orbit, with the throttle off
     Vessels           the rockets left in the universe: switch to one, or scrap it
     Recover vessel    only when it is down and still: ends the flight as a success and shows the results
   ===================================================================== */

let flightEnded = false;             // true after Recover: the flight is over, the world stays frozen
const menuUi = { root: null, box: null, panel: "main" };

const MENU_CSS = `
.mroot { position: fixed; left: 0; top: 0; right: 0; bottom: 0; display: none; align-items: center; justify-content: center; background: rgba(5,8,11,0.62); z-index: 10; font: 13px/1.4 monospace; color: #e8eef2; user-select: none; }
.mbox { width: 340px; max-height: 90vh; overflow-y: auto; background: #0a0e12; border: 1px solid rgba(255,255,255,0.22); padding: 14px 16px; scrollbar-width: thin; scrollbar-color: #3a4854 transparent; }
.mbox.wide { width: min(940px, 94vw); }
.mh { font-size: 16px; font-weight: bold; margin-bottom: 2px; }
.ms { color: #8a98a3; margin-bottom: 10px; }
.mb { display: block; width: 100%; box-sizing: border-box; margin: 6px 0; padding: 9px 0; font: inherit; color: #e8eef2; background: #1b242c; border: 1px solid rgba(255,255,255,0.22); cursor: pointer; }
.mb:hover:not(:disabled) { background: #26333d; }
.mb:disabled { opacity: 0.35; cursor: default; }
.mb.go { background: #e8eef2; color: #101418; border-color: #e8eef2; font-weight: bold; }
.mnote { color: #f0b33c; font-size: 11px; margin: -2px 0 6px; }
.mrow { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
.mrow .k { color: #8a98a3; }
.mrow2 { display: flex; gap: 12px; padding: 2px 0; }
.mrow2 .k { width: 110px; flex: none; color: #4aa3ff; }
`;

function mel(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function menuBuild() {
  const st = mel("style"); st.textContent = MENU_CSS; document.head.appendChild(st);
  menuUi.root = mel("div", "mroot"); menuUi.box = mel("div", "mbox");
  menuUi.root.appendChild(menuUi.box); document.body.appendChild(menuUi.root);
}

function menuIsOpen() { return menuUi.root.style.display !== "none" && menuUi.root.style.display !== ""; }
function openMenu() { paused = true; menuUi.root.style.display = "flex"; showPanel("main"); }
function closeMenu() { menuUi.root.style.display = "none"; if (!flightEnded) paused = false; }
function menuBack() { if (menuUi.panel !== "main") showPanel("main"); else closeMenu(); }
function menuReset() { flightEnded = false; paused = false; if (menuUi.root) menuUi.root.style.display = "none"; }

function mbutton(label, fn, disabled, cls) {
  const b = mel("button", "mb" + (cls ? " " + cls : ""), label); b.type = "button"; b.disabled = !!disabled;
  b.addEventListener("click", function () { if (!b.disabled) fn(); });
  menuUi.box.appendChild(b);
  return b;
}

/* ---- what the buttons do ---- */
function doRevert() {
  if (!flightEnded && typeof flightCanRevert === "function" && !flightCanRevert().ok) return;   // (flightstate.js) the button is greyed too
  menuUi.root.style.display = "none";
  resetAll();
  if (typeof flightTracked === "function") {                                           // (flightstate.js)
    const kept = flightTracked() ? persistFlight(true) : flightRetrack(currentDesign);   // the vessel is back on the pad (after a recovery it goes back on as a new one)
    if (!kept.ok) log("Not saved: " + kept.problem, "warning");
  }
}

function doBuilder() {
  if (typeof flightTracked === "function" && flightTracked()) {
    const left = flightLeave();                                                         // saves it where it is, for good, if it is safe to leave
    if (!left.ok) { log("Can't leave: " + left.problem, "warning"); showPanel("main"); return; }
    flightDetach();
  } else if (!flightEnded && sim.flown && !confirm("This is a test flight and is not kept. Leave it? The rocket will be lost.")) return;
  location.href = "builder.html" + designToHash(currentDesign);
}

function doSwitch(id) {                                                                 // leave this rocket and fly another; the page reloads into it
  if (typeof flightSwitchTo !== "function") return;
  if (!flightTracked() && !flightEnded && sim.flown && !confirm("This is a test flight and is not kept. Switch anyway? The rocket will be lost.")) return;
  const r = flightSwitchTo(id);
  if (!r.ok) { log("Can't switch: " + r.problem, "warning"); showPanel("vessels"); return; }
  location.href = "index.html";
}

function doScrap(id) {                                                                  // remove a vessel from the universe for good
  const r = universeLoad(), v = r.universe && universeVessel(r.universe, id);
  if (!v || !confirm("Scrap " + v.name + "? It is removed from the universe for good.")) return;
  const s = universeSave(universeRemoveVessel(r.universe, id).universe);
  if (!s.ok) log("Not saved: " + s.problem, "warning");
  showPanel("vessels");
}

function doRecover() {
  if (!recoverable().ok) return;
  archiveFlight("recovered");
  flightEnded = true;
  if (typeof flightRecovered === "function") {
    const out = flightRecovered();                                                     // it leaves the universe: the pad is clear again
    if (!out.ok && out.problem !== "this flight is not kept") log("Not saved: " + out.problem, "warning");
  }
  showPanel("recovered");
}

/* ---- the cards ---- */
function showPanel(name) {
  menuUi.panel = name;
  const box = menuUi.box;
  box.textContent = ""; box.className = "mbox";
  if (name === "main") panelMain(box);
  else if (name === "controls") panelControls(box);
  else if (name === "vessels") panelVessels(box);
  else if (name === "recovered") panelRecovered(box);
  else if (name === "report") buildReport(box);
}

function panelMain(box) {
  box.appendChild(mel("div", "mh", flightEnded ? "Flight ended" : "Paused"));
  box.appendChild(mel("div", "ms", (currentDesign.name || "Rocket") + "   " + (sim.started ? "T+" + sim.t.toFixed(0) + " s" : "on the pad")));
  if (!flightEnded) mbutton("Resume", closeMenu, false, "go");
  const rev = !flightEnded && typeof flightCanRevert === "function" ? flightCanRevert() : { ok: true, reason: null };
  mbutton(flightEnded ? "Launch again" : "Revert to launch", doRevert, !rev.ok, flightEnded ? "go" : "");
  if (!rev.ok) box.appendChild(mel("div", "mnote", rev.reason));
  const leave = !flightEnded && typeof flightCanLeave === "function" ? flightCanLeave() : { ok: true, reasons: [] };
  mbutton("Back to builder", doBuilder, !leave.ok);
  for (const why of leave.reasons) box.appendChild(mel("div", "mnote", "Can't leave: " + why));
  if (typeof universeLoad === "function") mbutton("Vessels", function () { showPanel("vessels"); });
  if (!flightEnded) {
    const rc = recoverable();
    mbutton("Recover vessel", doRecover, !rc.ok);
    if (!rc.ok) box.appendChild(mel("div", "mnote", rc.reason));
  }
  mbutton("Flight report", function () { showPanel("report"); });
  mbutton("Controls", function () { showPanel("controls"); });
  mbutton("Air effects: " + airLook, function () { airLook = AIR_LOOKS[(AIR_LOOKS.indexOf(airLook) + 1) % AIR_LOOKS.length]; showPanel("main"); });
  mbutton("Performance readout: " + (showPerf ? "on" : "off"), function () { showPerf = !showPerf; showPanel("main"); });
}

const KEY_LIST = [["W / S", "throttle up / down (hold)"], ["Z / X", "full throttle / engine off"], ["A / D", "steer (turns the engine and the reaction wheel)"],
                  ["T", "rotation damping on / off"], ["M", "map view (or the Map button)"], ["< / >", "time warp slower / faster (or the - and + buttons)"],
                  ["+ / - / wheel", "zoom"], ["Esc", "this menu"], ["Space", "next stage (the staging list, top right)"]];

function panelControls(box) {
  box.appendChild(mel("div", "mh", "Controls"));
  box.appendChild(mel("div", "ms", "Everything else is in this menu or on the buttons in the bottom bar."));
  for (const k of KEY_LIST) { const r = mel("div", "mrow2"); r.appendChild(mel("span", "k", k[0])); r.appendChild(mel("span", "", k[1])); box.appendChild(r); }
  mbutton("Back", function () { showPanel("main"); });
}

function panelVessels(box) {
  box.appendChild(mel("div", "mh", "Vessels"));
  const r = typeof universeLoad === "function" ? universeLoad() : null;
  if (!r || !r.universe) box.appendChild(mel("div", "ms", "Nothing is saved yet."));
  else {
    const leave = !flightEnded && typeof flightCanLeave === "function" ? flightCanLeave() : { ok: true, reasons: [] };
    box.appendChild(mel("div", "ms", leave.ok ? "Resume one to switch to it. This rocket stays where it is." : "To switch, this rocket has to be safe to leave first."));
    for (const why of leave.reasons) box.appendChild(mel("div", "mnote", "Can't leave: " + why));
    const n = renderVesselList(box, r.universe, { currentId: flightTracked() ? flightVesselId : null, resumeDisabled: !leave.ok, btnClass: "mb", onResume: doSwitch, onScrap: doScrap });
    if (n === 0) box.appendChild(mel("div", "ms", "No vessels yet."));
  }
  mbutton("Back", function () { showPanel("main"); });
}

function panelRecovered(box) {
  box.appendChild(mel("div", "mh", "Vessel recovered"));
  box.appendChild(mel("div", "ms", (currentDesign.name || "Rocket") + ": a safe landing."));
  for (const r of summaryRows(flightSummary())) { const row = mel("div", "mrow"); row.appendChild(mel("span", "k", r[0])); row.appendChild(mel("span", "", r[1])); box.appendChild(row); }
  box.appendChild(mel("div", "ms", ""));
  mbutton("Launch again", doRevert, false, "go");
  mbutton("Back to builder", doBuilder);
  mbutton("Flight report", function () { showPanel("report"); });
}

menuBuild();
