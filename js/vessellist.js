"use strict";

/* =====================================================================
   VESSEL LIST  (js/vessellist.js)
   The list of vessels in the universe (universe.js), shared by the builder page and the flight menu:
   what each one is doing in plain words, and the little page elements that show it with Resume and Scrap buttons.
   Nothing here changes the universe: the page that shows the list decides what the buttons do.
   ===================================================================== */

function vlKm(m) {                  // a distance in metres as text: 842 m, 12.3 km, 480 km
  if (Math.abs(m) < 1000) return Math.round(m) + " m";
  return (Math.abs(m) >= 100000 ? Math.round(m / 1000) : (m / 1000).toFixed(1)) + " km";
}

/* Where a vessel is and what it is doing, from its saved state. */
function vesselWhere(v) {
  const s = v.state;
  if (v.status === "pad" || !s) return "On the launch pad";
  const p = s.pos, alt = Math.hypot(p.x, p.y) - R;
  if (v.status === "landed") return "Landed, " + vlKm(R * Math.abs(Math.atan2(p.x, p.y))) + " from the pad";
  if (v.status === "orbit") {
    const o = orbitInfo(p, s.vel);
    return o.bound ? "In orbit, " + vlKm(o.rp - R) + " by " + vlKm(o.ra - R) : "In space, leaving the planet";
  }
  return "Mid-flight, " + vlKm(alt) + " up";
}

/* One row per vessel, newest first: { id, name, status, where, active, unsafe }. unsafe: it was left mid-flight. */
function vesselRows(u) {
  return u.vessels.slice().reverse().map(function (v) {
    return { id: v.id, name: v.name, status: v.status, where: vesselWhere(v), active: v.id === u.activeId, unsafe: v.status === "flying" };
  });
}

function vlEl(tag, text, css) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (css) e.style.cssText = css;
  return e;
}

/* Draw the list into `box`. opts:
     currentId       the vessel being flown on this page, shown as "this flight" with no buttons (flight menu)
     resumeDisabled  true: the Resume buttons are greyed (the flight cannot be left yet)
     onResume(id), onScrap(id)   what the buttons do
     btnClass        the page's own button class
   Returns how many rows were drawn. */
function renderVesselList(box, u, opts) {
  const rows = vesselRows(u), o = opts || {};
  let shown = 0;
  for (const r of rows) {
    const row = vlEl("div", undefined, "display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.07);");
    const info = vlEl("div", undefined, "flex:1;min-width:0;");
    info.appendChild(vlEl("div", r.name + (r.active && !o.currentId ? "  (last flown)" : ""), "font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"));
    info.appendChild(vlEl("div", r.id === o.currentId ? "This flight" : r.where + (r.unsafe && r.id !== o.currentId ? " (left mid-flight)" : ""), "opacity:0.7;font-size:11px;"));
    row.appendChild(info);
    if (r.id !== o.currentId) {
      const go = vlEl("button", "Resume", "width:auto;display:inline-block;margin:0;padding:3px 8px;");
      go.type = "button"; go.className = o.btnClass || ""; go.disabled = !!o.resumeDisabled;
      go.addEventListener("click", function () { if (!go.disabled && o.onResume) o.onResume(r.id); });
      const del = vlEl("button", "Scrap", "width:auto;display:inline-block;margin:0;padding:3px 8px;");
      del.type = "button"; del.className = o.btnClass || "";
      del.addEventListener("click", function () { if (o.onScrap) o.onScrap(r.id); });
      row.appendChild(go); row.appendChild(del);
    }
    box.appendChild(row); shown++;
  }
  return shown;
}
