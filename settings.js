// Settings: a popover behind the sliders icon in the top-right corner.
// Favorite team (Houston by default), text size, and on the Xeneon the idle behavior.
// The display check (pixel stripes and the window readout) stays behind "Show display info".
const Settings = (() => {
  const DEFAULT_FAV = "HOU";
  const MOBILE = typeof IS_MOBILE !== "undefined" && IS_MOBILE;
  // Phone keys get the "m-" prefix like the rest of the phone app, except the favorite, which is shared.
  const key = (k) => (MOBILE && k !== "fav" ? `m-${k}` : k);
  const get = (k) => { try { return localStorage.getItem(key(k)); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(key(k), v); } catch {} };
  let favAbbr = get("fav") ?? DEFAULT_FAV;   // "" means no favorite
  // On/off options. Missing means the default.
  const DEFAULTS = { big: "0", idle: "1", takeover: "1", diag: "0" };
  const opt = (k) => (get(k) ?? DEFAULTS[k]) === "1";
  const team = (abbr) => TEAMS.find((t) => t.abbr === abbr) || null;

  const box = () => document.getElementById("settings");
  const toggle = (k, label, note) => `<button class="set-tog ${opt(k) ? "on" : ""}" data-opt="${k}">
      <span class="sw"><i></i></span><span class="tl"><b>${label}</b>${note ? `<em>${note}</em>` : ""}</span></button>`;
  function draw() {
    const teams = [...TEAMS].sort((a, b) => a.name.localeCompare(b.name));
    const fav = team(favAbbr);
    box().innerHTML = `<div class="set-head"><span class="set-title">Favorite team</span>
        <button class="set-none ${favAbbr ? "" : "on"}" data-fav="">None</button></div>
      <div class="set-grid">${teams.map((t) =>
        `<button data-fav="${t.abbr}" class="${t.abbr === favAbbr ? "on" : ""}" style="--fav-rgb:${rgb(t.bright)}">${logoImg(t)}<span>${esc(t.name)}</span></button>`).join("")}</div>
      <div class="set-note">Their games lead the Scores tab and are marked on the calendar.</div>
      <div class="set-opts">
        ${toggle("big", "Large text", "Bigger small print: pitch lists, stat lines, tables")}
        ${MOBILE ? "" : toggle("idle", "Return home when idle", "After 3 minutes untouched, close open pages")}
        ${MOBILE ? "" : toggle("takeover", `Show ${fav ? `the ${esc(fav.name)}` : "my team"} live`, "When they're playing and nobody's touching the screen, open their game")}
        ${MOBILE ? "" : toggle("diag", "Show display info", "Pixel check for sharpness")}
      </div>
      ${opt("diag") && !MOBILE ? `<div class="set-diag"><div class="set-stripes" style="--px:${1 / ((typeof scale === "number" && scale > 0 ? scale : 1) * (window.devicePixelRatio || 1))}px" title="1-pixel stripes: crisp lines here mean the screen shows the page pixel for pixel"></div>
        <div>${diag()}</div></div>` : ""}`;
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
  function applyText() { document.getElementById("stage")?.classList.toggle("big", opt("big")); }

  function init() {
    const el = document.createElement("div");
    el.id = "settings"; el.className = "pop";
    document.getElementById("stage").appendChild(el);
    document.getElementById("settings-btn").onclick = () => open(!el.classList.contains("open"));
    el.addEventListener("click", (e) => {
      const o = e.target.closest("[data-opt]");
      if (o) { set(o.dataset.opt, opt(o.dataset.opt) ? "0" : "1"); applyText(); draw(); return; }
      const b = e.target.closest("[data-fav]"); if (!b) return;
      favAbbr = b.dataset.fav; set("fav", favAbbr); draw();
      VIEWS.scores?.favChanged?.();
      document.dispatchEvent(new CustomEvent("favchange"));
    });
    document.addEventListener("pointerdown", (e) => {
      if (el.classList.contains("open") && !el.contains(e.target) && !e.target.closest("#settings-btn")) open(false);
    });
    applyText();
  }

  return { init, fav: () => team(favAbbr), opt, close: () => open(false) };
})();
