// Player page, modeled on a Baseball Reference player page: photo and bio, a summary of this
// season and career, then year-by-year standard batting/pitching and this season's game log.
Sheet.register("player", async (root, { id }, alive) => {
  const [pd, sd] = await Promise.all([
    apiTry([`/api/v1/people/${id}?hydrate=currentTeam,draft,rosterEntries`, `/api/v1/people/${id}`], { ttl: 3600_000 }),
    apiTry([`/api/v1/people/${id}/stats?stats=yearByYear,career&group=hitting,pitching&sportId=1`,
      `/api/v1/people/${id}/stats?stats=yearByYear,career&group=hitting,pitching`], { ttl: 600_000 }).catch(() => ({ stats: [] })),
  ]);
  if (!alive()) return;
  const p = pd.people?.[0];
  if (!p) throw new Error("no player");

  const block = (type, group) => (sd.stats || []).find((s) => s.type?.displayName === type && s.group?.displayName === group)?.splits || [];
  const years = { hitting: block("yearByYear", "hitting").filter(mlbOnly), pitching: block("yearByYear", "pitching").filter(mlbOnly) };
  const career = { hitting: block("career", "hitting")[0]?.stat, pitching: block("career", "pitching")[0]?.stat };
  const isPitcher = p.primaryPosition?.abbreviation === "P";
  const isTwoWay = p.primaryPosition?.abbreviation === "TWP";
  const hasBat = years.hitting.some((s) => s.stat.plateAppearances > 0) && (!isPitcher || years.hitting.reduce((a, s) => a + (s.stat.plateAppearances || 0), 0) > 50);
  const hasPit = years.pitching.some((s) => s.stat.battersFaced > 0 || parseFloat(s.stat.inningsPitched) > 0);
  const groups = [];
  if (isPitcher || isTwoWay) { if (hasPit) groups.push("pitching"); if (hasBat) groups.push("hitting"); }
  else { if (hasBat) groups.push("hitting"); if (hasPit) groups.push("pitching"); }
  let tab = groups[0] || "hitting";

  const team = p.currentTeam ? teamMeta(p.currentTeam) : null;
  root.setAttribute("style", team ? vars(team) : "");

  // ---- Bio (Baseball Reference wording) ----
  const hand = { L: "Left", R: "Right", S: "Both" };
  const cm = (h) => { const m = /(\d+)'\s*(\d+)/.exec(h || ""); return m ? Math.round((+m[1] * 12 + +m[2]) * 2.54) : null; };
  const bio = [
    `<b>Position:</b> ${esc(p.primaryPosition?.name || "")}`,
    `<b>Bats:</b> ${hand[p.batSide?.code] || ""} <span class="dotsep"></span> <b>Throws:</b> ${hand[p.pitchHand?.code] || ""}`,
    p.height ? `${esc(heightBR(p.height))}, ${num(p.weight)}lb <span class="muted">(${cm(p.height)}cm, ${Math.round(p.weight * 0.4536)}kg)</span>` : "",
    p.birthDate ? `<b>Born:</b> ${esc(longDate(p.birthDate))}${p.birthCity ? ` in ${esc([p.birthCity, p.birthStateProvince, p.birthCountry].filter(Boolean).join(", "))}` : ""}${p.deathDate ? "" : ` <span class="muted">(Age ${ageToday(p.birthDate)})</span>`}` : "",
    p.deathDate ? `<b>Died:</b> ${esc(longDate(p.deathDate))}` : "",
    draftLine(p),
    p.mlbDebutDate ? `<b>Debut:</b> ${esc(longDate(p.mlbDebutDate))}` : `<b>Debut:</b> <span class="muted">Not yet in the majors</span>`,
    p.lastPlayedDate && !p.active ? `<b>Last game:</b> ${esc(longDate(p.lastPlayedDate))}` : "",
  ].filter(Boolean);

  // ---- Roster status (40-man, injured list, DFA...) from the latest roster entry ----
  const entry = (p.rosterEntries || []).slice().sort((x, y) => String(x.startDate || "").localeCompare(String(y.startDate || ""))).filter((r) => !r.endDate || r.isActive).pop();
  function statusLine() {
    if (!entry) return "";
    const code = entry.status?.code || "";
    const d = entry.status?.description || "";
    const tone = /^D\d|injur/i.test(`${code} ${d}`) ? "bad" : /^(DES|DFA)|design|release|waiv|outright/i.test(`${code} ${d}`) ? "warn" : code === "A" ? "ok" : "";
    const parts = [code === "A" ? "Active roster" : d];
    if (entry.isActiveFortyMan && code !== "A") parts.push("40-man");
    else if (entry.isActiveFortyMan === false && code === "A") parts.push("not on 40-man");
    return `<div class="p-status ${tone}">${esc(parts.filter(Boolean).join(" · "))}</div>`;
  }

  // ---- Latest MLB Trade Rumors story about him (from the widget's news feed) ----
  function latestStory() {
    const last = p.lastName || lastName(p.fullName || "");
    const hits = storyHits;
    if (!hits.length) return `<div class="p-news-h">Latest from MLB Trade Rumors</div><div class="p-nonews">No recent stories about ${esc(last)}.</div>`;
    // Up to two full story cards, then a line for a third if there is one.
    const cardFor = (a, i) => `<div class="p-news" role="button" data-story="${i}" style="animation-delay:${i * 60}ms">
        ${a.image ? `<div class="pn-img" style="background-image:url('${esc(a.image)}')"></div>` : ""}
        <div class="pn-txt"><div class="pn-kick">${a.teams?.[0] && byAbbr[a.teams[0]] ? `${logoImg(byAbbr[a.teams[0]])}${esc(byAbbr[a.teams[0]].name)} · ` : ""}${esc(ago(a.date))}</div>
          <h3>${esc(a.title)}</h3><p>${esc((a.body || [])[0] || "")}</p></div>
      </div>`;
    return `<div class="p-news-h">Latest from MLB Trade Rumors</div>
      ${hits.slice(0, 2).map(cardFor).join("")}
      ${hits[2] ? `<div class="pn-more" role="button" data-story="2"><span>${esc(hits[2].title)}</span><em>${esc(ago(hits[2].date))}</em></div>` : ""}`;
  }
  let storyHits = [];
  function drawStory() {
    const all = typeof articles !== "undefined" ? articles : [];
    const rx = new RegExp(`\\b${(p.fullName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    storyHits = all.filter((a) => rx.test(`${a.title} ${(a.body || []).join(" ")}`));
    root.querySelector(".p-sum").innerHTML = latestStory();
  }

  root.innerHTML = `<div class="p-left">
      <div class="p-top"><div class="p-photo"><img src="${headshot(id, 360)}" alt="" onerror="this.remove()"></div>
        <div class="p-id"><h1>${esc(p.fullName)}</h1>
          ${team ? `<div class="p-team lnk" data-team="${team.id}">${logoImg(team)}${esc(fullTeamName(p.currentTeam) || team.name)}</div>` : ""}
          <div class="p-num">${p.primaryNumber ? `#${esc(p.primaryNumber)} · ` : ""}${esc(p.primaryPosition?.abbreviation || "")}${p.active === false ? " · Retired" : ""}</div>
          ${statusLine()}</div></div>
      <div class="p-bio">${bio.map((b) => `<div>${b}</div>`).join("")}</div>
      <div class="p-sum"></div>
    </div>
    <div class="p-right"><div class="p-tabs"></div><div class="p-body vscroll"></div></div>`;
  const body = root.querySelector(".p-body");
  dragScroll(body, "y");
  drawStory();
  root.querySelector(".p-sum").onclick = (e) => {
    const s = e.target.closest("[data-story]");
    if (s && typeof openReader === "function") openReader(storyHits[+s.dataset.story]);
  };

  // ---- Tables ----
  function yearRows(group) {
    const ys = years[group];
    const rows = [];
    const bySeason = {};
    ys.forEach((s) => (bySeason[s.season] = bySeason[s.season] || []).push(s));
    for (const season of Object.keys(bySeason).sort()) {
      const list = bySeason[season];
      const total = list.find((s) => !s.team);
      const parts = list.filter((s) => s.team);
      const age = seasonAge(p.birthDate, +season);
      // Baseball Reference shows a "2TM" total first, then each team.
      if (total && parts.length > 1) rows.push({ ...total.stat, season, age, tm: `${parts.length}TM`, lg: lgOf(parts[0]) === lgOf(parts[parts.length - 1]) ? lgOf(parts[0]) : "MLB", __cls: "multi" });
      parts.forEach((s) => rows.push({ ...s.stat, season, age, tm: teamMeta(s.team).abbr, tmId: s.team.id, lg: lgOf(s), __cls: total && parts.length > 1 ? "part" : "" }));
      if (!parts.length && total) rows.push({ ...total.stat, season, age, tm: "", lg: lgOf(total) });
    }
    return rows;
  }
  const lead = [
    { h: "Season", k: "season", asc: true, cls: "left" },
    { h: "Age", k: "age", asc: true },
    { h: "Tm", k: "tm", asc: true, cls: "left", f: (r) => (r.tmId ? `<span class="lnk tmc" data-team="${r.tmId}">${logoImg(teamById[r.tmId] || {})}${esc(r.tm)}</span>` : esc(r.tm || "")) },
    { h: "Lg", k: "lg", asc: true },
  ];

  async function gameLog() {
    const season = currentSeason();
    const groupsToShow = groups.length ? groups : ["hitting"];
    const g = groupsToShow[0];
    const data = await api(`/api/v1/people/${id}/stats?stats=gameLog&group=${g}&season=${season}`, { ttl: 300_000 });
    if (!alive()) return;
    let splits = (data.stats?.[0]?.splits || []).slice().reverse();
    if (!splits.length) { body.innerHTML = `<div class="s-loading">No games in ${season}</div>`; return; }
    const rows = splits.map((s) => ({ ...s.stat, date: s.date, opp: teamMeta(s.opponent || {}), home: s.isHome,
      res: s.isWin == null ? "" : s.isWin ? "W" : "L", pk: s.game?.gamePk, __attrs: s.game?.gamePk ? `data-game="${s.game.gamePk}" role="button"` : "" }));
    const base = [
      { h: "Date", cls: "left", k: "date", f: (r) => esc(ymdLabel(r.date, { month: "short", day: "numeric" })) },
      { h: "", f: (r) => (r.home ? "" : "@") },
      { h: "Opp", cls: "left", f: (r) => `${logoImg(r.opp)} ${esc(r.opp.abbr || "")}` },
      { h: "Rslt", f: (r) => (r.res ? `<span class="${r.res === "W" ? "pos" : "neg"}">${r.res}</span>` : "") },
    ];
    const cols = g === "hitting"
      ? [...base, ...["plateAppearances:PA", "atBats:AB", "runs:R", "hits:H", "doubles:2B", "triples:3B", "homeRuns:HR", "rbi:RBI", "baseOnBalls:BB", "strikeOuts:SO", "stolenBases:SB", "hitByPitch:HBP"].map((x) => { const [k, h] = x.split(":"); return { h, k }; })]
      : [...base, { h: "Dec", f: (r) => (r.wins ? "W" : r.losses ? "L" : r.saves ? "S" : r.holds ? "H" : r.blownSaves ? "BS" : "") },
        ...["gamesStarted:GS", "inningsPitched:IP", "hits:H", "runs:R", "earnedRuns:ER", "baseOnBalls:BB", "strikeOuts:SO", "homeRuns:HR", "battersFaced:BF", "numberOfPitches:Pit", "strikes:Str"].map((x) => { const [k, h] = x.split(":"); return { h, k }; })];
    sortableTable(body, cols, rows, { cls: "glog" });
  }

  function draw() {
    const tabs = [...groups.map((g) => [g, g === "hitting" ? "Batting" : "Pitching"]), ["log", "Game log"]];
    root.querySelector(".p-tabs").innerHTML = seg(tabs, tab);
    body.scrollTop = 0;
    if (tab === "log") { body.innerHTML = `<div class="s-loading">Loading…</div>`; gameLog().catch(() => { body.innerHTML = `<div class="s-loading">No game log available</div>`; }); return; }
    if (!groups.length) { body.innerHTML = `<div class="s-loading">No major league stats yet</div>`; return; }
    const rows = yearRows(tab);
    const cols = [...lead, ...(tab === "hitting" ? BAT_COLS : PIT_COLS)];
    const car = career[tab];
    sortableTable(body, cols, rows, { cls: tab === "hitting" ? "bat yby" : "pit yby", foot: car ? [{ ...car, season: `${new Set(years[tab].map((s) => s.season)).size} Yrs`, age: "", tm: "", lg: "", __cls: "tot" }] : [] });
    // Show the most recent seasons.
    body.scrollTop = body.scrollHeight;
  }
  root.querySelector(".p-tabs").onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    tab = b.dataset.v; draw();
  };
  draw();
});

// Only major league rows (the API sometimes includes other levels).
function mlbOnly(s) { return !s.sport || s.sport.id === 1; }
function lgOf(s) {
  const n = s.league?.name || "";
  return /american/i.test(n) ? "AL" : /national/i.test(n) ? "NL" : s.league?.abbreviation || "";
}
function draftLine(p) {
  const d = (p.drafts || []).slice(-1)[0];
  if (!d) return "";
  const t = d.team ? teamMeta(d.team) : null;
  const round = /^\d+$/.test(d.pickRound) ? `${d.pickRound}${["th", "st", "nd", "rd"][(d.pickRound % 100 > 10 && d.pickRound % 100 < 14) ? 0 : d.pickRound % 10] || "th"} round` : `round ${d.pickRound}`;
  return `<b>Draft:</b> ${t ? `${esc(t.name)}, ` : ""}${round}${d.pickNumber ? `, pick ${d.pickNumber}` : ""}, ${d.year}${d.school?.name ? ` <span class="muted">from ${esc(d.school.name)}</span>` : ""}`;
}
