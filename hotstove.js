// News tab, second and third views: Moves (MLB's official transactions) and Free agents (this winter's class).
// The team picker filters both. Player names open their pages; team logos open the team.
const HotStove = (() => {
  const MOBILE = typeof IS_MOBILE !== "undefined" && IS_MOBILE;
  let mode = "stories";                          // stories | moves | fa (restored in init)
  let faMode = "all";                            // all | open | signed
  let token = 0;
  const alt = () => document.getElementById("news-alt");
  const stories = () => document.getElementById(MOBILE ? "m-news" : "row");
  const mlbIds = new Set(TEAMS.map((t) => t.id));
  const teamOf = (id) => TEAMS.find((t) => t.id === id) || null;
  const picked = () => (typeof selected !== "undefined" && selected !== "ALL" ? byAbbr[selected] : null);

  function ctx() {
    if (activeTab !== "news") return;
    document.getElementById("ctx").innerHTML = seg([["stories", "Stories"], ["moves", "Moves"], ["fa", "Free agents"]], mode, "data-nm") +
      (mode === "fa" ? seg([["all", "All"], ["open", "Available"], ["signed", "Signed"]], faMode, "data-fa") : "");
  }
  function apply() {
    stories().style.display = mode === "stories" ? "" : "none";
    alt().style.display = mode === "stories" ? "none" : "";
    if (mode === "stories") { if (!MOBILE && typeof layout === "function") layout(); return; }
    render();
  }

  // ---- Moves ----
  // Skip the minor league churn: minor league deals, options, recalls, assignments.
  const NOISE = /minor league|optioned|recalled|assigned to|returned .* from .* rehab|sent .* on a rehab/i;
  async function moves() {
    const end = etYmd(), start = shiftYmd(end, -13);
    const data = await api(`/api/v1/transactions?sportId=1&startDate=${start}&endDate=${end}`, { ttl: 10 * 60_000 });
    const t = picked();
    return (data.transactions || [])
      .filter((x) => x.description && !NOISE.test(x.description))
      .filter((x) => mlbIds.has(x.toTeam?.id) || mlbIds.has(x.fromTeam?.id))
      .filter((x) => !t || x.toTeam?.id === t.id || x.fromTeam?.id === t.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  }
  function movesHtml(list) {
    if (!list.length) return `<div class="empty"><div>No moves in the last two weeks${picked() ? ` for the ${esc(picked().name)}` : ""}</div></div>`;
    let day = "";
    return `<div class="hs-moves">${list.map((x) => {
      const t = teamOf(x.toTeam?.id) || teamOf(x.fromTeam?.id);
      const head = x.date !== day ? `<div class="hs-day">${esc(relDay(x.date))}</div>` : "";
      day = x.date;
      const desc = linkPlayers(x.description, x.person ? [[x.person.fullName, x.person.id]] : [], esc);
      return `${head}<div class="hs-mv"><span class="tl" ${t ? `data-team="${t.id}"` : ""}>${t ? logoImg(t) : ""}</span>
        <div><span class="ty">${esc(x.typeDesc || "")}</span><p>${desc}</p></div></div>`;
    }).join("")}</div>`;
  }

  // ---- Free agents ----
  async function freeAgents() {
    const season = Season.info?.season || currentSeason();
    const [fa, roster] = await Promise.all([
      api(`/api/v1/people/freeAgents?season=${season}`, { ttl: 15 * 60_000 }),
      api(`/api/v1/sports/1/players?season=${season}&fields=people,id`, { ttl: 6 * 3600_000 }).catch(() => ({ people: [] })),
    ]);
    // Only players who were in the majors this season (the full list includes thousands of minor leaguers).
    const mlb = new Set((roster.people || []).map((p) => p.id));
    const t = picked();
    return (fa.freeAgents || [])
      .filter((x) => !mlb.size || mlb.has(x.player?.id))
      .filter((x) => !/minor league/i.test(x.notes || ""))
      .filter((x) => !t || x.originalTeam?.id === t.id || x.newTeam?.id === t.id)
      .map((x) => ({ ...x, signed: !!x.newTeam?.id }))
      .sort((a, b) => b.signed - a.signed || (b.signed ? String(b.dateSigned || b.dateDeclared).localeCompare(String(a.dateSigned || a.dateDeclared)) : 0)
        || String(a.player?.fullName).localeCompare(String(b.player?.fullName)));
  }
  function faHtml(all) {
    const list = all.filter((x) => faMode === "all" || (faMode === "signed" ? x.signed : !x.signed));
    const n = all.filter((x) => x.signed).length;
    if (!list.length) return `<div class="empty"><div>No ${faMode === "signed" ? "signings" : "free agents"} yet${picked() ? ` for the ${esc(picked().name)}` : ""}</div></div>`;
    return `<div class="hs-sum">${all.length} major league free agents · ${n} signed · ${all.length - n} available</div>
      <div class="hs-fa">${list.map((x) => {
        const from = teamOf(x.originalTeam?.id), to = teamOf(x.newTeam?.id);
        return `<div class="hs-p lnk" data-player="${x.player?.id}">
          <img class="hs-hs" src="${headshot(x.player?.id, 120)}" alt="" onerror="this.style.visibility='hidden'">
          <div class="hs-nm"><b>${esc(x.player?.fullName || "")}</b><span>${esc(x.position?.abbreviation || "")}${from ? ` · ${esc(from.name)}` : ""}</span></div>
          ${to ? `<span class="hs-st signed">${logoImg(to)}Signed</span>` : `<span class="hs-st">Available</span>`}</div>`;
      }).join("")}</div>`;
  }

  async function render() {
    const my = ++token;
    const box = alt();
    if (!box.innerHTML || box.dataset.mode !== mode) box.innerHTML = `<div class="s-loading">Loading…</div>`;
    box.dataset.mode = mode;
    try {
      const html = mode === "moves" ? movesHtml(await moves()) : faHtml(await freeAgents());
      if (my === token) box.innerHTML = html;
    } catch (e) {
      console.warn(e);
      if (my === token) box.innerHTML = `<div class="empty"><div>Couldn't reach MLB. Try again in a moment.</div></div>`;
    }
  }

  function init() {
    mode = load("news-mode") || "stories";
    const box = document.createElement("div");
    box.id = "news-alt"; box.style.display = "none";
    document.getElementById("view-news").appendChild(box);
    dragScroll(box, "y");
    box.addEventListener("click", (e) => {
      const p = e.target.closest("[data-player]"); if (p) return Sheet.open("player", { id: +p.dataset.player });
      const t = e.target.closest("[data-team]"); if (t) return Sheet.open("team", { id: +t.dataset.team });
    });
    document.getElementById("ctx").addEventListener("click", (e) => {
      if (activeTab !== "news") return;
      const b = e.target.closest("[data-nm],[data-fa]"); if (!b) return;
      if (b.dataset.nm) { mode = b.dataset.nm; save("news-mode", mode); }
      else faMode = b.dataset.fa;
      ctx(); apply();
    });
  }
  return { init, show() { ctx(); apply(); }, teamChanged() { if (mode !== "stories") render(); } };
})();
