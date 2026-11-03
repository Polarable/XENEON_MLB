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
      <div class="set-note">Their games lead the Scores tab and are marked on the calendar.</div>`;
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
