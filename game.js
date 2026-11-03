// Game page: scoreboard, linescore and decisions on the left; box score, scoring plays or
// play-by-play on the right. Live games check for updates every 3 seconds. Data: the MLB live feed.
Sheet.register("game", async (root, { pk }, alive) => {
  let view = null;            // chosen per game below
  let feed = null;
  let timer = 0;
  const gday = Gameday(pk);

  async function fetchFeed() {
    return api(`/api/v1.1/game/${pk}/feed/live`, { ttl: 2_000 });
  }
  // A tiny request that only returns the feed's last-updated stamp, so we can check every few
  // seconds and only download the full game when something actually happened.
  async function stamp() {
    const r = await fetch(`${API}/api/v1.1/game/${pk}/feed/live?fields=metaData,timeStamp`);
    return (await r.json()).metaData?.timeStamp;
  }

  // ---- Left panel ----
  function scoreboard(gd, ld) {
    const st = gd.status || {};
    const phase = isPostponed(st) ? "off" : phaseOf(st);
    const ls = ld.linescore || {};
    const teams = gd.teams || {};
    const dec = ld.decisions || {};
    const dateYmd = gd.datetime?.officialDate;
    const side = (k) => {
      const t = teamMeta(teams[k]);
      const runs = ls.teams?.[k]?.runs;
      const other = ls.teams?.[k === "away" ? "home" : "away"]?.runs;
      const lose = phase === "final" && runs < other;
      const rec = teams[k]?.record?.leagueRecord || teams[k]?.record;
      return `<div class="g-team ${lose ? "lose" : ""}" data-team="${t.id}" role="button">
        ${logoImg(t)}<div class="g-name"><div>${esc(fullTeamName(teams[k]) || t.name)}</div>
        <span>${rec && rec.wins != null ? `${rec.wins}-${rec.losses}` : ""}</span></div>
        <div class="g-runs">${phase === "preview" || phase === "off" ? "" : num(runs)}</div></div>`;
    };

    let status = st.detailedState || "";
    if (phase === "live" && ls.currentInning && !/delay/i.test(status)) status = `${ls.inningState || ls.inningHalf} ${ls.currentInningOrdinal}`;
    if (phase === "final" && ls.currentInning && ls.currentInning !== 9) status = `Final/${ls.currentInning}`;
    if (phase === "preview") status = st.startTimeTBD ? "Time TBD" : `${relDay(dateYmd)} · ${timeLabel(gd.datetime?.dateTime)}`;
    const series = gd.game?.type && gd.game.type !== "R" && gd.series ? ` · ${esc(gd.series?.description || "")}` : "";
    const seriesNote = gd.game?.type !== "R" && feed.gameData.seriesStatus?.result ? feed.gameData.seriesStatus.result : "";

    // Linescore: always at least 9 columns, like a real scoreboard.
    const inns = ls.innings || [];
    const n = Math.max(9, inns.length);
    const cells = (k) => Array.from({ length: n }, (_, i) => {
      const r = inns[i]?.[k]?.runs;
      return `<td>${r == null ? (inns[i] && k === "home" && i === inns.length - 1 && phase === "final" ? "X" : "") : r}</td>`;
    }).join("");
    const lineRow = (k) => `<tr><th>${esc(teamMeta(teams[k]).abbr)}</th>${cells(k)}
      <td class="tot">${num(ls.teams?.[k]?.runs)}</td><td class="tot">${num(ls.teams?.[k]?.hits)}</td><td class="tot">${num(ls.teams?.[k]?.errors)}</td></tr>`;
    const linescore = phase === "preview" || phase === "off" ? "" : `<table class="linescore ${n > 12 ? "tight" : ""}">
      <tr><th></th>${Array.from({ length: n }, (_, i) => `<td>${i + 1}</td>`).join("")}<td class="tot">R</td><td class="tot">H</td><td class="tot">E</td></tr>
      ${lineRow("away")}${lineRow("home")}</table>`;

    const pName = (p) => (p ? `<span class="lnk" data-player="${p.id}">${esc(p.fullName)}</span>` : "");
    const pitchRec = (p) => {
      if (!p) return "";
      const s = boxPlayer(p.id)?.seasonStats?.pitching;
      return s ? ` <span class="muted">(${s.wins}-${s.losses}, ${s.era})</span>` : "";
    };
    const saveRec = (p) => { const s = boxPlayer(p?.id)?.seasonStats?.pitching; return s ? ` <span class="muted">(${s.saves})</span>` : ""; };
    let lower = "";
    if (phase === "final") {
      lower = `<div class="g-dec">${dec.winner ? `<div><b>W</b>${pName(dec.winner)}${pitchRec(dec.winner)}</div>` : ""}
        ${dec.loser ? `<div><b>L</b>${pName(dec.loser)}${pitchRec(dec.loser)}</div>` : ""}
        ${dec.save ? `<div><b>SV</b>${pName(dec.save)}${saveRec(dec.save)}</div>` : ""}</div>`;
    } else if (phase === "live") {
      const o = ls.offense || {}, d = ls.defense || {};
      lower = `<div class="g-live">${Scores.bases(o)}<div class="g-count">${Scores.outsDots(ls.outs)}
        <span>${ls.balls ?? 0}-${ls.strikes ?? 0}, ${ls.outs ?? 0} out${ls.outs === 1 ? "" : "s"}</span></div></div>
        <div class="g-dec">${d.pitcher ? `<div><b>P</b>${pName(d.pitcher)}</div>` : ""}${o.batter ? `<div><b>AB</b>${pName(o.batter)}</div>` : ""}
        ${o.onDeck ? `<div><b>Due</b>${pName(o.onDeck)}</div>` : ""}</div>`;
    } else {
      const pp = gd.probablePitchers || {};
      lower = `<div class="g-dec"><div><b>${esc(teamMeta(teams.away).abbr)}</b>${pp.away ? pName(pp.away) : "TBD"}</div>
        <div><b>${esc(teamMeta(teams.home).abbr)}</b>${pp.home ? pName(pp.home) : "TBD"}</div></div>`;
    }

    // Game info from the box score (attendance, time, weather), as Baseball Reference lists it.
    const info = (ld.boxscore?.info || []).filter((x) => /^(Att|T|Weather|Venue)$/i.test(x.label));
    const facts = [gd.venue?.name, ...info.filter((x) => !/venue/i.test(x.label)).map((x) => `${x.label === "T" ? "Time" : x.label} ${String(x.value || "").replace(/\.$/, "")}`)].filter(Boolean);

    return `<div class="g-status ${phase}">${phase === "live" ? `<i class="dot"></i>` : ""}${esc(status)}${series}</div>
      <div class="g-sub">${esc(phase === "preview" ? "" : longDate(dateYmd))}${seriesNote ? ` · ${esc(seriesNote)}` : ""}</div>
      ${side("away")}${side("home")}${linescore}${lower}
      <div class="g-facts">${facts.map(esc).join(" · ")}</div>`;
  }

  const boxPlayer = (id) => {
    if (!id || !feed) return null;
    const t = feed.liveData?.boxscore?.teams || {};
    return t.away?.players?.[`ID${id}`] || t.home?.players?.[`ID${id}`] || null;
  };

  // ---- Box score (Baseball Reference layout: batting, notes, then pitching, per team) ----
  function batting(team) {
    const players = team.players || {};
    const rows = Object.values(players).filter((p) => p.battingOrder)
      .sort((a, b) => +a.battingOrder - +b.battingOrder)
      .map((p) => {
        const s = p.stats?.batting || {}, ss = p.seasonStats?.batting || {};
        const pos = (p.allPositions || []).map((x) => x.abbreviation).join("-") || p.position?.abbreviation || "";
        return { ...s, sub: +p.battingOrder % 100 !== 0, id: p.person.id, name: p.person.fullName, pos,
          seasonAvg: ss.avg, seasonObp: ss.obp, seasonSlg: ss.slg, seasonOps: ss.ops, note: s.note };
      });
    const tot = team.teamStats?.batting || {};
    const cols = [
      { h: `${esc(teamMeta(team.team).name)}`, cls: "name", f: (r) => r.__tot ? "Team totals" :
        `<span class="${r.sub ? "sub" : ""} lnk" data-player="${r.id}">${esc(r.note ? `${r.note}` : "")}${esc(r.name)}</span> <span class="ps">${esc(r.pos)}</span>` },
      { h: "AB", k: "atBats" }, { h: "R", k: "runs" }, { h: "H", k: "hits" }, { h: "RBI", k: "rbi" },
      { h: "BB", k: "baseOnBalls" }, { h: "SO", k: "strikeOuts" }, { h: "PA", k: "plateAppearances" },
      { h: "BA", f: (r) => rate(r.__tot ? tot.avg : r.seasonAvg), title: "Season batting average after this game" },
      { h: "OBP", f: (r) => rate(r.__tot ? tot.obp : r.seasonObp) }, { h: "SLG", f: (r) => rate(r.__tot ? tot.slg : r.seasonSlg) },
      { h: "OPS", f: (r) => rate(r.__tot ? tot.ops : r.seasonOps) },
    ];
    // Batting notes (2B, HR, RBI...) and fielding notes from the feed.
    const notes = (team.info || []).flatMap((sec) => (sec.fieldList || []).map((f) => `<b>${esc(f.label)}:</b> ${esc(String(f.value).replace(/\.$/, ""))}`));
    const foot = team.note || [];
    return table(cols, rows, { foot: [{ ...tot, __tot: true, __cls: "tot" }] }) +
      `${foot.length ? `<div class="bnotes">${foot.map((n) => `${esc(n.label)}-${esc(String(n.value).replace(/\.$/, ""))}`).join("; ")}</div>` : ""}` +
      `${notes.length ? `<div class="bnotes">${notes.join("; ")}</div>` : ""}`;
  }

  function pitching(team) {
    const players = team.players || {};
    const rows = (team.pitchers || []).map((id) => players[`ID${id}`]).filter(Boolean).map((p) => {
      const s = p.stats?.pitching || {}, ss = p.seasonStats?.pitching || {};
      return { ...s, id: p.person.id, name: p.person.fullName, seasonEra: ss.era, dec: s.note };
    });
    const tot = team.teamStats?.pitching || {};
    const cols = [
      { h: `${esc(teamMeta(team.team).name)} pitching`, cls: "name", f: (r) => r.__tot ? "Team totals" :
        `<span class="lnk" data-player="${r.id}">${esc(r.name)}</span>${r.dec ? ` <span class="ps">${esc(r.dec)}</span>` : ""}` },
      { h: "IP", k: "inningsPitched" }, { h: "H", k: "hits" }, { h: "R", k: "runs" }, { h: "ER", k: "earnedRuns" },
      { h: "BB", k: "baseOnBalls" }, { h: "SO", k: "strikeOuts" }, { h: "HR", k: "homeRuns" }, { h: "BF", k: "battersFaced" },
      { h: "Pit", k: "numberOfPitches" }, { h: "Str", k: "strikes" },
      { h: "ERA", f: (r) => rate(r.__tot ? "" : r.seasonEra), title: "Season ERA after this game" },
    ];
    return table(cols, rows, { foot: [{ ...tot, __tot: true, __cls: "tot" }] });
  }

  function boxView(ld) {
    const t = ld.boxscore?.teams || {};
    if (!t.away?.battingOrder?.length && !t.home?.battingOrder?.length) return lineupsView();
    return `<div class="box-cols">${["away", "home"].map((k) =>
      `<div class="box-col vscroll">${batting(t[k])}<div class="spacer"></div>${pitching(t[k])}</div>`).join("")}</div>`;
  }

  // Before first pitch: probable pitchers and lineups once they're posted.
  function lineupsView() {
    const gd = feed.gameData, t = feed.liveData?.boxscore?.teams || {};
    const col = (k) => {
      const pp = gd.probablePitchers?.[k];
      const team = t[k] || {};
      const order = (team.battingOrder || []).map((id) => team.players?.[`ID${id}`]).filter(Boolean);
      const tm = teamMeta(gd.teams[k]);
      return `<div class="box-col">
        <div class="pp">${pp ? `<img src="${headshot(pp.id, 240)}" alt="" onerror="this.style.visibility='hidden'">` : ""}
          <div><div class="muted">${esc(tm.name)} probable</div><div class="pp-name ${pp ? "lnk" : ""}" ${pp ? `data-player="${pp.id}"` : ""}>${esc(pp ? pp.fullName : "To be announced")}</div></div></div>
        ${order.length ? table([
          { h: "#", f: (r) => r.i + 1 },
          { h: `${esc(tm.name)} lineup`, cls: "name", f: (r) => `<span class="lnk" data-player="${r.p.person.id}">${esc(r.p.person.fullName)}</span>` },
          { h: "Pos", f: (r) => esc(r.p.position?.abbreviation || "") },
          { h: "BA", f: (r) => rate(r.p.seasonStats?.batting?.avg) }, { h: "OPS", f: (r) => rate(r.p.seasonStats?.batting?.ops) },
        ], order.map((p, i) => ({ p, i }))) : `<div class="muted pad">Lineup not posted yet</div>`}</div>`;
    };
    return `<div class="box-cols">${col("away")}${col("home")}</div>`;
  }

  // ---- Plays: scoring summary, or every play by half-inning ----
  function playsView(ld, scoringOnly, newestFirst) {
    const all = ld.plays?.allPlays || [];
    const list = scoringOnly ? (ld.plays?.scoringPlays || []).map((i) => all[i]).filter(Boolean) : all.filter((p) => p.result?.description);
    if (!list.length) return `<div class="s-loading">${scoringOnly ? "No runs scored yet" : "No plays yet"}</div>`;
    const teams = feed.gameData.teams;
    const groups = [];
    for (const p of list) {
      const k = `${p.about.halfInning}${p.about.inning}`;
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, half: p.about.halfInning, inn: p.about.inning, plays: [] });
      groups[groups.length - 1].plays.push(p);
    }
    const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
    return `<div class="plays hscroll">${(newestFirst ? groups.reverse() : groups).map((g) => {
      const bat = teamMeta(g.half === "top" ? teams.away : teams.home);
      return `<div class="pgroup"><div class="ph">${logoImg(bat)}${g.half === "top" ? "Top" : "Bottom"} ${ord(g.inn)}</div>
        ${(newestFirst ? g.plays.slice().reverse() : g.plays).map((p) => `<div class="play ${p.about.isScoringPlay ? "scoring" : ""}">
          <div class="pd">${esc(p.result.description)}</div>
          <div class="pm">${p.about.isScoringPlay || scoringOnly ? `<b>${esc(teamMeta(teams.away).abbr)} ${p.result.awayScore}, ${esc(teamMeta(teams.home).abbr)} ${p.result.homeScore}</b> · ` : ""}${p.count ? `${p.count.outs} out` : ""}</div></div>`).join("")}</div>`;
    }).join("")}</div>`;
  }

  // ---- Render ----
  function render() {
    const gd = feed.gameData, ld = feed.liveData || {};
    const phase = isPostponed(gd.status) ? "off" : phaseOf(gd.status);
    const views = phase === "preview" || phase === "off" ? [["box", "Lineups"]] : [["gameday", "Gameday"], ["box", "Box score"], ["scoring", "Scoring"], ["pbp", "All plays"]];
    // Live games open on Gameday; finished games on the box score (or whatever was picked last).
    if (!view) view = phase === "live" ? "gameday" : load("game-view") || "box";
    if (!views.some(([v]) => v === view)) view = views[0][0];
    const right = view === "box" ? boxView(ld) : view === "gameday" ? gday.html(feed) : playsView(ld, view === "scoring", phase === "live");
    const keep = [...root.querySelectorAll(".vscroll,.hscroll")].map((e) => [e.scrollTop, e.scrollLeft]);
    const home = teamMeta(gd.teams.home);
    root.innerHTML = `<div class="g-left" style="${vars(home)}">${scoreboard(gd, ld)}</div>
      <div class="g-right" style="${vars(home)}"><div class="g-tabs">${seg(views, view)}</div><div class="g-main">${right}</div></div>`;
    root.querySelectorAll(".vscroll").forEach((e) => dragScroll(e, "y"));
    root.querySelectorAll(".hscroll").forEach((e) => dragScroll(e, "x"));
    [...root.querySelectorAll(".vscroll,.hscroll")].forEach((e, i) => { if (keep[i]) { e.scrollTop = keep[i][0]; e.scrollLeft = keep[i][1]; } });
    if (view === "gameday") gday.mount(root, feed, render);
    root.querySelector(".g-tabs").onclick = (e) => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      view = b.dataset.v; save("game-view", view); render();
    };
  }

  feed = await fetchFeed();
  if (!alive()) return;
  render();
  gday.start(() => alive() && render(), () => alive() && phaseOf(feed.gameData.status) === "live");

  // Live games keep themselves current.
  const tick = async () => {
    if (!alive()) return;
    try {
      const ts = await stamp();
      if (!alive()) return;
      if (ts && ts !== feed.metaData?.timeStamp) {
        const f = await fetchFeed();
        if (!alive()) return;
        feed = f; render();
      }
    } catch {}
    // Every 3 seconds while live, every 30 seconds before first pitch.
    const ph = phaseOf(feed.gameData.status);
    if (ph !== "final") timer = setTimeout(tick, ph === "live" ? 3_000 : 30_000);
  };
  if (phaseOf(feed.gameData.status) !== "final") timer = setTimeout(tick, phaseOf(feed.gameData.status) === "live" ? 3_000 : 30_000);
  return () => { clearTimeout(timer); gday.stop(); };
});
