// Standings tab: the six divisions (AL on top, NL below), the wild card races, or the playoff bracket (bracket.js).
// Tap any team to open its team page.
const Standings = (() => {
  let mode = "div";
  let ldLg = "mlb";      // leaders: mlb | al | nl
  let records = null;   // division id -> sorted team records
  let season = currentSeason();
  let timer = 0;

  const el = () => document.getElementById("standings-body");

  async function fetchStandings() {
    for (const yr of [currentSeason(), currentSeason() - 1]) {
      const data = await api(`/api/v1/standings?leagueId=103,104&season=${yr}&standingsTypes=regularSeason`, { ttl: 120_000 });
      const recs = data.records || [];
      if (recs.some((r) => (r.teamRecords || []).some((t) => t.wins + t.losses > 0))) { season = yr; return recs; }
    }
    return [];
  }

  const split = (tr, type) => (tr.records?.splitRecords || []).find((s) => s.type === type);
  const wl = (s) => (s ? `${s.wins}-${s.losses}` : "");
  const diff = (n) => (n == null ? "" : n > 0 ? `+${n}` : String(n));
  const gb = (v) => (v == null || v === "-" ? "–" : v);

  function teamCell(tr, rankNo) {
    const t = teamMeta(tr.team);
    const clinch = tr.clinchIndicator ? `<sup>${esc(tr.clinchIndicator)}</sup>` : "";
    return `${rankNo != null ? `<span class="rk">${rankNo}</span>` : ""}${logoImg(t)}<span class="nm">${esc(t.name)}</span>${clinch}`;
  }
  const rowAttrs = (tr) => {
    const t = teamMeta(tr.team);
    return { __attrs: `data-team="${t.id}" role="button"`, __cls: `${selected === t.abbr ? "mine" : ""}`, __style: vars(t) };
  };

  function divisionTable(div, recs) {
    const rows = recs.map((tr) => ({ ...tr, ...rowAttrs(tr) }));
    const cols = [
      { h: esc(div.name), cls: "team", f: (r) => teamCell(r) },
      { h: "W", f: (r) => r.wins }, { h: "L", f: (r) => r.losses },
      { h: "PCT", f: (r) => esc(r.winningPercentage) }, { h: "GB", f: (r) => esc(gb(r.gamesBack)) },
      { h: "L10", f: (r) => wl(split(r, "lastTen")) }, { h: "STRK", f: (r) => esc(r.streak?.streakCode || "") },
      { h: "DIFF", cls: "diff", f: (r) => `<span class="${r.runDifferential > 0 ? "pos" : r.runDifferential < 0 ? "neg" : ""}">${diff(r.runDifferential)}</span>` },
    ];
    return table(cols, rows, { cls: "standings" });
  }

  function wildCardTable(lg, recs) {
    const leaders = recs.filter((r) => r.divisionRank === "1").sort((a, b) => +a.leagueRank - +b.leagueRank);
    const rest = recs.filter((r) => r.divisionRank !== "1").sort((a, b) => (+a.wildCardRank || 99) - (+b.wildCardRank || 99) || +a.leagueRank - +b.leagueRank);
    const cols = [
      { h: `${lg} wild card`, cls: "team", f: (r) => teamCell(r) },
      { h: "W", f: (r) => r.wins }, { h: "L", f: (r) => r.losses }, { h: "PCT", f: (r) => esc(r.winningPercentage) },
      { h: "WCGB", f: (r) => (r.divisionRank === "1" ? `<span class="muted">${esc(DIVISIONS.find((d) => d.id === r.__div)?.name.split(" ")[1] || "")}</span>` : esc(gb(r.wildCardGamesBack))) },
      { h: "L10", f: (r) => wl(split(r, "lastTen")) }, { h: "STRK", f: (r) => esc(r.streak?.streakCode || "") },
      { h: "HOME", f: (r) => wl(split(r, "home")) }, { h: "AWAY", f: (r) => wl(split(r, "away")) },
      { h: "DIFF", cls: "diff", f: (r) => `<span class="${r.runDifferential > 0 ? "pos" : r.runDifferential < 0 ? "neg" : ""}">${diff(r.runDifferential)}</span>` },
    ];
    const rows = [
      ...leaders.map((r) => ({ ...r, ...rowAttrs(r) })),
      { __section: "Wild card" },
      ...rest.map((r, i) => ({ ...r, ...rowAttrs(r), __cls: `${rowAttrs(r).__cls} ${i === 2 ? "cut" : ""}` })),
    ];
    return table(cols, rows, { cls: "standings wc" });
  }

  function draw() {
    if (!records) return;
    const box = el();
    if (mode !== "br") Bracket.stop();
    if (mode === "ld") {
      if (box.className !== "ldmode" || box.dataset.lg !== ldLg || box.dataset.yr !== String(season)) {
        box.className = "ldmode"; box.dataset.lg = ldLg; box.dataset.yr = season;
        Leaders.render(box, season, ldLg);
      }
      return;
    }
    if (mode === "br") {
      box.className = "brmode";
      Bracket.render(box, season);
      return;
    }
    if (mode === "wc") {
      const byLg = { AL: [], NL: [] };
      DIVISIONS.forEach((d) => (records[d.id] || []).forEach((r) => byLg[d.lg].push({ ...r, __div: d.id })));
      box.className = "wcmode";
      box.innerHTML = `<div class="lg">${wildCardTable("AL", byLg.AL)}</div><div class="lg">${wildCardTable("NL", byLg.NL)}</div>`;
    } else {
      box.className = "divmode";
      box.innerHTML = ["AL", "NL"].map((lg) => `<div class="lgrow">${DIVISIONS.filter((d) => d.lg === lg)
        .map((d) => `<div class="div">${divisionTable(d, records[d.id] || [])}</div>`).join("")}</div>`).join("");
    }
    // Row colors for the team-color tick.
    box.querySelectorAll("tr[data-team]").forEach((tr) => { const t = teamById[tr.dataset.team]; if (t) tr.setAttribute("style", vars(t)); });
  }

  function ctx() {
    if (activeTab !== "standings") return;   // My team reads standings from other tabs
    document.getElementById("ctx").innerHTML = `<div class="seg">
      <button data-m="div" class="${mode === "div" ? "on" : ""}">Divisions</button>
      <button data-m="wc" class="${mode === "wc" ? "on" : ""}">Wild card</button>
      <button data-m="br" class="${mode === "br" ? "on" : ""}">Bracket</button>
      <button data-m="ld" class="${mode === "ld" ? "on" : ""}">Leaders</button></div>
      ${mode === "ld" ? `<div class="seg">${[["mlb", "MLB"], ["al", "AL"], ["nl", "NL"]].map(([v, l]) => `<button data-lg="${v}" class="${ldLg === v ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
      <span class="ctx-label">${season}</span>`;
  }

  async function refresh() {
    try {
      const recs = await fetchStandings();
      records = {};
      recs.forEach((r) => { records[r.division?.id] = (r.teamRecords || []).slice().sort((a, b) => +a.divisionRank - +b.divisionRank); });
      ctx(); draw();
      setUpdated("standings", `Updated ${timeLabel(new Date())}`);
    } catch (e) {
      console.warn(e);
      if (!records) el().innerHTML = `<div class="empty"><div>Couldn't reach MLB. Retrying shortly.</div></div>`;
      setUpdated("standings", "Couldn't reach MLB");
    }
    clearTimeout(timer);
    if (activeTab === "standings") timer = setTimeout(refresh, 10 * 60_000);
  }

  function init() {
    mode = load("standings-mode") || "div";
    el().addEventListener("click", (e) => {
      const pl = e.target.closest("[data-player]"); if (pl) return Sheet.open("player", { id: +pl.dataset.player });
      const tr = e.target.closest("tr[data-team]"); if (tr) Sheet.open("team", { id: +tr.dataset.team });
    });
    dragScroll(el(), "y");
    document.getElementById("ctx").addEventListener("click", (e) => {
      if (activeTab !== "standings") return;
      const l = e.target.closest("[data-lg]");
      if (l) { ldLg = l.dataset.lg; ctx(); draw(); return; }
      const b = e.target.closest("[data-m]"); if (!b) return;
      mode = b.dataset.m; save("standings-mode", mode); ctx(); draw();
    });
  }

  return {
    init,
    show() { ctx(); draw(); refresh(); },
    hide() { clearTimeout(timer); Bracket.stop(); },
    teamChanged() { draw(); },
    // Used by the team page and the rosters grid.
    async recordFor(teamId) {
      if (!records) await refresh();
      for (const d of DIVISIONS) {
        const r = (records?.[d.id] || []).find((x) => x.team?.id === teamId);
        if (r) return { ...r, div: d };
      }
      return null;
    },
    all: () => records,
    season: () => season,
  };
})();
