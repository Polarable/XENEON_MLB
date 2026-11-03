// Settings: a small popover behind the sliders icon in the top-right corner.
// For now it holds the favorite team (Houston by default), whose games lead the Scores tab
// and are marked on the calendar.
const Settings = (() => {
  const DEFAULT_FAV = "HOU";
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  let favAbbr = get("fav") ?? DEFAULT_FAV;   // "" means no favorite
  const team = (abbr) => TEAMS.find((t) => t.abbr === abbr) || null;

  const box = () => document.getElementById("settings");
  function draw() {
    const teams = [...TEAMS].sort((a, b) => a.name.localeCompare(b.name));
    box().innerHTML = `<div class="set-head"><span class="set-title">Favorite team</span>
        <button class="set-none ${favAbbr ? "" : "on"}" data-fav="">None</button></div>
      <div class="set-grid">${teams.map((t) =>
        `<button data-fav="${t.abbr}" class="${t.abbr === favAbbr ? "on" : ""}" style="--fav-rgb:${rgb(t.bright)}">${logoImg(t)}<span>${esc(t.name)}</span></button>`).join("")}</div>
      <div class="set-note">Their games lead the Scores tab and are marked on the calendar.</div>
      <div class="set-diag"><div class="set-stripes" style="--px:${1 / ((typeof scale === "number" && scale > 0 ? scale : 1) * (window.devicePixelRatio || 1))}px" title="1-pixel stripes: crisp lines here mean the screen shows the page pixel for pixel"></div>
        <div>${diag()}</div></div>`;
  }
  // What the page actually gets from iCUE, for tracking down blurry rendering. If the stripes look
  // gray instead of crisp lines, the page is being drawn smaller and stretched up by the host.
  function diag() {
    const dpr = window.devicePixelRatio || 1;
    const ua = (navigator.userAgent.match(/(Chrome|QtWebEngine|Edg)\/[\d.]+/g) || []).join(" ");
    const st = document.getElementById("stage");
    const zoomed = st && st.style.zoom ? `zoom ${(+st.style.zoom).toFixed(3)}` : st && st.style.transform ? `transform ${st.style.transform}` : "no scaling";
    return `Window ${innerWidth}×${innerHeight} · pixel ratio ${+dpr.toFixed(3)} · screen ${screen.width}×${screen.height} · ` +
      `${zoomed} · ${Math.round(innerWidth * dpr)}×${Math.round(innerHeight * dpr)} device px · build ${typeof BUILD === "string" ? BUILD : "?"} · ${ua}`;
  }
  function open(on) {
    box().classList.toggle("open", on);
    document.getElementById("settings-btn").classList.toggle("on", on);
    if (on) draw();
  }

  function init() {
    const el = document.createElement("div");
    el.id = "settings"; el.className = "pop";
    document.getElementById("stage").appendChild(el);
    document.getElementById("settings-btn").onclick = () => open(!el.classList.contains("open"));
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fav]"); if (!b) return;
      favAbbr = b.dataset.fav; set("fav", favAbbr); draw();
      VIEWS.scores?.favChanged?.();
    });
    document.addEventListener("pointerdown", (e) => {
      if (el.classList.contains("open") && !el.contains(e.target) && !e.target.closest("#settings-btn")) open(false);
    });
  }

  return { init, fav: () => team(favAbbr), close: () => open(false) };
})();
