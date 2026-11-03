// Playoff bracket: the third Standings view. AL flows in from the left, NL from the right, World Series in the middle.
// Built from the postseason schedule; before the postseason starts it shows the bracket as the standings sit today.
// Seeds come from the regular season standings (division winners 1-3 by record, then wild cards 4-6).
const Bracket = (() => {
  const TYPES = ["F", "D", "L", "W"];
  const SHORT = { F: "WC", D: "DS", L: "CS", W: "WS" };
  const NEED = { F: 2, D: 3, L: 4, W: 4 };
  let timer = 0;

  async function fetchGames(season) {
    const d = await apiTry([
      `/api/v1/schedule/postseason/series?sportId=1&season=${season}&hydrate=team`,
      `/api/v1/schedule?sportId=1&season=${season}&gameTypes=F,D,L,W&hydrate=team`,
    ], { ttl: 30_000 });
    const games = d.series ? d.series.flatMap((s) => s.games || []) : (d.dates || []).flatMap((x) => x.games || []);
    // A postponed game shows up twice under one gamePk; keep the rescheduled copy.
    const byPk = new Map();
    games.filter((g) => TYPES.includes(g.gameType)).forEach((g) => {
      const old = byPk.get(g.gamePk);
      if (!old || isPostponed(old.status)) byPk.set(g.gamePk, g);
    });
    return [...byPk.values()].sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1));
  }

  // teamId -> { lg, seed } from the regular season standings.
  function seedMap() {
    const recs = Standings.all() || {};
    const out = {};
    for (const lg of ["AL", "NL"]) {
      const all = DIVISIONS.filter((d) => d.lg === lg).flatMap((d) => recs[d.id] || []);
      all.forEach((r) => { out[r.team.id] = { lg }; });
      const leaders = all.filter((r) => r.divisionRank === "1").sort((a, b) => +a.leagueRank - +b.leagueRank);
      const wild = all.filter((r) => r.divisionRank !== "1" && +r.wildCardRank >= 1)
        .sort((a, b) => +a.wildCardRank - +b.wildCardRank || +a.leagueRank - +b.leagueRank).slice(0, 3);
      [...leaders.slice(0, 3), ...wild].forEach((r, i) => { out[r.team.id].seed = i + 1; });
    }
    return out;
  }

  // Group games into series (one per round and pair of teams) and tally wins.
  function buildSeries(games, seeds) {
    const map = new Map();
    for (const g of games) {
      const a = g.teams.away.team, h = g.teams.home.team;
      const key = `${g.gameType}:${[a.id, h.id].sort().join("-")}`;
      if (!map.has(key)) map.set(key, { type: g.gameType, ids: [a.id, h.id], teams: { [a.id]: a, [h.id]: h }, games: [], wins: { [a.id]: 0, [h.id]: 0 } });
      const s = map.get(key);
      s.games.push(g);
      if (g.gamesInSeries) s.need = Math.floor(g.gamesInSeries / 2) + 1;
      if (phaseOf(g.status) === "final" && !isPostponed(g.status)) {
        const w = g.teams.away.isWinner ? a.id : g.teams.home.isWinner ? h.id
          : (g.teams.away.score ?? 0) > (g.teams.home.score ?? 0) ? a.id : (g.teams.home.score ?? 0) > (g.teams.away.score ?? 0) ? h.id : null;
        if (w) s.wins[w]++;
      }
    }
    return [...map.values()].map((s) => {
      s.need = s.need || NEED[s.type];
      s.winner = s.ids.find((id) => s.wins[id] >= s.need) || null;
      s.lg = s.type === "W" ? "" : seeds[s.ids[0]]?.lg || seeds[s.ids[1]]?.lg || leagueOf(s.teams[s.ids[0]]);
      return s;
    });
  }
  const leagueOf = (t) => (t?.league?.id === 103 ? "AL" : t?.league?.id === 104 ? "NL" : "");

  // A series that hasn't been scheduled yet: the teams we already know, TBD for the rest.
  const slot = (type, lg, ids, note = "") => ({ type, lg, ids, teams: {}, games: [], wins: {}, winner: null, need: NEED[type], placeholder: true, note });

  function layout(series, seeds) {
    const bySeed = (lg, n) => Object.keys(seeds).map(Number).find((id) => seeds[id].lg === lg && seeds[id].seed === n) || null;
    const has = (s, id) => id && s.ids.includes(id);
    const take = (list, pred) => { const i = list.findIndex(pred); return i < 0 ? null : list.splice(i, 1)[0]; };
    const out = {};
    for (const lg of ["AL", "NL"]) {
      const sd = (n) => bySeed(lg, n);
      const pool = (t) => series.filter((s) => s.type === t && s.lg === lg);
      const wc = pool("F"), ds = pool("D"), cs = pool("L");
      const wcTop = take(wc, (s) => has(s, sd(4)) || has(s, sd(5))) || take(wc, () => true) || slot("F", lg, [sd(4), sd(5)]);
      const wcBot = take(wc, (s) => has(s, sd(3)) || has(s, sd(6))) || take(wc, () => true) || slot("F", lg, [sd(3), sd(6)]);
      const dsTop = take(ds, (s) => has(s, sd(1)) || has(s, wcTop.winner)) || take(ds, () => true) || slot("D", lg, [sd(1), wcTop.winner]);
      const dsBot = take(ds, (s) => has(s, sd(2)) || has(s, wcBot.winner)) || take(ds, () => true) || slot("D", lg, [sd(2), wcBot.winner]);
      const lcs = take(cs, () => true) || slot("L", lg, [dsTop.winner, dsBot.winner]);
      out[lg] = { wcTop, wcBot, dsTop, dsBot, lcs };
    }
    out.ws = series.find((s) => s.type === "W") || slot("W", "", [out.AL.lcs.winner, out.NL.lcs.winner]);
    return out;
  }

  // Order a series' two teams: the better seed on top (in the World Series, AL on top).
  function order(s, seeds) {
    const ids = s.ids.slice();
    const rank = (id) => (id == null ? 99 : s.type === "W" ? (seeds[id]?.lg === "AL" ? 0 : 1) : seeds[id]?.seed ?? 50);
    return ids.sort((a, b) => rank(a) - rank(b));
  }

  function status(s) {
    if (s.placeholder) return "";
    const live = s.games.find((g) => phaseOf(g.status) === "live");
    const n = (g) => g.seriesGameNumber || s.games.indexOf(g) + 1;
    if (s.winner) {
      const lo = s.ids.find((id) => id !== s.winner);
      return `${esc(teamMeta(s.teams[s.winner]).abbr)} wins ${s.wins[s.winner]}-${s.wins[lo]}`;
    }
    if (live) return `<span class="dot"></span>Game ${n(live)} live`;
    const next = s.games.find((g) => phaseOf(g.status) === "preview" && !isPostponed(g.status));
    if (next) {
      const day = relDay(etYmd(new Date(next.gameDate)));
      const time = next.status?.startTimeTBD ? "TBD" : timeLabel(next.gameDate);
      return `Game ${n(next)} · ${esc(day)} ${esc(time)}`;
    }
    return "";
  }

  function teamRow(s, id, seeds) {
    if (id == null) return `<div class="bt tbd"><span class="sd"></span><span class="lg-ph"></span><span class="nm">TBD</span><span class="w"></span></div>`;
    const t = teamMeta(s.teams[id] || { id });
    const seed = seeds[id]?.seed;
    const lost = s.winner && s.winner !== id;
    const won = s.winner === id;
    const mine = selected === t.abbr ? "mine" : "";
    const w = s.placeholder ? "" : s.wins[id] ?? 0;
    return `<div class="bt ${lost ? "out" : ""} ${won ? "won" : ""} ${mine}" data-team="${t.id}" role="button" style="${vars(t)}">
      <span class="sd">${seed || ""}</span>${logoImg(t)}<span class="nm">${esc(t.name)}</span><span class="w">${w}</span></div>`;
  }

  function card(s, seeds, key, extra = "") {
    const [top, bot] = order(s, seeds);
    const round = s.type === "W" ? "World Series" : `${s.lg}${SHORT[s.type]}`;
    const last = [...s.games].reverse().find((g) => phaseOf(g.status) !== "preview") || s.games[0];
    const st = status(s);
    return `<div class="bc ${s.placeholder ? "pend" : ""} ${s.winner ? "done" : ""} ${extra}" data-k="${key}" ${last ? `data-game="${last.gamePk}"` : ""}>
      <div class="bh"><span>${round}</span><span class="st">${st || (s.placeholder ? `Best of ${s.need * 2 - 1}` : "")}</span></div>
      ${teamRow(s, top, seeds)}${teamRow(s, bot, seeds)}</div>`;
  }

  function champion(ws) {
    if (!ws.winner) return "";
    const t = teamMeta(ws.teams[ws.winner]);
    return `<div class="champ" style="${vars(t)}">${logoImg(t)}<div><div class="cl">World Series champions</div><div class="cn">${esc(fullTeamName(ws.teams[ws.winner]) || t.name)}</div></div></div>`;
  }

  function html(b, seeds, projected) {
    const side = (lg) => b[lg];
    const col = (label, cards) => `<div class="bcol"><div class="bch">${label}</div><div class="bcb">${cards}</div></div>`;
    const AL = side("AL"), NL = side("NL");
    return `<div class="bwrap ${projected ? "projected" : ""}">
      ${col("AL Wild Card", card(AL.wcTop, seeds, "AL-wcTop") + card(AL.wcBot, seeds, "AL-wcBot"))}
      ${col("AL Division Series", card(AL.dsTop, seeds, "AL-dsTop") + card(AL.dsBot, seeds, "AL-dsBot"))}
      ${col("ALCS", card(AL.lcs, seeds, "AL-lcs"))}
      ${col(projected ? "If the season ended today" : "World Series", card(b.ws, seeds, "ws", "ws") + champion(b.ws))}
      ${col("NLCS", card(NL.lcs, seeds, "NL-lcs"))}
      ${col("NL Division Series", card(NL.dsTop, seeds, "NL-dsTop") + card(NL.dsBot, seeds, "NL-dsBot"))}
      ${col("NL Wild Card", card(NL.wcTop, seeds, "NL-wcTop") + card(NL.wcBot, seeds, "NL-wcBot"))}
      <svg class="blines"></svg></div>`;
  }

  // Bracket lines, measured from the laid-out cards. The stage is CSS-scaled, so divide by the scale.
  function lines(box, b) {
    const wrap = box.querySelector(".bwrap"), svg = box.querySelector(".blines");
    if (!wrap || !svg) return;
    const s = typeof scale === "number" && scale > 0 ? scale : 1;
    const o = wrap.getBoundingClientRect();
    const r = (k) => {
      const e = wrap.querySelector(`[data-k="${k}"]`); if (!e) return null;
      const x = e.getBoundingClientRect();
      const rows = [...e.querySelectorAll(".bt")].map((t) => { const y = t.getBoundingClientRect(); return ((y.top + y.bottom) / 2 - o.top) / s; });
      return { l: (x.left - o.left) / s, r: (x.right - o.left) / s, t: (x.top - o.top) / s, b: (x.bottom - o.top) / s, rows };
    };
    // y of a card's top or bottom team row, and the point between them.
    const rowY = (c, which) => c.rows[which === "top" ? 0 : 1];
    const mid = (c) => (c.rows[0] + c.rows[1]) / 2;
    const paths = [];
    const link = (from, to, toY, lit, flip) => {
      if (!from || !to) return;
      const x1 = flip ? from.l : from.r, x2 = flip ? to.r : to.l, y1 = mid(from);
      const xm = (x1 + x2) / 2;
      paths.push(`<path class="${lit ? "lit" : ""}" d="M${x1} ${y1}H${xm}V${toY}H${x2}"/>`);
    };
    for (const lg of ["AL", "NL"]) {
      const f = lg === "NL", k = (n) => r(`${lg}-${n}`), x = b[lg];
      const dsT = k("dsTop"), dsB = k("dsBot"), lcs = k("lcs");
      link(k("wcTop"), dsT, dsT && rowY(dsT, "bot"), !!x.wcTop.winner, f);
      link(k("wcBot"), dsB, dsB && rowY(dsB, "bot"), !!x.wcBot.winner, f);
      link(dsT, lcs, lcs && rowY(lcs, "top"), !!x.dsTop.winner, f);
      link(dsB, lcs, lcs && rowY(lcs, "bot"), !!x.dsBot.winner, f);
      const ws = r("ws");
      link(lcs, ws, ws && mid(ws), !!x.lcs.winner, f);
    }
    svg.setAttribute("width", wrap.offsetWidth); svg.setAttribute("height", wrap.offsetHeight);
    svg.innerHTML = paths.join("");
  }

  let wired = false;
  function wire(box) {
    if (wired) return; wired = true;
    box.addEventListener("click", (e) => {
      if (!box.classList.contains("brmode")) return;
      const t = e.target.closest(".bt[data-team]");
      if (t) { Sheet.open("team", { id: +t.dataset.team }); return; }
      const c = e.target.closest(".bc[data-game]");
      if (c) Sheet.open("game", { pk: +c.dataset.game });
    });
  }

  async function render(box, season) {
    wire(box);
    clearTimeout(timer);
    if (!box.querySelector(".bwrap")) box.innerHTML = `<div class="empty"><div>Loading the bracket…</div></div>`;
    let games;
    try { games = await fetchGames(season); } catch (e) {
      console.warn(e);
      if (!box.querySelector(".bwrap")) box.innerHTML = `<div class="empty"><div>Couldn't reach MLB. Retrying shortly.</div></div>`;
      timer = setTimeout(() => box.classList.contains("brmode") && render(box, season), 60_000);
      return;
    }
    if (!box.classList.contains("brmode")) return;   // switched views while loading
    const seeds = seedMap();
    const b = layout(buildSeries(games, seeds), seeds);
    box.innerHTML = html(b, seeds, games.length === 0);
    requestAnimationFrame(() => lines(box, b));
    // Keep it current while games are on.
    const live = games.some((g) => phaseOf(g.status) === "live");
    timer = setTimeout(() => box.classList.contains("brmode") && render(box, season), live ? 30_000 : 5 * 60_000);
  }

  return { render, stop: () => clearTimeout(timer) };
})();
