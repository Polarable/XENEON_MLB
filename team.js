// Rosters tab (all 30 teams by division) and the team page, laid out like a Baseball Reference
// team page: roster, standard batting, standard pitching, and schedule & results.
const Rosters = (() => {
  const el = () => document.getElementById("rosters-body");

  async function draw() {
    const recs = Standings.all();
    const recOf = (id) => {
      for (const d of DIVISIONS) { const r = (recs?.[d.id] || []).find((x) => x.team?.id === id); if (r) return r; }
      return null;
    };
    // Teams in each division in standings order when we have them, alphabetical otherwise.
    el().innerHTML = DIVISIONS.map((d) => {
      const order = recs?.[d.id]?.length ? recs[d.id].map((r) => teamById[r.team.id]).filter(Boolean)
        : TEAMS.filter((t) => divisionOf(t.id) === d.id);
      return `<div class="rdiv"><div class="rdh">${esc(d.name)}</div>${order.map((t) => {
        const r = recOf(t.id);
        return `<div class="rteam ${selected === t.abbr ? "mine" : ""}" data-team="${t.id}" role="button" style="${vars(t)}">
          ${logoImg(t)}<div><div class="rn">${esc(t.name)}</div><div class="rr">${r ? `${r.wins}-${r.losses}` : ""}</div></div></div>`;
      }).join("")}</div>`;
    }).join("");
  }

  function init() {
    el().addEventListener("click", (e) => {
      const t = e.target.closest("[data-team]"); if (t) Sheet.open("team", { id: +t.dataset.team });
    });
  }

  return {
    init,
    async show() {
      document.getElementById("ctx").innerHTML = `<span class="ctx-label">Tap a team for its roster and stats</span>`;
      draw();
      if (!Standings.all()) { try { await Standings.recordFor(0); } catch {} draw(); }
      setUpdated("rosters", "");
    },
    hide() {},
    teamChanged() { draw(); },
  };
})();

// Division for each team (used before standings load).
const DIV_OF = { 110: 201, 111: 201, 147: 201, 139: 201, 141: 201, 145: 202, 114: 202, 116: 202, 118: 202, 142: 202,
  117: 200, 108: 200, 133: 200, 136: 200, 140: 200, 144: 204, 146: 204, 121: 204, 143: 204, 120: 204,
  112: 205, 113: 205, 158: 205, 134: 205, 138: 205, 109: 203, 115: 203, 119: 203, 135: 203, 137: 203 };
const divisionOf = (id) => DIV_OF[id];

