// Player page, modeled on a Baseball Reference player page: photo and bio, a summary of this
// season and career, then year-by-year standard batting/pitching and this season's game log.
Sheet.register("player", async (root, { id }, alive, state = {}) => {
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
  let tab = state.tab && (state.tab === "log" || (state.tab === "savant" && groups.length) || groups.includes(state.tab)) ? state.tab : groups[0] || "hitting";

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
    if (!hits.length) return "";
    // Up to two full story cards, then a line for a third if there is one.
    const cardFor = (a, i) => `<div class="p-news" role="button" data-story="${i}" style="animation-delay:${i * 60}ms">
        ${a.image ? `<div class="pn-img" style="background-image:url('${esc(a.image)}')"></div>` : ""}
        <div class="pn-txt"><div class="pn-kick">${a.teams?.[0] && byAbbr[a.teams[0]] ? `${logoImg(byAbbr[a.teams[0]])}${esc(byAbbr[a.teams[0]].name)} · ` : ""}${esc(ago(a.date))}</div>
          <h3>${esc(a.title)}</h3><p>${esc((a.body || [])[0] || "")}</p></div>
      </div>`;
    // One story, then his highlights underneath (with no story, the highlights move up).
    return `<div class="p-news-h">Latest from MLB Trade Rumors</div>
      ${cardFor(hits[0], 0)}
      ${hits[1] ? `<div class="pn-more" role="button" data-story="1"><span>${esc(hits[1].title)}</span><em>${esc(ago(hits[1].date))}</em></div>` : ""}`;
  }

  // ---- Highlights: his best and most fun moments this season, each opening on Savant ----
  let hlTimer = 0;
  async function drawHighlights() {
    const box = root.querySelector(".p-hl");
    if (!box) return;
    const season = currentSeason();
    const list = await Savant.highlights(id, { full: p.fullName, last: p.lastName || lastName(p.fullName || ""), isPitcher, season }).catch(() => []);
    if (!alive() || !box.isConnected) return;
    box.innerHTML = list.length ? `<div class="p-news-h">Highlights <span class="muted">${season}</span></div>
      <div class="p-hl-list vscroll">${list.slice(0, 12).map((h, i) => `<a class="p-hl-row" href="${esc(h.url)}" target="_blank" rel="noopener" style="animation-delay:${i * 40}ms">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg><span class="t">${esc(h.title)}</span>
        <em>${h.date ? esc(ymdLabel(h.date.slice(0, 10), { month: "short", day: "numeric" })) : ""}</em></a>`).join("")}</div>` : "";
    const sc = box.querySelector(".p-hl-list");
    if (sc) dragScroll(sc, "y");
    // New plays keep coming during the season, so look again every few minutes.
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => alive() && drawHighlights(), 5 * 60_000);
  }
  let storyHits = [];
  function drawStory() {
    const all = typeof articles !== "undefined" ? articles : [];
    const rx = new RegExp(`\\b${(p.fullName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    storyHits = all.filter((a) => rx.test(`${a.title} ${(a.body || []).join(" ")}`));
    root.querySelector(".p-sum").innerHTML = `${latestStory()}<div class="p-hl"></div>`;
    drawHighlights();
  }

  // ---- Stat hero: this season and career, MLB.com style ----
  const HERO = {
    hitting: [["AVG", (r) => rate(r.avg)], ["HR", (r) => num(r.homeRuns)], ["RBI", (r) => num(r.rbi)], ["H", (r) => num(r.hits)], ["SB", (r) => num(r.stolenBases)], ["OPS", (r) => rate(r.ops)]],
    pitching: [["W-L", (r) => `${r.wins ?? 0}-${r.losses ?? 0}`], ["ERA", (r) => rate(r.era)], ["SO", (r) => num(r.strikeOuts)], ["IP", (r) => num(r.inningsPitched)], ["WHIP", (r) => rate(r.whip)], [(r) => (+r.saves ? "SV" : "G"), (r) => num(+r.saves ? r.saves : r.gamesPitched ?? r.gamesPlayed)]],
  };
  function statHero() {
    const g = groups[0];
    if (!g) return "";
    const ys = years[g];
    const last = ys.length ? ys[ys.length - 1].season : null;
    const seasonRows = ys.filter((x) => x.season === last);
    const cur = (seasonRows.find((x) => !x.team) || seasonRows[0])?.stat;
    const car = career[g];
    const row = (label, st) => st ? `<div class="ph-row"><span class="ph-l">${esc(label)}</span>${HERO[g].map(([h, f]) =>
      `<span class="ph-c"><em>${esc(typeof h === "function" ? h(st) : h)}</em><b>${f(st)}</b></span>`).join("")}</div>` : "";
    return `<div class="p-hero">${row(last || "", cur)}${row("Career", car)}</div>`;
  }
  // MLB.com's action banner when there is one; without it the page keeps the round headshot.
  const banner = `https://img.mlbstatic.com/mlb-photos/image/upload/t_16x9/t_w2208/v1/people/${id}/action/hero/current`;

  root.innerHTML = `<div class="p-left">
      <div class="p-banner"><img src="${banner}" alt="" referrerpolicy="no-referrer" onload="this.closest('.s-body')?.classList.add('has-banner')" onerror="this.parentNode.remove()"></div>
      <div class="p-top"><div class="p-photo"><img src="${headshot(id, 360)}" alt="" onerror="this.remove()"></div>
        <div class="p-id"><h1>${esc(p.fullName)}</h1>
          ${team ? `<div class="p-team lnk" data-team="${team.id}">${logoImg(team)}${esc(fullTeamName(p.currentTeam) || team.name)}</div>` : ""}
          <div class="p-num">${p.primaryNumber ? `#${esc(p.primaryNumber)} · ` : ""}${esc(p.primaryPosition?.abbreviation || "")}${p.active === false ? " · Retired" : ""}</div>
          ${statusLine()}
          ${typeof IS_MOBILE !== "undefined" && IS_MOBILE ? `<a class="p-cb" href="career/?mlbam=${id}&name=${encodeURIComponent(p.fullName || "")}&type=${groups[0] === "pitching" ? "pitcher" : "batter"}">Open in Career Builder</a>` : ""}</div></div>
      ${statHero()}
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

  // Phone: one card per season (newest first) instead of a wide table; multi-team years show each club.
  const CARD = {
    hitting: [["G", "gamesPlayed"], ["AB", "atBats"], ["H", "hits"], ["HR", "homeRuns"], ["RBI", "rbi"], ["SB", "stolenBases"], ["BB", "baseOnBalls"], ["SO", "strikeOuts"]],
    pitching: [["G", (r) => r.gamesPitched ?? r.gamesPlayed], ["GS", "gamesStarted"], ["IP", "inningsPitched"], ["SO", "strikeOuts"], ["BB", "baseOnBalls"], ["H", "hits"], ["HR", "homeRuns"], ["SV", "saves"]],
  };
  const SLASH = {
    hitting: [["AVG", "avg"], ["OBP", "obp"], ["SLG", "slg"], ["OPS", "ops"]],
    pitching: [["W-L", (r) => `${r.wins ?? 0}-${r.losses ?? 0}`], ["ERA", "era"], ["WHIP", "whip"], ["K/9", "strikeoutsPer9Inn"]],
  };
  const val = (r, k) => (typeof k === "function" ? k(r) : r[k]);
  function yearCards(group, rows) {
    const one = (r, title, sub, cls = "") => `<div class="yc ${cls}">
        <div class="yc-h"><b>${title}</b>${sub}</div>
        <div class="yc-slash">${SLASH[group].map(([h, k]) => `<span><em>${h}</em><b>${/^[\d.]+$/.test(String(val(r, k) ?? "")) && String(val(r, k)).includes(".") ? rate(val(r, k)) : num(val(r, k))}</b></span>`).join("")}</div>
        <div class="yc-grid">${CARD[group].map(([h, k]) => `<span><em>${h}</em>${num(val(r, k))}</span>`).join("")}</div></div>`;
    const seasons = {};
    rows.forEach((r) => (seasons[r.season] = seasons[r.season] || []).push(r));
    const car = career[group];
    const html = Object.keys(seasons).sort().reverse().map((yr) => {
      const list = seasons[yr];
      const top = list.find((r) => r.__cls === "multi") || list[0];
      const clubs = list.filter((r) => r.tmId);
      const sub = `<span class="yc-tm">${clubs.map((r) => `<span class="lnk" data-team="${r.tmId}">${logoImg(teamById[r.tmId] || {})}${esc(r.tm)}</span>`).join("")}<i>Age ${esc(top.age ?? "")}</i></span>`;
      const parts = list.length > 1 ? `<div class="yc-parts">${clubs.map((r) => `<div><span class="lnk" data-team="${r.tmId}">${logoImg(teamById[r.tmId] || {})}${esc(r.tm)}</span>
          ${SLASH[group].slice(0, 2).concat(CARD[group].slice(2, 4)).map(([h, k]) => `<span><em>${h}</em>${num(val(r, k))}</span>`).join("")}</div>`).join("")}</div>` : "";
      return one(top, esc(yr), sub).replace(/<\/div>$/, `${parts}</div>`);
    }).join("");
    return `<div class="ycards">${car ? one(car, "Career", `<span class="yc-tm"><i>${new Set(years[group].map((x) => x.season)).size} seasons</i></span>`, "car") : ""}${html}</div>`;
  }

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

  // ---- Savant: percentile rankings, spray chart / pitch movement, year by year ----
  const svTypes = groups.map((g) => (g === "pitching" ? "pitcher" : "batter"));
  function savantTab() {
    const type = svTypes.includes(state.svType) ? state.svType : svTypes[0] || "batter";
    const ys = [...new Set(years[type === "pitcher" ? "pitching" : "hitting"].map((s) => +s.season))];
    Savant.render(body, { id, type, years: ys, year: state.svYear, alive: () => alive() && tab === "savant",
      onYear: (y) => { state.svYear = y; savantTab(); } });
    if (svTypes.length > 1) {
      const sw = document.createElement("div");
      sw.className = "sv-type";
      sw.innerHTML = svTypes.map((t) => `<button data-st="${t}" class="${t === type ? "on" : ""}">${t === "pitcher" ? "Pitching" : "Batting"}</button>`).join("");
      sw.onclick = (e) => { const b = e.target.closest("[data-st]"); if (b) { state.svType = b.dataset.st; savantTab(); } };
      body.querySelector(".sv-years")?.before(sw);
    }
  }

  function draw() {
    const tabs = [...groups.map((g) => [g, g === "hitting" ? "Batting" : "Pitching"]), ["log", "Game log"], ...(groups.length ? [["savant", "Savant"]] : [])];
    root.querySelector(".p-tabs").innerHTML = seg(tabs, tab);
    body.scrollTop = 0;
    if (tab === "savant") { savantTab(); return; }
    if (tab === "log") { body.innerHTML = `<div class="s-loading">Loading…</div>`; gameLog().catch(() => { body.innerHTML = `<div class="s-loading">No game log available</div>`; }); return; }
    if (!groups.length) { body.innerHTML = `<div class="s-loading">No major league stats yet</div>`; return; }
    const rows = yearRows(tab);
    if (typeof IS_MOBILE !== "undefined" && IS_MOBILE) { body.innerHTML = yearCards(tab, rows); return; }
    const cols = [...lead, ...(tab === "hitting" ? BAT_COLS : PIT_COLS)];
    const car = career[tab];
    sortableTable(body, cols, rows, { cls: tab === "hitting" ? "bat yby" : "pit yby", foot: car ? [{ ...car, season: `${new Set(years[tab].map((s) => s.season)).size} Yrs`, age: "", tm: "", lg: "", __cls: "tot" }] : [] });
    // Show the most recent seasons.
    body.scrollTop = body.scrollHeight;
  }
  root.querySelector(".p-tabs").onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    tab = state.tab = b.dataset.v; draw();
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
