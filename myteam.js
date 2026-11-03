// My team tab: everything about the favorite team (Settings) on one screen.
//   Game:     the live game (score, inning, bases, count), or the next game with probables, plus the last result.
//   Form:     the last 10 results as W/L chips.
//   Division: the race, the favorite highlighted.
//   Leaders:  the team's top hitters and pitchers this season.
//   News:     the latest MLB Trade Rumors stories about them.
// Tapping the game opens the game page, a team row opens that team, a leader opens his page, a story opens the reader.
const MyTeam = (() => {
  let timer = 0;
  let games = [];
  let lastKey = "";
  const el = () => document.getElementById("myteam-body");
  const fav = () => Settings.fav();
  const HIT = [["battingAverage", "AVG"], ["homeRuns", "HR"], ["runsBattedIn", "RBI"], ["onBasePlusSlugging", "OPS"]];
  const PIT = [["earnedRunAverage", "ERA"], ["strikeouts", "SO"], ["wins", "W"], ["saves", "SV"]];

  async function loadGames(t) {
    const season = currentSeason();
    const base = `/api/v1/schedule?sportId=1&teamId=${t.id}&season=${season}&gameType=${Season.info?.phase === "spring" ? "S," : ""}R,F,D,L,W`;
    const data = await apiTry([`${base}&hydrate=linescore,decisions,probablePitcher,seriesStatus`, base], { ttl: 15_000 });
    return (data.dates || []).flatMap((d) => d.games || []);
  }
  async function leaders(t, cats, group) {
    const season = Standings.season ? Standings.season() : currentSeason();
    const data = await api(`/api/v1/teams/${t.id}/leaders?leaderCategories=${cats.map((c) => c[0]).join(",")}&season=${season}&statGroup=${group}&limit=1`, { ttl: 3600_000 })
      .catch(() => ({}));
    const by = Object.fromEntries((data.teamLeaders || []).map((l) => [l.leaderCategory, l.leaders?.[0]]));
    return cats.map(([k, label]) => ({ label, lead: by[k] })).filter((x) => x.lead);
  }

  // ---- Panels ----
  const side = (g, k) => g.teams?.[k] || {};
  const tm = (s) => teamMeta(s.team);
  function liveCard(g) {
    const ls = g.linescore || {};
    const half = (ls.inningState || ls.inningHalf || "").replace(/^Bottom$/, "Bot");
    const row = (k) => `<div class="mt-tr">${logoImg(tm(side(g, k)))}<span class="nm">${esc(tm(side(g, k)).name)}</span><span class="sc">${num(ls.teams?.[k]?.runs)}</span></div>`;
    const p = ls.defense?.pitcher, b = ls.offense?.batter;
    return `<div class="mt-game live" data-game="${g.gamePk}" role="button">
      <div class="mt-k"><span class="st live"><i class="dot"></i>${esc(half)} ${esc(ls.currentInningOrdinal || "")}</span><span class="mt-k2">Live</span></div>
      ${row("away")}${row("home")}
      <div class="mt-foot">${Scores.bases(ls.offense || {})}${Scores.outsDots(ls.outs)}<span class="cnt">${ls.balls ?? 0}-${ls.strikes ?? 0}</span>
        <span class="who">${p ? `<b>P</b> ${esc(lastName(p.fullName))}` : ""}${b ? ` <b>AB</b> ${esc(lastName(b.fullName))}` : ""}</span></div></div>`;
  }
  function nextCard(g, t) {
    if (!g) {
      const i = Season.info;
      const when = i?.nextStart ? `Spring training opens ${ymdLabel(i.nextStart, { month: "long", day: "numeric" })}` : "No games scheduled";
      return `<div class="mt-game empty"><div class="mt-k"><span>Next game</span></div><div class="mt-big">${esc(when)}</div></div>`;
    }
    const home = side(g, "home").team?.id === t.id;
    const opp = tm(side(g, home ? "away" : "home"));
    const pr = (k) => side(g, k).probablePitcher;
    const date = g.officialDate || g.gameDate?.slice(0, 10);
    const when = g.status?.startTimeTBD ? "Time TBD" : timeLabel(g.gameDate);
    const mine = pr(home ? "home" : "away"), theirs = pr(home ? "away" : "home");
    return `<div class="mt-game" data-game="${g.gamePk}" role="button">
      <div class="mt-k"><span>Next game</span><span class="mt-k2">${esc(relDay(date))} · ${esc(when)}</span></div>
      <div class="mt-opp">${logoImg(opp)}<div><em>${home ? "vs" : "at"}</em><b>${esc(opp.name)}</b></div></div>
      <div class="mt-foot"><span class="muted">${mine || theirs ? `${esc(mine ? lastName(mine.fullName) : "TBD")} vs ${esc(theirs ? lastName(theirs.fullName) : "TBD")}` : "Probables not announced"}</span>
        <span class="muted mt-venue">${esc(g.venue?.name || "")}</span></div></div>`;
  }
  function lastCard(g, t) {
    if (!g) return "";
    const home = side(g, "home").team?.id === t.id;
    const me = side(g, home ? "home" : "away"), them = side(g, home ? "away" : "home");
    const won = me.isWinner;
    const d = g.decisions || {};
    return `<div class="mt-last" data-game="${g.gamePk}" role="button">
      <span class="wl ${won ? "w" : "l"}">${won ? "W" : "L"}</span>
      <span class="mt-ls">${me.score ?? ""}-${them.score ?? ""}</span>
      <span class="mt-lo">${home ? "vs" : "at"} ${logoImg(tm(them))} ${esc(tm(them).name)}</span>
      <span class="muted mt-ld">${esc(relDay(g.officialDate || ""))}${d.winner ? ` · W ${esc(lastName(d.winner.fullName))}` : ""}${d.loser ? ` · L ${esc(lastName(d.loser.fullName))}` : ""}</span></div>`;
  }
  function form(finals, t) {
    const last = finals.slice(-10);
    if (!last.length) return "";
    const chips = last.map((g) => {
      const home = side(g, "home").team?.id === t.id;
      const me = side(g, home ? "home" : "away"), them = side(g, home ? "away" : "home");
      return `<span class="chip ${me.isWinner ? "w" : "l"}" data-game="${g.gamePk}" title="${esc(`${me.score}-${them.score} ${home ? "vs" : "at"} ${tm(them).abbr}`)}">${me.isWinner ? "W" : "L"}</span>`;
    }).join("");
    const w = last.filter((g) => side(g, side(g, "home").team?.id === t.id ? "home" : "away").isWinner).length;
    return `<div class="mt-form"><span class="mt-h">Last ${last.length}</span><div class="chips">${chips}</div><span class="muted">${w}-${last.length - w}</span></div>`;
  }
  async function division(t) {
    const r = await Standings.recordFor(t.id).catch(() => null);
    if (!r) return `<div class="mt-panel"><div class="mt-h">Division</div><div class="muted">Standings aren't available yet.</div></div>`;
    const recs = (Standings.all()?.[r.div.id] || []);
    const l10 = (x) => { const s = (x.records?.splitRecords || []).find((y) => y.type === "lastTen"); return s ? `${s.wins}-${s.losses}` : ""; };
    const rows = recs.map((x) => {
      const m = teamMeta(x.team);
      return `<tr data-team="${m.id}" class="${m.id === t.id ? "mine" : ""}" style="${vars(m)}"><td class="tm"><span class="tmi">${logoImg(m)}<span>${esc(m.name)}</span></span></td>
        <td>${x.wins}-${x.losses}</td><td>${esc(x.gamesBack === "-" ? "–" : x.gamesBack)}</td><td>${l10(x)}</td><td>${esc(x.streak?.streakCode || "")}</td></tr>`;
    }).join("");
    return `<div class="mt-panel"><div class="mt-h">${esc(r.div.name || "Division")}</div>
      <table class="mt-div"><tr><th></th><th>W-L</th><th>GB</th><th>L10</th><th>Strk</th></tr>${rows}</table></div>`;
  }
  async function leadersPanel(t) {
    const [h, p] = await Promise.all([leaders(t, HIT, "hitting"), leaders(t, PIT, "pitching")]);
    if (!h.length && !p.length) return `<div class="mt-panel"><div class="mt-h">Team leaders</div><div class="muted">No stats yet this season.</div></div>`;
    const row = ({ label, lead }) => `<div class="mt-lead lnk" data-player="${lead.person?.id}">
      <img src="${headshot(lead.person?.id, 120)}" alt="" onerror="this.style.visibility='hidden'"><span class="lb">${label}</span>
      <span class="nm">${esc(lead.person?.fullName || "")}</span><span class="v">${esc(lead.value)}</span></div>`;
    return `<div class="mt-panel"><div class="mt-h">Team leaders</div><div class="mt-leads">${h.map(row).join("")}${p.map(row).join("")}</div></div>`;
  }
  function newsPanel(t) {
    const list = (typeof articles !== "undefined" ? articles : []).filter((a) => a.teams?.includes(t.abbr)).slice(0, 4);
    const rows = list.map((a) => `<div class="mt-story" data-link="${esc(a.link)}" role="button">
      ${a.image ? `<img src="${esc(a.image)}" alt="" onerror="this.remove()">` : `<span class="ph">${logoImg(t)}</span>`}
      <div><b>${esc(a.title)}</b><span class="muted">${esc(ago(a.date))}</span></div></div>`).join("");
    return `<div class="mt-panel"><div class="mt-h">Latest news</div>${rows || `<div class="muted">No recent stories about the ${esc(t.name)}.</div>`}</div>`;
  }

  async function draw() {
    const t = fav();
    const box = el();
    if (!t) {
      box.innerHTML = `<div class="empty"><div>Pick a favorite team in Settings to fill this tab.</div></div>`;
      return;
    }
    games = await loadGames(t);
    const live = games.find((g) => phaseOf(g.status) === "live");
    const finals = games.filter((g) => phaseOf(g.status) === "final");
    const next = games.find((g) => phaseOf(g.status) === "preview" && Date.parse(g.gameDate) > Date.now() - 3 * 3600_000);
    const [div, lead] = await Promise.all([division(t), leadersPanel(t)]);
    const html = `<div class="mt" style="${vars(t)}">
      <div class="mt-col mt-c1">${live ? liveCard(live) : nextCard(next, t)}${lastCard(finals[finals.length - 1], t)}${form(finals, t)}</div>
      <div class="mt-col">${div}</div>
      <div class="mt-col">${lead}</div>
      <div class="mt-col">${newsPanel(t)}</div></div>`;
    // Only touch the DOM when something changed, so a refresh doesn't flicker.
    if (html !== lastKey) { lastKey = html; box.innerHTML = html; }
    setUpdated("myteam", live ? "Live" : `Updated ${timeLabel(new Date())}`);
  }

  async function refresh() {
    clearTimeout(timer);
    try { await draw(); }
    catch (e) { console.warn(e); if (!lastKey) el().innerHTML = `<div class="empty"><div>Couldn't reach MLB. Retrying shortly.</div></div>`; }
    if (activeTab !== "myteam") return;
    const live = games.some((g) => phaseOf(g.status) === "live");
    timer = setTimeout(refresh, live ? 8_000 : 120_000);
  }

  function label() {
    const t = fav();
    document.querySelectorAll(".mt-tab-l").forEach((n) => { n.textContent = t ? t.name : "My team"; });
    document.querySelectorAll(".mt-tab-logo").forEach((n) => { n.innerHTML = t ? logoImg(t) : ""; });
  }

  function init() {
    el().addEventListener("click", (e) => {
      const s = e.target.closest("[data-link]");
      if (s) { const a = articles.find((x) => x.link === s.dataset.link); if (a) openReader(a); return; }
      const g = e.target.closest("[data-game]"); if (g) return Sheet.open("game", { pk: +g.dataset.game });
      const p = e.target.closest("[data-player]"); if (p) return Sheet.open("player", { id: +p.dataset.player });
      const tr = e.target.closest("[data-team]"); if (tr) return Sheet.open("team", { id: +tr.dataset.team });
    });
    dragScroll(el(), "x");
    document.addEventListener("favchange", () => { label(); lastKey = ""; if (activeTab === "myteam") refresh(); });
    label();
  }

  return {
    init,
    show() { lastKey = ""; refresh(); },
    hide() { clearTimeout(timer); },
    teamChanged() {},
    favChanged() { lastKey = ""; },
  };
})();