const heightBR = (h) => (h ? h.replace(/(\d+)'\s*(\d+)"?/, "$1-$2") : "");
const birthplace = (p) => [p.birthCity, p.birthStateProvince || p.birthCountry].filter(Boolean).join(", ");

// Batch-load people (bio details) in chunks the API is happy with.
async function peopleById(ids) {
  const out = {};
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 60) {
    const data = await api(`/api/v1/people?personIds=${uniq.slice(i, i + 60).join(",")}`, { ttl: 3600_000 });
    (data.people || []).forEach((p) => { out[p.id] = p; });
  }
  return out;
}

// ---- Column sets shared by the team and player pages (Baseball Reference "Standard" tables) ----
const BAT_COLS = [
  { h: "G", k: "gamesPlayed" }, { h: "PA", k: "plateAppearances" }, { h: "AB", k: "atBats" }, { h: "R", k: "runs" },
  { h: "H", k: "hits" }, { h: "2B", k: "doubles" }, { h: "3B", k: "triples" }, { h: "HR", k: "homeRuns" },
  { h: "RBI", k: "rbi" }, { h: "SB", k: "stolenBases" }, { h: "CS", k: "caughtStealing" }, { h: "BB", k: "baseOnBalls" },
  { h: "SO", k: "strikeOuts" },
  { h: "BA", k: "avg", f: (r) => rate(r.avg) }, { h: "OBP", k: "obp", f: (r) => rate(r.obp) },
  { h: "SLG", k: "slg", f: (r) => rate(r.slg) }, { h: "OPS", k: "ops", f: (r) => rate(r.ops) },
  { h: "TB", k: "totalBases" }, { h: "GDP", k: "groundIntoDoublePlay" }, { h: "HBP", k: "hitByPitch" },
  { h: "SH", k: "sacBunts" }, { h: "SF", k: "sacFlies" }, { h: "IBB", k: "intentionalWalks" },
];
const PIT_COLS = [
  { h: "W", k: "wins" }, { h: "L", k: "losses" },
  { h: "W-L%", sv: (r) => (r.wins + r.losses ? r.wins / (r.wins + r.losses) : null), f: (r) => (r.wins != null ? pct(r.wins, r.losses) : "") },
  { h: "ERA", k: "era", asc: true, f: (r) => rate(r.era) },
  { h: "G", k: "gamesPitched", f: (r) => num(r.gamesPitched ?? r.gamesPlayed) }, { h: "GS", k: "gamesStarted" },
  { h: "GF", k: "gamesFinished" }, { h: "CG", k: "completeGames" }, { h: "SHO", k: "shutouts" }, { h: "SV", k: "saves" },
  { h: "IP", k: "inningsPitched" }, { h: "H", k: "hits" }, { h: "R", k: "runs" }, { h: "ER", k: "earnedRuns" },
  { h: "HR", k: "homeRuns" }, { h: "BB", k: "baseOnBalls" }, { h: "IBB", k: "intentionalWalks" }, { h: "SO", k: "strikeOuts" },
  { h: "HBP", k: "hitByPitch" }, { h: "BK", k: "balks" }, { h: "WP", k: "wildPitches" }, { h: "BF", k: "battersFaced" },
  { h: "WHIP", k: "whip", asc: true, f: (r) => rate(r.whip) }, { h: "H9", k: "hitsPer9Inn", asc: true, f: (r) => rate(r.hitsPer9Inn) },
  { h: "HR9", k: "homeRunsPer9", asc: true, f: (r) => rate(r.homeRunsPer9) }, { h: "BB9", k: "walksPer9Inn", asc: true, f: (r) => rate(r.walksPer9Inn) },
  { h: "SO9", k: "strikeoutsPer9Inn", f: (r) => rate(r.strikeoutsPer9Inn) }, { h: "SO/W", k: "strikeoutWalkRatio", f: (r) => rate(r.strikeoutWalkRatio) },
];

Sheet.register("team", async (root, { id }, alive, state = {}) => {
  // Any past season can be picked (state.season sticks to this page, so Back returns to the same year).
  const latest = Standings.season();
  const season = state.season || latest;
  const past = season < latest;
  const t = teamById[id] || { id, abbr: "", name: "" };
  let tab = load("team-tab") || "roster";
  let rosterType = past ? "fullSeason" : load("roster-type") || (/-(1[1-2]|0[1-2])-/.test(etYmd()) ? "40Man" : "active");

  const [info, rec, coaches] = await Promise.all([
    api(`/api/v1/teams/${id}`, { ttl: 86_400_000 }).catch(() => ({})),
    past ? pastRecord(id, season).catch(() => null) : Standings.recordFor(id).catch(() => null),
    api(`/api/v1/teams/${id}/coaches?season=${season}`, { ttl: 86_400_000 }).catch(() => ({})),
  ]);
  if (!alive()) return;
  const team = info.teams?.[0] || {};
  const mgr = (coaches.roster || []).find((c) => /^manager$/i.test(c.job || ""));
  const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
  const facts = [
    rec && `<b>Record:</b> ${rec.wins}-${rec.losses} (${esc(rec.winningPercentage)})${+rec.divisionRank && rec.div?.name ? `, ${ord(+rec.divisionRank)} in ${esc(rec.div.name)}` : ""}`,
    mgr && `<b>Manager:</b> ${esc(mgr.person.fullName)}`,
    team.venue?.name && `<b>Ballpark:</b> ${esc(team.venue.name)}`,
  ].filter(Boolean);
  const facts2 = rec ? [
    `<b>Runs scored:</b> ${rec.runsScored}`, `<b>Runs allowed:</b> ${rec.runsAllowed}`,
    `<b>Pythag W-L:</b> ${pythag(rec)}`,
    rec.clinchIndicator || rec.clinched ? null : rec.eliminationNumber && rec.eliminationNumber !== "-" ? `<b>Elim #:</b> ${esc(rec.eliminationNumber)}` : null,
  ].filter(Boolean) : [];

  root.setAttribute("style", vars(t));
  root.innerHTML = `<div class="t-head">${logoImg(t, "t-logo")}
      <div class="t-title"><h1>${season} ${esc(fullTeamName(team) || t.name)}</h1>
        <div class="t-facts">${facts.join(`<span class="dotsep"></span>`)}</div>
        <div class="t-facts">${facts2.join(`<span class="dotsep"></span>`)}</div></div>
      <div class="t-tabs">${seg([["roster", "Roster"], ["batting", "Batting"], ["pitching", "Pitching"], ["schedule", "Schedule"]], tab)}</div>
    </div>
    <div class="t-sub"></div>
    <div class="t-season"><button data-y="-1" ${season <= (+team.firstYearOfPlay || 1876) ? "disabled" : ""} aria-label="Previous season">‹</button>
      <span>${season}</span><button data-y="1" ${past ? "" : "disabled"} aria-label="Next season">›</button></div>
    <div class="t-body vscroll"><div class="s-loading">Loading…</div></div>`;
  const body = root.querySelector(".t-body");
  const sub = root.querySelector(".t-sub");
  root.querySelector(".t-season").onclick = (e) => {
    const b = e.target.closest("[data-y]"); if (!b || b.disabled) return;
    state.season = Math.min(latest, season + +b.dataset.y);
    Sheet.refresh();
  };
  dragScroll(body, "y");

  async function drawRoster() {
    sub.innerHTML = seg([["40Man", "40-man"], ["active", "Active"], ["fullSeason", past ? "Everyone that season" : "Everyone this season"]], rosterType, "data-r");
    const data = await api(`/api/v1/teams/${id}/roster?rosterType=${rosterType}&season=${season}`, { ttl: 600_000 });
    const roster = data.roster || [];
    const people = await peopleById(roster.map((r) => r.person.id));
    if (!alive()) return;
    // Photo cards that fill the width, grouped pitchers, catchers, infielders, outfielders, then DH, by jersey number.
    const groups = [["Pitcher", "Pitchers"], ["Two-Way Player", "Two-way players"], ["Catcher", "Catchers"], ["Infielder", "Infielders"], ["Outfielder", "Outfielders"], ["Hitter", "Designated hitters"]];
    const byNum = (a, b) => (+a.jerseyNumber || 999) - (+b.jerseyNumber || 999);
    const sections = groups.map(([type, label]) => [label, roster.filter((r) => (r.position?.type || "") === type).sort(byNum)]);
    sections.push(["Other", roster.filter((r) => !groups.some(([g]) => g === r.position?.type)).sort(byNum)]);
    const card = (r) => {
      const p = people[r.person.id] || r.person;
      const pos = r.position?.abbreviation === "P" ? `${p.pitchHand?.code === "L" ? "LHP" : "RHP"}` : r.position?.abbreviation || "";
      const age = p.currentAge ?? ageToday(p.birthDate);
      const bt = p.batSide?.code && p.pitchHand?.code ? `B/T ${p.batSide.code}/${p.pitchHand.code}` : "";
      const st = r.status?.code && r.status.code !== "A" ? `<div class="rc-st">${esc(r.status.description || "")}</div>` : "";
      return `<div class="rcard" data-player="${r.person.id}" role="button">
        <img src="${headshot(r.person.id, 104)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="rc-id"><div class="rc-nm">${esc(p.fullName || "")}</div>
          <div class="rc-ln">${[r.jerseyNumber ? `#${esc(r.jerseyNumber)}` : "", esc(pos), age ? `${age}` : "", bt].filter(Boolean).join(" · ")}</div>${st}</div></div>`;
    };
    body.innerHTML = sections.filter(([, g]) => g.length).map(([label, g]) =>
      `<div class="rsec"><div class="rsec-h">${esc(label)} <span>${g.length}</span></div><div class="rgrid">${g.map(card).join("")}</div></div>`).join("")
      || `<div class="s-loading">No players on this roster</div>`;
  }

  async function drawStats(group) {
    sub.innerHTML = `<span class="ctx-label">Standard ${group === "hitting" ? "batting" : "pitching"}, ${season} regular season · tap a column to sort</span>`;
    const q = `stats=season&group=${group}&season=${season}&sportIds=1&gameType=R`;
    const [pl, tm] = await Promise.all([
      api(`/api/v1/stats?${q}&teamId=${id}&playerPool=ALL&limit=300`, { ttl: 600_000 }),
      api(`/api/v1/teams/${id}/stats?${q}`, { ttl: 600_000 }).catch(() => ({})),
    ]);
    const splits = pl.stats?.[0]?.splits || [];
    const people = await peopleById(splits.map((s) => s.player.id));
    if (!alive()) return;
    const isBat = group === "hitting";
    const rows = splits
      .filter((s) => (isBat ? s.stat.plateAppearances > 0 : true))
      .map((s) => ({ ...s.stat, id: s.player.id, name: s.player.fullName, pos: s.position?.abbreviation || "",
        age: seasonAge(people[s.player.id]?.birthDate, season), __attrs: `data-player="${s.player.id}" role="button"` }))
      .sort((a, b) => (isBat ? b.plateAppearances - a.plateAppearances : parseFloat(b.inningsPitched) - parseFloat(a.inningsPitched)));
    const tot = tm.stats?.[0]?.splits?.[0]?.stat;
    const cols = [
      { h: "Rk", nosort: true, f: (r, i) => (r.__tot ? "" : i + 1) },
      ...(isBat ? [{ h: "Pos", k: "pos", asc: true }] : []),
      { h: "Name", cls: "name", k: "name", asc: true, sv: (r) => r.name.split(" ").slice(1).join(" "), f: (r) => (r.__tot ? "Team totals" : `<span class="lnk">${esc(r.name)}</span>`) },
      { h: "Age", k: "age", asc: true, f: (r) => (r.__tot ? "" : num(r.age)) },
      ...(isBat ? BAT_COLS : PIT_COLS),
    ];
    if (!rows.length) { body.innerHTML = `<div class="s-loading">No ${isBat ? "batting" : "pitching"} stats for ${season} yet</div>`; return; }
    sortableTable(body, cols, rows, { cls: isBat ? "bat" : "pit", foot: tot ? [{ ...tot, __tot: true, __cls: "tot" }] : [] });
  }

  async function drawSchedule() {
    sub.innerHTML = `<span class="ctx-label">Schedule & results, ${season} · tap a game for its box score</span>`;
    const base = `/api/v1/schedule?sportId=1&teamId=${id}&season=${season}&gameType=R,F,D,L,W`;
    const data = await apiTry([`${base}&hydrate=decisions,linescore`, base], { ttl: 120_000 });
    if (!alive()) return;
    let w = 0, l = 0, n = 0;
    const rows = (data.dates || []).flatMap((d) => d.games || []).map((g) => {
      const home = g.teams.home.team.id === id;
      const me = g.teams[home ? "home" : "away"], opp = g.teams[home ? "away" : "home"];
      const phase = isPostponed(g.status) ? "off" : phaseOf(g.status);
      const post = g.gameType !== "R";
      if (!post && phase !== "off") n++;
      let res = "";
      if (phase === "final" && me.score != null) {
        const won = me.score > opp.score;
        if (!post) { won ? w++ : l++; }
        res = won ? "W" : "L";
      }
      const inns = g.linescore?.currentInning;
      return { g, home, me, opp, phase, res, gm: post ? (g.seriesDescription || "Post") : (phase === "off" ? "" : n),
        wl: phase === "final" && !post ? `${w}-${l}` : "", inn: phase === "final" && inns && inns !== 9 ? inns : "",
        __attrs: `data-game="${g.gamePk}" role="button"`, __cls: `${phase === "final" ? "" : "future"} ${post ? "post" : ""}` };
    });
    const dec = (r, k) => { const p = r.g.decisions?.[k]; return p ? esc(lastName(p.fullName)) : ""; };
    const cols = [
      { h: "Gm#", f: (r) => esc(String(r.gm)) },
      { h: "Date", cls: "left", f: (r) => esc(ymdLabel(r.g.officialDate, { weekday: "short", month: "short", day: "numeric" })) },
      { h: "", f: (r) => (r.home ? "" : "@") },
      { h: "Opp", cls: "left", f: (r) => { const o = teamMeta(r.opp.team); return `${logoImg(o)} ${esc(o.name)}`; } },
      { h: "W/L", f: (r) => (r.phase === "off" ? `<span class="muted">${esc(r.g.status.detailedState)}</span>` : r.res ? `<span class="${r.res === "W" ? "pos" : "neg"}">${r.res}</span>` : r.phase === "live" ? `<span class="live">Live</span>` : `<span class="muted">${esc(timeLabel(r.g.gameDate))}</span>`) },
      { h: "R", f: (r) => (r.phase === "final" || r.phase === "live" ? num(r.me.score) : "") },
      { h: "RA", f: (r) => (r.phase === "final" || r.phase === "live" ? num(r.opp.score) : "") },
      { h: "Inn", f: (r) => num(r.inn) }, { h: "W-L", f: (r) => r.wl },
      { h: "Win", cls: "left", f: (r) => dec(r, "winner") }, { h: "Loss", cls: "left", f: (r) => dec(r, "loser") },
      { h: "Save", cls: "left", f: (r) => dec(r, "save") },
    ];
    body.innerHTML = table(cols, rows, { cls: "sched" });
    // Start near the most recent game.
    const last = [...body.querySelectorAll("tbody tr")].filter((tr) => !tr.classList.contains("future")).pop();
    if (last) body.scrollTop = Math.max(0, last.offsetTop - 200);
  }

  async function draw() {
    root.querySelectorAll(".t-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === tab));
    body.innerHTML = `<div class="s-loading">Loading…</div>`;
    body.scrollTop = 0;
    try {
      if (tab === "roster") await drawRoster();
      else if (tab === "batting") await drawStats("hitting");
      else if (tab === "pitching") await drawStats("pitching");
      else await drawSchedule();
    } catch (e) {
      console.warn(e);
      if (alive()) body.innerHTML = `<div class="s-loading">Couldn't load this from MLB. Try again in a moment.</div>`;
    }
  }
  root.querySelector(".t-tabs").onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    tab = b.dataset.v; save("team-tab", tab); draw();
  };
  sub.onclick = (e) => {
    const b = e.target.closest("[data-r]"); if (!b) return;
    rosterType = b.dataset.r; save("roster-type", rosterType); draw();
  };
  await draw();
});

// A team's final record in a past season, shaped like Standings.recordFor's.
async function pastRecord(id, season) {
  const data = await api(`/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`, { ttl: 86_400_000 });
  for (const r of data.records || []) {
    const tr = (r.teamRecords || []).find((x) => x.team?.id === id);
    if (tr) return { ...tr, clinchIndicator: tr.clinchIndicator || "x", div: DIVISIONS.find((d) => d.id === r.division?.id) || { name: r.division?.name || "" } };
  }
  return null;
}

function pythag(r) {
  const rs = r.runsScored, ra = r.runsAllowed, g = r.wins + r.losses;
  if (!rs || !ra || !g) return "";
  const e = 1.83, p = Math.pow(rs, e) / (Math.pow(rs, e) + Math.pow(ra, e));
  const w = Math.round(p * g);
  return `${w}-${g - w}`;
}
