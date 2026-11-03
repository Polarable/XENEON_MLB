// Scores tab: a day of games as cards (all teams), or a team's whole season when a team is picked.
// Tapping a card opens the game page (box score, linescore, plays) from game.js.
const Scores = (() => {
  const HYDRATE = "linescore,decisions,probablePitcher,seriesStatus";
  let day = null;            // ymd shown in league mode
  let autoDay = "";          // the ET date on which `day` was picked automatically ("" once the user picks one)
  let dates = [];            // every date with games this season, sorted
  let dateSet = new Set();
  let favSet = new Set();    // dates the favorite team plays
  let datesAt = 0, favKey = "";
  let calMonth = "";         // "yyyy-mm" shown in the calendar
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

  // The season's game days (for the calendar and the day buttons), plus the favorite team's.
  // Only the current season counts, so in the offseason nothing after the World Series is pickable
  // until next spring training begins and Season moves on by itself.
  const datesUrl = (a, b, extra = "") => `/api/v1/schedule?sportId=1&startDate=${a}&endDate=${b}${extra}&fields=dates,date,totalGames`;
  async function ensureDates() {
    const fav = Settings.fav();
    const fresh = Date.now() - datesAt < 6 * 3600_000;
    if (fresh && favKey === (fav?.abbr || "")) return dates;
    const info = await Season.load().catch(() => null) || Season.info;
    const today = etYmd();
    const a = info?.start || shiftYmd(today, -330);
    const b = info?.end || shiftYmd(today, 30);
    try {
      if (!fresh || !dates.length) {
        const data = await api(datesUrl(a, b), { ttl: 3600_000 });
        dates = (data.dates || []).filter((d) => d.totalGames > 0).map((d) => d.date).sort();
        dateSet = new Set(dates);
        datesAt = Date.now();
      }
      favSet = new Set();
      if (fav) {
        const data = await api(datesUrl(a, b, `&teamId=${fav.id}`), { ttl: 3600_000 });
        favSet = new Set((data.dates || []).filter((d) => d.totalGames > 0).map((d) => d.date));
      }
      favKey = fav?.abbr || "";
    } catch (e) { console.warn(e); }
    return dates;
  }
  const prevDay = (ymd) => { for (let i = dates.length - 1; i >= 0; i--) if (dates[i] < ymd) return dates[i]; return null; };
  const nextDay = (ymd) => dates.find((d) => d > ymd) || null;

  // Opening day: today if there are games, otherwise the most recent game day (or the next one if it's
  // only a few days off). In the offseason that's the last game of the World Series.
  async function pickDefaultDay() {
    const today = etYmd();
    await ensureDates();
    let prev, next;
    if (dates.length) {
      if (dateSet.has(today)) return today;
      prev = prevDay(today); next = nextDay(today);
    } else {
      const todays = await loadDay(today);
      if (todays.length) return today;
      prev = await findGameDay(today, -1).catch(() => null);
      next = await findGameDay(today, 1, 45).catch(() => null);
    }
    const soon = next && Date.parse(next) - Date.parse(today) < 4 * 864e5;
    return soon || !prev ? next || prev || today : prev;
  }

  async function loadTeamSeason(team) {
    const season = currentSeason();
    const base = `/api/v1/schedule?sportId=1&teamId=${team.id}&season=${season}&gameType=${Season.info?.phase === "spring" ? "S," : ""}R,F,D,L,W`;
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

  const isFav = (g) => { const f = Settings.fav(); return !!f && (g.away.t.id === f.id || g.home.t.id === f.id); };

  function card(g, i, teamMode) {
    const t = g.home.t;
    const note = seriesNote(g, teamMode);
    const fav = !teamMode && isFav(g) ? Settings.fav() : null;
    return `<div class="gcard ${g.phase}${fav ? " fav" : ""}" data-pk="${g.pk}" role="button"
      style="${vars(t)};${fav ? `--fav-rgb:${rgb(fav.bright)};` : ""}--delay:${Math.min(i, 12) * 25}ms">
      <div class="top">${statusLine(g)}<span class="note">${note}</span></div>
      ${teamRow(g.away, g)}${teamRow(g.home, g)}
      <div class="foot">${footLine(g)}</div></div>`;
  }

  // ---- Render ----
  function order(list) {
    const rank = { live: 0, preview: 1, off: 2, final: 3 };
    // On a finished day just keep start-time order; on a live day float live games first.
    const anyLive = list.some((g) => g.phase === "live" || g.phase === "preview");
    // The favorite team's games always lead.
    return [...list].sort((a, b) => isFav(b) - isFav(a) || (anyLive ? rank[a.phase] - rank[b.phase] : 0) || String(a.start).localeCompare(String(b.start)));
  }

  const prevScores = {};
  function draw(list, teamMode) {
    const box = el();
    const ctxKey = teamMode ? `team:${selected}` : `day:${day}:${Settings.fav()?.abbr || ""}`;
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
    const today = etYmd();
    const rel = [["Yesterday", shiftYmd(today, -1)], ["Today", today], ["Tomorrow", shiftYmd(today, 1)]];
    // In the offseason, "Latest" jumps straight back to the season's last game (the World Series finale).
    if (Season.info?.phase === "offseason" && dates.length) rel.push(["Latest", dates[dates.length - 1]]);
    const known = dates.length > 0;
    const can = (ymd) => !known || dateSet.has(ymd);
    const yr = day && day.slice(0, 4) !== today.slice(0, 4);
    const label = day ? ymdLabel(day, { weekday: "short", month: "short", day: "numeric", ...(yr ? { year: "numeric" } : {}) }) : "…";
    c.innerHTML = `<div class="seg daypick">${rel.map(([n, ymd]) =>
        `<button data-ymd="${ymd}" class="${ymd === day ? "on" : ""}" ${can(ymd) ? "" : "disabled"}>${n}</button>`).join("")}</div>
      <div class="datebar">
        <button class="arrow" data-d="-1" aria-label="Previous game day" ${known && day && !prevDay(day) ? "disabled" : ""}>‹</button>
        <button class="date" data-cal aria-haspopup="true"><svg class="cal-ic" viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="13.5" rx="2.5"/><path d="M2.5 8.5h15M6.5 2v4M13.5 2v4"/></svg>${esc(label)}</button>
        <button class="arrow" data-d="1" aria-label="Next game day" ${known && day && !nextDay(day) ? "disabled" : ""}>›</button></div>
      ${Season.info ? `<span class="ctx-label">${esc(Season.label())}</span>` : ""}`;
  }

  // ---- Calendar ----
  // One month at a time, with a chip per month of the season. Only days with games can be tapped;
  // a small dot marks the favorite team's games.
  const calEl = () => document.getElementById("cal");
  const monthsOfSeason = () => [...new Set(dates.map((d) => d.slice(0, 7)))];
  function drawCal() {
    const box = calEl();
    const months = monthsOfSeason();
    if (!months.includes(calMonth)) calMonth = months[months.length - 1] || etYmd().slice(0, 7);
    const [y, m] = calMonth.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const today = etYmd();
    const fav = Settings.fav();
    let cells = "";
    for (let i = 0; i < first.getUTCDay(); i++) cells += `<span class="cd blank"></span>`;
    for (let d = 1; d <= daysIn; d++) {
      const ymd = `${calMonth}-${String(d).padStart(2, "0")}`;
      const g = dateSet.has(ymd);
      const cls = ["cd", g ? "g" : "", ymd === day ? "sel" : "", ymd === today ? "today" : ""].filter(Boolean).join(" ");
      cells += g
        ? `<button class="${cls}" data-ymd="${ymd}">${d}${favSet.has(ymd) ? `<i></i>` : ""}</button>`
        : `<span class="${cls}">${d}</span>`;
    }
    const i = Season.info;
    const note = i?.phase === "offseason"
      ? (i.nextStart ? `Spring training opens ${ymdLabel(i.nextStart, { month: "short", day: "numeric" })}` : "See you in spring")
      : "";
    box.innerHTML = `<div class="cal-head"><span class="cal-title">${ymdLabel(`${calMonth}-01`, { month: "long", year: "numeric" })}</span>
        <span class="cal-phase">${esc([i ? `${i.season} ${Season.label().toLowerCase()}` : "", note].filter(Boolean).join(" · "))}</span></div>
      ${months.length > 1 ? `<div class="cal-months">${months.map((mo) =>
        `<button data-mo="${mo}" class="${mo === calMonth ? "on" : ""}">${ymdLabel(`${mo}-01`, { month: "short" })}</button>`).join("")}</div>` : ""}
      <div class="cal-wk">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="cal-grid">${cells}</div>
      ${fav && favSet.size ? `<div class="cal-foot" style="--fav-rgb:${rgb(fav.bright)}"><i></i>${esc(fav.name)} games</div>` : ""}`;
  }
  function openCal(open) {
    const box = calEl();
    if (!open) { box.classList.remove("open"); return; }
    if (!dates.length) return;
    calMonth = (day || "").slice(0, 7);
    drawCal();
    // Drop the calendar under the date button.
    const btn = document.querySelector("#ctx .datebar");
    const stage = document.getElementById("stage").getBoundingClientRect();
    const s = typeof scale === "number" && scale > 0 ? scale : 1;
    if (btn) box.style.left = `${Math.round((btn.getBoundingClientRect().left - stage.left) / s)}px`;
    box.classList.add("open");
  }
  function goTo(ymd) {
    if (!ymd || ymd === day) return;
    day = ymd; autoDay = ""; lastKey = ""; ctx();
    el().innerHTML = `<div class="empty"><div>Loading ${esc(ymdLabel(day))}…</div></div>`;
    refresh();
  }

  async function refresh() {
    if (busy) return; busy = true;
    const team = byAbbr[selected];
    try {
      if (team) games = await loadTeamSeason(team);
      else {
        await ensureDates();
        // Follow the calendar by itself (midnight, and the jump from offseason to spring training)
        // unless the user picked a day.
        if (!day || (autoDay && autoDay !== etYmd())) { day = await pickDefaultDay(); autoDay = etYmd(); lastKey = ""; }
        games = await loadDay(day);
      }
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
    if (!day) return;
    const to = dates.length ? (dir < 0 ? prevDay(day) : nextDay(day)) : await findGameDay(day, dir).catch(() => null);
    goTo(to);
  }

  function init() {
    dragScroll(el(), "x");
    el().addEventListener("click", (e) => {
      const c = e.target.closest(".gcard"); if (!c) return;
      Sheet.open("game", { pk: +c.dataset.pk });
    });
    document.getElementById("ctx").addEventListener("click", (e) => {
      if (activeTab !== "scores") return;
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.ymd) goTo(b.dataset.ymd);
      else if (b.dataset.d) step(+b.dataset.d);
      else if ("cal" in b.dataset) openCal(!calEl().classList.contains("open"));
    });
    const cal = document.createElement("div");
    cal.id = "cal"; cal.className = "pop";
    document.getElementById("stage").appendChild(cal);
    cal.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.mo) { calMonth = b.dataset.mo; drawCal(); }
      else if (b.dataset.ymd) { openCal(false); goTo(b.dataset.ymd); }
    });
    // Tap anywhere else to close it.
    document.addEventListener("pointerdown", (e) => {
      if (cal.classList.contains("open") && !cal.contains(e.target) && !e.target.closest("#ctx [data-cal]")) openCal(false);
    });
  }

  return {
    init,
    show() { ctx(); lastKey = ""; refresh(); },
    hide() { clearTimeout(timer); openCal(false); },
    favChanged() { favKey = "?"; lastKey = ""; if (activeTab === "scores") refresh(); },
    teamChanged() { lastKey = ""; games = []; el().innerHTML = ""; refresh(); },
    bases, outsDots,
  };
})();
