// Search: teams, players and stories by name, behind the magnifier next to Settings.
// Players come from the season's MLB player list (loaded the first time search opens), with MLB's people
// search as a fallback for anyone not on it (retired players). The Xeneon gets its own on-screen keyboard,
// since iCUE's widget may not bring up Windows' touch keyboard; the phone uses its own keyboard.
const Search = (() => {
  const MOBILE = typeof IS_MOBILE !== "undefined" && IS_MOBILE;
  let players = null, loading = null, q = "", extra = [], extraQ = "", timer = 0;
  const box = () => document.getElementById("search");
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function loadPlayers() {
    if (players || loading) return loading;
    loading = api(`/api/v1/sports/1/players?season=${currentSeason()}&fields=people,id,fullName,primaryPosition,abbreviation,currentTeam`, { ttl: 6 * 3600_000 })
      .then((d) => { players = (d.people || []).map((p) => ({ id: p.id, name: p.fullName, n: norm(p.fullName), pos: p.primaryPosition?.abbreviation || "", team: p.currentTeam?.id })); })
      .catch(() => { players = []; })
      .finally(() => { loading = null; draw(); });
    return loading;
  }
  // Starts-with on any word beats contains.
  const score = (n, s) => (n.startsWith(s) ? 0 : n.split(/\s+/).some((w) => w.startsWith(s)) ? 1 : n.includes(s) ? 2 : 9);
  function find(s) {
    if (!s) return { teams: [], people: [], stories: [] };
    const teams = TEAMS.map((t) => ({ t, k: Math.min(score(norm(t.name), s), score(norm(t.abbr), s), ...(t.match || []).map((m) => score(norm(m), s))) }))
      .filter((x) => x.k < 9).sort((a, b) => a.k - b.k).slice(0, 4).map((x) => x.t);
    let people = (players || []).map((p) => ({ p, k: score(p.n, s) })).filter((x) => x.k < 9)
      .sort((a, b) => a.k - b.k || a.p.name.localeCompare(b.p.name)).slice(0, 12).map((x) => x.p);
    if (people.length < 4 && extraQ === s) people = people.concat(extra.filter((e) => !people.some((p) => p.id === e.id))).slice(0, 12);
    const stories = (typeof articles !== "undefined" ? articles : []).filter((a) => norm(a.title).includes(s)).slice(0, 4);
    return { teams, people, stories };
  }
  // Not on this season's list: ask MLB's people search (debounced).
  function lookup(s) {
    clearTimeout(timer);
    if (s.length < 3) return;
    timer = setTimeout(() => {
      api(`/api/v1/people/search?names=${encodeURIComponent(s)}&sportIds=1`, { ttl: 3600_000 })
        .then((d) => { extra = (d.people || []).map((p) => ({ id: p.id, name: p.fullName, pos: p.primaryPosition?.abbreviation || "", team: p.currentTeam?.id, old: !p.active })); extraQ = s; if (norm(q) === s) drawResults(); })
        .catch(() => {});
    }, 350);
  }

  function results() {
    const s = norm(q.trim());
    const { teams, people, stories } = find(s);
    if (!s) return `<div class="sr-hint">${players ? "Type a player, team or story" : "Loading players…"}</div>`;
    if (!teams.length && !people.length && !stories.length) return `<div class="sr-hint">${loading ? "Loading players…" : `Nothing found for “${esc(q.trim())}”`}</div>`;
    const tRow = (t) => `<button class="sr" data-team="${t.id}">${logoImg(t)}<span class="nm">${esc(t.name)}</span><span class="sub">Team</span></button>`;
    const pRow = (p) => { const t = TEAMS.find((x) => x.id === p.team);
      return `<button class="sr" data-player="${p.id}"><img class="hs" src="${headshot(p.id, 90)}" alt="" onerror="this.style.visibility='hidden'"><span class="nm">${esc(p.name)}</span>
        <span class="sub">${esc([p.pos, t ? t.abbr : p.old ? "Former" : ""].filter(Boolean).join(" · "))}</span></button>`; };
    const sRow = (a) => `<button class="sr" data-link="${esc(a.link)}"><span class="st-ic">✦</span><span class="nm">${esc(a.title)}</span><span class="sub">Story</span></button>`;
    return [teams.map(tRow), people.map(pRow), stories.map(sRow)].flat().join("");
  }
  function drawResults() { const r = box().querySelector(".s-results"); if (r) r.innerHTML = results(); }

  const KEYS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  function draw() {
    if (!box()?.classList.contains("open")) return;
    if (!box().innerHTML) {
      box().innerHTML = `<div class="s-head"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>
          <input class="s-in" type="search" placeholder="Search players, teams, stories" autocomplete="off" autocorrect="off" spellcheck="false" ${MOBILE ? "" : "readonly"}>
          <button class="s-clear" aria-label="Clear">×</button></div>
        <div class="s-cols"><div class="s-results"></div>
        ${MOBILE ? "" : `<div class="kb">${KEYS.map((r) => `<div class="kr">${[...r].map((k) => `<button data-k="${k}">${k}</button>`).join("")}</div>`).join("")}
          <div class="kr"><button class="wide" data-k=" ">Space</button><button class="wide" data-k="-">-</button><button class="wide" data-k="⌫">⌫</button></div></div>`}</div>`;
      const inp = box().querySelector(".s-in");
      inp.addEventListener("input", () => { q = inp.value; drawResults(); lookup(norm(q.trim())); });
    }
    box().querySelector(".s-in").value = q;
    drawResults();
  }
  function open(on) {
    box().classList.toggle("open", on);
    document.getElementById("search-btn")?.classList.toggle("on", on);
    if (!on) return;
    loadPlayers(); draw();
    if (MOBILE) setTimeout(() => box().querySelector(".s-in")?.focus(), 50);
  }

  function init() {
    const el = document.createElement("div");
    el.id = "search"; el.className = "pop";
    document.getElementById("stage").appendChild(el);
    const btn = document.createElement("button");
    btn.id = "search-btn"; btn.setAttribute("aria-label", "Search");
    btn.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>`;
    const sb = document.getElementById("settings-btn");
    sb.parentNode.insertBefore(btn, sb);
    btn.onclick = () => open(!el.classList.contains("open"));
    el.addEventListener("click", (e) => {
      const k = e.target.closest("[data-k]");
      if (k) { q = k.dataset.k === "⌫" ? q.slice(0, -1) : (q + k.dataset.k.toLowerCase()).replace(/^\s+/, ""); draw(); lookup(norm(q.trim())); return; }
      if (e.target.closest(".s-clear")) { q = ""; draw(); return; }
      const r = e.target.closest(".sr"); if (!r) return;
      open(false);
      if (r.dataset.team) Sheet.open("team", { id: +r.dataset.team });
      else if (r.dataset.player) Sheet.open("player", { id: +r.dataset.player });
      else if (r.dataset.link) { const a = articles.find((x) => x.link === r.dataset.link); if (a) openReader(a); }
    });
    document.addEventListener("pointerdown", (e) => {
      if (el.classList.contains("open") && !el.contains(e.target) && !e.target.closest("#search-btn")) open(false);
    });
  }
  return { init, open, close: () => open(false) };
})();
