// Desktop dashboard (the installed app / a wide browser window): a live scores rail on the left and a
// "your team" panel on the right, around whatever tab is open in the middle. Phones never build it.
const Dash = (() => {
  const WIDE = matchMedia("(min-width: 1024px)");
  let left, right, built = false;
  let railTimer = 0, teamTimer = 0, railKey = "";

  const season = () => Season.info?.season || currentSeason();
  const open = (type, args) => { if (typeof closeReaderFromDash === "function") closeReaderFromDash(); Sheet.open(type, args); };

  // ---------- Left: scores rail ----------
  async function railDay() {
    const today = etYmd();
    const d = await api(`/api/v1/schedule?sportId=1&date=${today}&fields=dates,totalGames`, { ttl: 300_000 }).catch(() => ({}));
    if ((d.dates || []).some((x) => x.totalGames > 0)) return { ymd: today, label: "Today" };
    // Off day or offseason: the most recent day with games.
    const back = await api(`/api/v1/schedule?sportId=1&startDate=${shiftYmd(today, -150)}&endDate=${shiftYmd(today, -1)}&fields=dates,date,totalGames`, { ttl: 3_600_000 }).catch(() => ({}));
    const last = (back.dates || []).filter((x) => x.totalGames > 0).pop();
    return last ? { ymd: last.date, label: relDay(last.date) } : { ymd: today, label: "Today" };
  }

  function status(g) {
    const st = g.status || {}, ls = g.linescore || {}, ph = isPostponed(st) ? "off" : phaseOf(st);
    if (ph === "final") return { ph, txt: (ls.currentInning || 9) !== 9 ? `Final/${ls.currentInning}` : "Final" };
    if (ph === "live") {
      const half = /mid|end/i.test(ls.inningState || "") ? ls.inningState : (ls.inningHalf || "").startsWith("T") ? "Top" : "Bot";
      return { ph, txt: `${half} ${ls.currentInningOrdinal || ""}`, outs: ls.outs };
    }
    if (ph === "off") return { ph, txt: st.detailedState || "Postponed" };
    return { ph, txt: st.startTimeTBD ? "TBD" : timeLabel(g.gameDate) };
  }

  function railRow(g, favId) {
    const s = status(g);
    const note = g.gameType && g.gameType !== "R" && g.seriesDescription
      ? `${esc(g.seriesDescription)}${g.seriesGameNumber ? ` · Gm ${g.seriesGameNumber}` : ""}` : "";
    const side = (k) => {
      const t = g.teams[k], m = teamMeta(t.team), score = s.ph === "preview" || s.ph === "off" ? "" : (t.score ?? "");
      const lose = s.ph === "final" && t.isWinner === false;
      const rec = t.leagueRecord ? `${t.leagueRecord.wins}-${t.leagueRecord.losses}` : "";
      return `<div class="dr-t ${lose ? "lose" : ""}">${logoImg(m)}<b>${esc(m.abbr || m.name || "")}</b><i>${rec}</i><span>${score}</span></div>`;
    };
    const fav = favId && (g.teams.away.team.id === favId || g.teams.home.team.id === favId);
    return `<button class="dr ${s.ph}${fav ? " fav" : ""}" data-pk="${g.gamePk}">
      <div class="dr-s">${s.ph === "live" ? `<i class="dot"></i>` : ""}${esc(s.txt)}${note ? `<em>${note}</em>` : ""}</div>
      ${side("away")}${side("home")}</button>`;
  }

  async function drawRail() {
    clearTimeout(railTimer);
    if (!built) return;
    let live = false;
    try {
      const day = await railDay();
      const data = await api(`/api/v1/schedule?sportId=1&date=${day.ymd}&hydrate=linescore,team`, { ttl: 8_000 });
      const favId = Settings.fav()?.id;
      const games = (data.dates || []).flatMap((d) => d.games || [])
        .sort((a, b) => {
          const f = (g) => +(g.teams.away.team.id === favId || g.teams.home.team.id === favId);
          const r = { live: 0, preview: 1, final: 2 };
          return f(b) - f(a) || (r[phaseOf(a.status)] ?? 3) - (r[phaseOf(b.status)] ?? 3) || String(a.gameDate).localeCompare(String(b.gameDate));
        });
      live = games.some((g) => phaseOf(g.status) === "live");
      const html = `<div class="d-head"><h3>Scores</h3><span>${esc(day.label === "Today" ? ymdLabel(day.ymd) : day.label)}</span></div>
        ${games.length ? games.map((g) => railRow(g, favId)).join("") : `<div class="d-empty">No games</div>`}
        <button class="d-more" data-tab-go="scores">All scores ›</button>`;
      if (html !== railKey) { left.innerHTML = html; railKey = html; }
    } catch (e) {
      if (!railKey) left.innerHTML = `<div class="d-head"><h3>Scores</h3></div><div class="d-empty">Couldn't load scores</div>`;
    }
    railTimer = setTimeout(drawRail, live ? 10_000 : 60_000);
  }

  // ---------- Right: your team ----------
  async function teamGames(id) {
    const today = etYmd();
    const [past, next] = await Promise.all([
      api(`/api/v1/schedule?sportId=1&teamId=${id}&startDate=${shiftYmd(today, -200)}&endDate=${today}&hydrate=linescore`, { ttl: 60_000 }).catch(() => ({})),
      api(`/api/v1/schedule?sportId=1&teamId=${id}&startDate=${shiftYmd(today, 1)}&endDate=${shiftYmd(today, 200)}`, { ttl: 600_000 }).catch(() => ({})),
    ]);
    const all = (d) => (d.dates || []).flatMap((x) => x.games || []);
    const p = all(past);
    const live = p.find((g) => phaseOf(g.status) === "live");
    const last = p.filter((g) => phaseOf(g.status) === "final").pop();
    const upcoming = p.find((g) => phaseOf(g.status) === "preview") || all(next).find((g) => phaseOf(g.status) === "preview");
    return { live, last, upcoming };
  }

  function gameCard(label, g, id) {
    if (!g) return "";
    const s = status(g), home = g.teams.home.team.id === id;
    const opp = teamMeta((home ? g.teams.away : g.teams.home).team);
    const me = home ? g.teams.home : g.teams.away, them = home ? g.teams.away : g.teams.home;
    const res = s.ph === "final" ? `<b class="${me.isWinner ? "pos" : "neg"}">${me.isWinner ? "W" : "L"} ${me.score}-${them.score}</b>`
      : s.ph === "live" ? `<b>${me.score ?? 0}-${them.score ?? 0}</b><em><i class="dot"></i>${esc(s.txt)}</em>` : `<em>${esc(ymdLabel(g.officialDate || g.gameDate.slice(0, 10)))} · ${esc(s.txt)}</em>`;
    return `<button class="dg ${s.ph}" data-pk="${g.gamePk}"><span class="dg-l">${esc(label)}</span>
      <span class="dg-o">${home ? "vs" : "@"} ${logoImg(opp)}${esc(opp.name || "")}</span><span class="dg-r">${res}</span></button>`;
  }

  async function drawTeam() {
    clearTimeout(teamTimer);
    if (!built) return;
    const fav = Settings.fav();
    if (!fav) { right.innerHTML = `<div class="d-empty">Pick a favorite team in Settings to see it here.</div>`; return; }
    const S = season();
    try {
      const [games, st, ld] = await Promise.all([
        teamGames(fav.id),
        api(`/api/v1/standings?leagueId=103,104&season=${S}&standingsTypes=regularSeason`, { ttl: 600_000 }).catch(() => ({})),
        api(`/api/v1/teams/${fav.id}/leaders?leaderCategories=battingAverage,homeRuns,runsBattedIn,earnedRunAverage,strikeouts,saves&season=${S}&limit=1`, { ttl: 3_600_000 }).catch(() => ({})),
      ]);
      const div = (st.records || []).find((r) => (r.teamRecords || []).some((t) => t.team.id === fav.id));
      const mine = div?.teamRecords.find((t) => t.team.id === fav.id);
      const divName = DIVISIONS.find((d) => d.id === div?.division?.id)?.name || "";
      const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th"}`;
      const head = `<div class="dt-head" data-team="${fav.id}" style="--tc:${fav.color || "#333"}">${logoImg(fav)}
        <div><h3>${esc(fav.name)}</h3><span>${mine ? `${mine.wins}-${mine.losses} · ${ord(+mine.divisionRank)} in the ${esc(divName)}` : ""}</span></div></div>`;
      const cards = gameCard("Live", games.live, fav.id) || "";
      const g2 = `${cards}${gameCard("Last game", games.last, fav.id)}${gameCard("Next game", games.upcoming, fav.id)}`;
      const table = div ? `<div class="d-sub">${esc(divName)}</div><div class="ds">${div.teamRecords.map((t) => {
        const m = teamMeta(t.team);
        return `<button class="ds-r ${t.team.id === fav.id ? "me" : ""}" data-team="${t.team.id}">${logoImg(m)}<b>${esc(m.name || "")}</b>
          <span>${t.wins}</span><span>${t.losses}</span><span>${t.gamesBack === "-" ? "–" : esc(t.gamesBack)}</span></button>`;
      }).join("")}</div>` : "";
      const want = [["battingAverage", "AVG", "hitting"], ["homeRuns", "HR", "hitting"], ["runsBattedIn", "RBI", "hitting"],
        ["earnedRunAverage", "ERA", "pitching"], ["strikeouts", "SO", "pitching"], ["saves", "SV", "pitching"]];
      const leaders = want.map(([cat, lab, grp]) => {
        const e = (ld.teamLeaders || []).find((x) => x.leaderCategory === cat && (!x.statGroup || x.statGroup === grp)) ||
          (ld.teamLeaders || []).find((x) => x.leaderCategory === cat);
        const p = e?.leaders?.[0];
        return p ? `<button class="dl" data-player="${p.person.id}"><img src="${headshot(p.person.id, 120)}" alt="" onerror="this.style.visibility='hidden'">
          <span><em>${lab}</em><b>${esc(lastName(p.person.fullName))}</b></span><strong>${esc(p.value)}</strong></button>` : "";
      }).join("");
      right.innerHTML = `${head}<div class="dg-list">${g2}</div>${table}
        ${leaders ? `<div class="d-sub">${S} team leaders</div><div class="dls">${leaders}</div>` : ""}
        <button class="d-more" data-team="${fav.id}">Team page ›</button>`;
      teamTimer = setTimeout(drawTeam, games.live ? 15_000 : 300_000);
    } catch (e) {
      right.innerHTML = `<div class="d-empty">Couldn't load ${esc(fav.name)}</div>`;
      teamTimer = setTimeout(drawTeam, 60_000);
    }
  }

  // ---------- Wiring ----------
  function click(e) {
    const g = e.target.closest("[data-pk]");
    if (g) return open("game", { pk: +g.dataset.pk });
    const p = e.target.closest("[data-player]");
    if (p) return open("player", { id: +p.dataset.player });
    const t = e.target.closest("[data-team]");
    if (t) return open("team", { id: +t.dataset.team });
    const go = e.target.closest("[data-tab-go]");
    if (go) document.querySelector(`#m-tabs [data-tab="${go.dataset.tabGo}"]`)?.click();
  }

  function build() {
    if (built || !WIDE.matches) return;
    built = true;
    left = document.createElement("aside"); left.id = "dash-left";
    right = document.createElement("aside"); right.id = "dash-right";
    left.onclick = right.onclick = click;
    document.getElementById("stage").append(left, right);
    document.body.classList.add("dash");
    drawRail(); drawTeam();
  }
  function teardown() {
    if (!built) return;
    built = false; clearTimeout(railTimer); clearTimeout(teamTimer); railKey = "";
    left.remove(); right.remove(); document.body.classList.remove("dash");
  }

  function init() {
    build();
    WIDE.addEventListener?.("change", () => (WIDE.matches ? build() : teardown()));
    document.addEventListener("favchange", () => { if (built) { railKey = ""; drawRail(); drawTeam(); } });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && built) { drawRail(); drawTeam(); } });
  }
  return { init, refresh: () => { drawRail(); drawTeam(); } };
})();
