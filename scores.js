// Scores tab: a day of games as cards (all teams), or a team's whole season when a team is picked.
// Tapping a card opens the game page (box score, linescore, plays) from game.js.
const Scores = (() => {
  const HYDRATE = "linescore,decisions,probablePitcher,seriesStatus";
  let day = null;            // ymd shown in league mode
  let games = [];
  let timer = 0;
  let lastKey = "";
  let busy = false;

  const el = () => document.getElementById("scores-row");

  // ---- Data ----
  function norm(g) {
    const ls = g.linescore || {};
    const side = (k) => {
      const s = g.teams[k] || {};
      const t = teamMeta(s.team);
      return { t, score: s.score ?? ls.teams?.[k]?.runs, rec: s.leagueRecord, win: s.isWinner,
        prob: s.probablePitcher, hits: ls.teams?.[k]?.hits, errs: ls.teams?.[k]?.errors };
    };
    const st = g.status || {};
    return {
      pk: g.gamePk, raw: g, status: st, phase: isPostponed(st) ? "off" : phaseOf(st),
      date: g.officialDate || (g.gameDate || "").slice(0, 10), start: g.gameDate, tbd: st.startTimeTBD,
      away: side("away"), home: side("home"),
      inning: ls.currentInning, ord: ls.currentInningOrdinal, half: ls.inningHalf || ls.inningState,
      outs: ls.outs, balls: ls.balls, strikes: ls.strikes, offense: ls.offense || {}, defense: ls.defense || {},
      innings: (ls.innings || []).length || ls.scheduledInnings,
      dec: g.decisions || {}, series: g.seriesStatus, type: g.gameType, desc: g.seriesDescription,
      gameNo: g.seriesGameNumber, dh: g.doubleHeader !== "N" ? g.gameNumber : 0,
    };
  }

  async function loadDay(ymd) {
    const base = `/api/v1/schedule?sportId=1&date=${ymd}`;
    const data = await apiTry([`${base}&hydrate=${HYDRATE}`, base], { ttl: 4_000 });
    return (data.dates || []).flatMap((d) => d.games || []).map(norm);
  }

  // Nearest date with games before/after a day (skips off days and the offseason).
  async function findGameDay(from, dir, span = 120) {
    const a = dir < 0 ? shiftYmd(from, -span) : shiftYmd(from, 1);
    const b = dir < 0 ? shiftYmd(from, -1) : shiftYmd(from, span);
    const data = await api(`/api/v1/schedule?sportId=1&startDate=${a}&endDate=${b}&fields=dates,date,totalGames`, { ttl: 600_000 });
    const dates = (data.dates || []).filter((d) => d.totalGames > 0).map((d) => d.date);
    return dir < 0 ? dates[dates.length - 1] : dates[0];
  }

  // Opening day: today if there are games, otherwise the most recent game day (or the next one in spring).
  async function pickDefaultDay() {
    const today = etYmd();
    const todays = await loadDay(today);
    if (todays.length) return { ymd: today, games: todays };
    const prev = await findGameDay(today, -1).catch(() => null);
    const next = await findGameDay(today, 1, 45).catch(() => null);
    const soon = next && next > today && Date.parse(next) - Date.parse(today) < 4 * 864e5;
    const ymd = soon || !prev ? next || prev || today : prev;
    return { ymd, games: ymd === today ? [] : await loadDay(ymd) };
  }

  async function loadTeamSeason(team) {
    const season = currentSeason();
    const base = `/api/v1/schedule?sportId=1&teamId=${team.id}&season=${season}&gameType=R,F,D,L,W`;
    const data = await apiTry([`${base}&hydrate=decisions,linescore,probablePitcher,seriesStatus`, base], { ttl: 30_000 });
    return (data.dates || []).flatMap((d) => d.games || []).map(norm);
  }

  // ---- Cards ----
  function statusLine(g) {
    if (g.phase === "off") return `<span class="st">${esc(g.status.detailedState)}</span>`;
    if (g.phase === "final") {
      const extra = g.innings && g.innings !== 9 ? `/${g.innings}` : "";
      return `<span class="st">Final${extra}</span>`;
    }
    if (g.phase === "live") {
      if (/delay/i.test(g.status.detailedState)) return `<span class="st live">${esc(g.status.detailedState)}</span>`;
      const half = /mid|end/i.test(g.half || "") ? g.half : (g.half || "").startsWith("T") ? "Top" : "Bot";
      return `<span class="st live"><i class="dot"></i>${esc(half)} ${esc(g.ord || g.inning || "")}</span>`;
    }
    return `<span class="st">${g.tbd ? "Time TBD" : esc(timeLabel(g.start))}</span>`;
  }

  function seriesNote(g, teamMode) {
    const parts = [];
    if (teamMode) parts.push(ymdLabel(g.date));
    if (g.type && g.type !== "R" && g.series) parts.push(esc(g.series.shortDescription || g.desc || "") + (g.gameNo ? `, Gm ${g.gameNo}` : ""));
    if (g.dh) parts.push(`Game ${g.dh}`);
    return parts.join(" · ");
  }

  function teamRow(s, g) {
    const done = g.phase === "final";
    const lose = done && s.win === false;
    const rec = s.rec ? `${s.rec.wins}-${s.rec.losses}` : "";
    const score = g.phase === "preview" || g.phase === "off" ? "" : num(s.score);
    return `<div class="tr ${lose ? "lose" : ""}">
      ${logoImg(s.t)}<span class="nm">${esc(s.t.name)}</span><span class="rec">${rec}</span><span class="sc">${score}</span></div>`;
  }

  function bases(o) {
    // Three diamonds: second on top, third left, first right.
    const b = (on, cx, cy) => `<rect x="${cx - 5.5}" y="${cy - 5.5}" width="11" height="11" transform="rotate(45 ${cx} ${cy})" class="${on ? "on" : ""}"/>`;
    return `<svg class="bases" viewBox="0 0 46 34">${b(o.second, 23, 9)}${b(o.third, 11, 22)}${b(o.first, 35, 22)}</svg>`;
  }
  const outsDots = (n = 0) => `<span class="outs">${[0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;

  function footLine(g) {
    if (g.phase === "final") {
      const d = g.dec, nm = (p) => esc(lastName(p.fullName));
      return [d.winner && `<b>W</b> ${nm(d.winner)}`, d.loser && `<b>L</b> ${nm(d.loser)}`, d.save && `<b>SV</b> ${nm(d.save)}`]
        .filter(Boolean).join(`<span class="gap"></span>`) || (g.series?.result ? esc(g.series.result) : "");
    }
    if (g.phase === "live") {
      const p = g.defense.pitcher, b = g.offense.batter;
      return `${bases(g.offense)}${outsDots(g.outs)}<span class="cnt">${g.balls ?? 0}-${g.strikes ?? 0}</span>
        <span class="who">${p ? `<b>P</b> ${esc(lastName(p.fullName))}` : ""}${b ? `<span class="gap"></span><b>AB</b> ${esc(lastName(b.fullName))}` : ""}</span>`;
    }
    if (g.phase === "preview") {
      const a = g.away.prob, h = g.home.prob;
      if (!a && !h) return `<span class="muted">Probables not announced</span>`;
      return `${esc(a ? lastName(a.fullName) : "TBD")} <span class="muted">vs</span> ${esc(h ? lastName(h.fullName) : "TBD")}`;
    }
    return g.status.reason ? esc(g.status.reason) : "";
  }

  function card(g, i, teamMode) {
    const t = g.home.t;
    const note = seriesNote(g, teamMode);
    return `<div class="gcard ${g.phase}" data-pk="${g.pk}" role="button"
      style="${vars(t)};--delay:${Math.min(i, 12) * 25}ms">
      <div class="top">${statusLine(g)}<span class="note">${note}</span></div>
      ${teamRow(g.away, g)}${teamRow(g.home, g)}
      <div class="foot">${footLine(g)}</div></div>`;
  }

  // ---- Render ----
  function order(list) {
    const rank = { live: 0, preview: 1, off: 2, final: 3 };
    // On a finished day just keep start-time order; on a live day float live games first.
    const anyLive = list.some((g) => g.phase === "live" || g.phase === "preview");
    return [...list].sort((a, b) => (anyLive ? rank[a.phase] - rank[b.phase] : 0) || String(a.start).localeCompare(String(b.start)));
  }

  const prevScores = {};
  function draw(list, teamMode) {
    const box = el();
    const ctxKey = teamMode ? `team:${selected}` : `day:${day}`;
    const o = (g) => `${+!!g.offense.first}${+!!g.offense.second}${+!!g.offense.third}`;
    const key = ctxKey + list.map((g) => `${g.pk}:${g.phase}:${g.away.score}:${g.home.score}:${g.half}${g.inning}:${g.outs}:${g.balls}${g.strikes}:${o(g)}`).join("|");
    if (key === lastKey) return;
    const first = box.dataset.ctx !== ctxKey;
    lastKey = key;
    if (!list.length) {
      const team = byAbbr[selected];
      box.innerHTML = `<div class="empty">${team ? logoImg(team) : ""}<div>No games ${team ? `for the ${esc(team.name)} this season yet` : `on ${esc(ymdLabel(day))}`}</div></div>`;
      return;
    }
    const keepScroll = box.scrollLeft;
    box.innerHTML = `<div class="ggrid ${first ? "" : "settled"}">${list.map((g, i) => card(g, i, teamMode)).join("")}</div>`;
    // Refreshes don't replay the entrance; a changed score pops instead.
    if (!first) list.forEach((g) => ["away", "home"].forEach((k, j) => {
      const was = prevScores[`${g.pk}:${k}`];
      if (was != null && was !== g[k].score) box.querySelectorAll(`.gcard[data-pk="${g.pk}"] .sc`)[j]?.classList.add("bump");
    }));
    list.forEach((g) => { prevScores[`${g.pk}:away`] = g.away.score; prevScores[`${g.pk}:home`] = g.home.score; });
    if (first) {
      box.dataset.ctx = ctxKey;
      if (teamMode) {
        // Land on the most recent game (live or finished) with a little of the past visible.
        let idx = list.findIndex((g) => g.phase === "live");
        if (idx < 0) idx = list.map((g) => g.phase === "final").lastIndexOf(true);
        const col = Math.max(0, Math.floor(Math.max(0, idx) / 2) - 1);
        box.scrollLeft = col * (470 + 24);
      } else box.scrollLeft = 0;
    } else box.scrollLeft = keepScroll;
  }

  function ctx() {
    const team = byAbbr[selected];
    const c = document.getElementById("ctx");
    if (team) {
      c.innerHTML = `<span class="ctx-label">${currentSeason()} season</span>`;
      return;
    }
    c.innerHTML = `<div class="datebar">
      <button class="arrow" data-d="-1" aria-label="Previous game day">‹</button>
      <button class="date" data-d="0">${day ? esc(relDay(day)) : "…"}</button>
      <button class="arrow" data-d="1" aria-label="Next game day">›</button></div>`;
  }

  async function refresh() {
    if (busy) return; busy = true;
    const team = byAbbr[selected];
    try {
      if (team) games = await loadTeamSeason(team);
      else if (!day) { const r = await pickDefaultDay(); day = r.ymd; games = r.games; }
      else games = await loadDay(day);
      ctx();
      draw(team ? games : order(games), !!team);
      setUpdated("scores", games.some((g) => g.phase === "live") ? "Live" : `Updated ${timeLabel(new Date())}`);
    } catch (e) {
      console.warn(e);
      if (!games.length) el().innerHTML = `<div class="empty"><div>Couldn't reach MLB. Retrying shortly.</div></div>`;
      setUpdated("scores", "Couldn't reach MLB");
    } finally { busy = false; }
    schedule();
  }

  // Refresh every 8s while games are live (or about to start), every 5 minutes otherwise.
  function schedule() {
    clearTimeout(timer);
    if (activeTab !== "scores") return;
    const live = games.some((g) => g.phase === "live" || (g.phase === "preview" && Date.parse(g.start) - Date.now() < 15 * 60_000 && Date.parse(g.start) > Date.now() - 6 * 3600_000));
    timer = setTimeout(refresh, live ? 8_000 : 300_000);
  }

  async function step(dir) {
    if (dir === 0) { day = null; lastKey = ""; return refresh(); }
    const to = await findGameDay(day || etYmd(), dir).catch(() => null);
    if (!to) return;
    day = to; lastKey = ""; ctx();
    el().innerHTML = `<div class="empty"><div>Loading ${esc(ymdLabel(day))}…</div></div>`;
    refresh();
  }

  function init() {
    dragScroll(el(), "x");
    el().addEventListener("click", (e) => {
      const c = e.target.closest(".gcard"); if (!c) return;
      Sheet.open("game", { pk: +c.dataset.pk });
    });
    document.getElementById("ctx").addEventListener("click", (e) => {
      if (activeTab !== "scores") return;
      const b = e.target.closest("[data-d]"); if (b) step(+b.dataset.d);
    });
  }

  return {
    init,
    show() { ctx(); lastKey = ""; refresh(); },
    hide() { clearTimeout(timer); },
    teamChanged() { lastKey = ""; games = []; el().innerHTML = ""; refresh(); },
    bases, outsDots,
  };
})();
