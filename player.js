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
  // Minor league and international/winter league stats load alongside (Baseball Reference shows both).
  const otherP = loadOtherLevels(id);
  const mlbHas = (g) => g === "hitting" ? years.hitting.some((s) => s.stat.plateAppearances > 0) : years.pitching.some((s) => s.stat.battersFaced > 0 || parseFloat(s.stat.inningsPitched) > 0);
  let other = null;
  if (!mlbHas("hitting") && !mlbHas("pitching")) { other = await otherP; if (!alive()) return; }
  const isPitcher = p.primaryPosition?.abbreviation === "P";
  const isTwoWay = p.primaryPosition?.abbreviation === "TWP";
  const anyBat = (list) => list.some((s) => s.stat.plateAppearances > 0) && (!isPitcher || list.reduce((a, s) => a + (s.stat.plateAppearances || 0), 0) > 50);
  const anyPit = (list) => list.some((s) => s.stat.battersFaced > 0 || parseFloat(s.stat.inningsPitched) > 0);
  const mlbGroups = [mlbHas("hitting") && anyBat(years.hitting) && "hitting", mlbHas("pitching") && "pitching"].filter(Boolean);
  const otherAll = (g) => other ? Object.values(other).flatMap((L) => L[g]) : [];
  const hasBat = mlbGroups.includes("hitting") || anyBat(otherAll("hitting"));
  const hasPit = mlbGroups.includes("pitching") || anyPit(otherAll("pitching"));
  const groups = [];
  if (isPitcher || isTwoWay) { if (hasPit) groups.push("pitching"); if (hasBat) groups.push("hitting"); }
  else { if (hasBat) groups.push("hitting"); if (hasPit) groups.push("pitching"); }
  let tab = state.tab && (state.tab === "log" || state.tab === "highlights" || (state.tab === "savant" && mlbGroups.length) || groups.includes(state.tab)) ? state.tab : groups[0] || "hitting";

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
    const box = body;
    if (tab !== "highlights") return;
    const season = currentSeason();
    const list = await Savant.highlights(id, { full: p.fullName, last: p.lastName || lastName(p.fullName || ""), isPitcher, season }).catch(() => []);
    if (!alive() || tab !== "highlights") return;
    box.innerHTML = list.length ? `<div class="p-news-h">${season} highlights</div>
      <div class="p-hl-list vscroll">${list.slice(0, 12).map((h, i) => `<a class="p-hl-row" href="${esc(h.url)}" target="_blank" rel="noopener" style="animation-delay:${i * 40}ms">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg><span class="t">${esc(h.title)}</span>
        <em>${h.date ? esc(ymdLabel(h.date.slice(0, 10), { month: "short", day: "numeric" })) : ""}</em></a>`).join("")}</div>` : `<div class="s-loading">No highlights from ${season} yet</div>`;
    // New plays keep coming during the season, so look again every few minutes.
    clearTimeout(hlTimer);
    hlTimer = setTimeout(() => alive() && tab === "highlights" && drawHighlights(), 5 * 60_000);
  }
  let storyHits = [];
  function drawStory() {
    const all = typeof articles !== "undefined" ? articles : [];
    const rx = new RegExp(`\\b${(p.fullName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    storyHits = all.filter((a) => rx.test(`${a.title} ${(a.body || []).join(" ")}`));
    root.querySelector(".p-sum").innerHTML = latestStory();
  }

  // ---- Stat hero: this season and career, MLB.com style ----
  const HERO = {
    hitting: [["AVG", (r) => rate(r.avg)], ["HR", (r) => num(r.homeRuns)], ["RBI", (r) => num(r.rbi)], ["H", (r) => num(r.hits)], ["SB", (r) => num(r.stolenBases)], ["OPS", (r) => rate(r.ops)]],
    pitching: [["W-L", (r) => `${r.wins ?? 0}-${r.losses ?? 0}`], ["ERA", (r) => rate(r.era)], ["SO", (r) => num(r.strikeOuts)], ["IP", (r) => num(r.inningsPitched)], ["WHIP", (r) => rate(r.whip)], [(r) => (+r.saves ? "SV" : "G"), (r) => num(+r.saves ? r.saves : r.gamesPitched ?? r.gamesPlayed)]],
  };
  function statHero() {
    const g = groups[0];
    if (!g) return "";
    if (!mlbGroups.includes(g)) {
      // No major league line yet: show his latest minor (or other) league season, level by level.
      const lv = levelsWith(g).filter((k) => k !== "mlb")[0];
      const rs = lv ? otherRows(lv, g).filter((r) => r.__cls !== "part") : [];
      const lastYr = rs.length ? rs[rs.length - 1].season : null;
      const row = (r) => `<div class="ph-row"><span class="ph-l">${esc(`${r.season} ${r.lev}`)}</span>${HERO[g].map(([h, f]) =>
        `<span class="ph-c"><em>${esc(typeof h === "function" ? h(r) : h)}</em><b>${f(r)}</b></span>`).join("")}</div>`;
      return lastYr ? `<div class="p-hero">${rs.filter((r) => r.season === lastYr).slice(-2).reverse().map(row).join("")}</div>` : "";
    }
    const ys = years[g];
    const last = ys.length ? ys[ys.length - 1].season : null;
    const seasonRows = ys.filter((x) => x.season === last);
    const cur = (seasonRows.find((x) => !x.team) || seasonRows[0])?.stat;
    const car = career[g];
    const row = (label, st) => st ? `<div class="ph-row"><span class="ph-l">${esc(label)}</span>${HERO[g].map(([h, f]) =>
      `<span class="ph-c"><em>${esc(typeof h === "function" ? h(st) : h)}</em><b>${f(st)}</b></span>`).join("")}</div>` : "";
    return `<div class="p-hero">${row(last || "", cur)}${row("Career", car)}</div>`;
  }
  // Banner like the Career Builder: MLB.com's action photos in order, and a team-color wash when none exist.
  const banners = [
    `https://img.mlbstatic.com/mlb-photos/image/upload/t_16x9/t_w2208/v1/people/${id}/action/hero/current`,
    `https://img.mlbstatic.com/mlb-photos/image/upload/w_1800,q_auto:best/v1/people/${id}/action/hero/current`,
    `https://midfield.mlbstatic.com/v1/people/${id}/spots/1200`,
    `https://img.mlbstatic.com/mlb-photos/image/upload/w_1800,q_auto:best/v1/people/${id}/action/1/current`,
  ];

  root.innerHTML = `<div class="p-left">
      <div class="p-banner plain" style="--tc:${team?.color || "#333"}"><img alt="" referrerpolicy="no-referrer"></div>
      <div class="p-top"><div class="p-photo"><img src="${headshot(id, 360)}" alt="" onerror="this.remove()"></div>
        <div class="p-id"><h1><span class="fn">${esc((p.fullName || "").split(" ")[0])}</span> <span class="ln">${esc((p.fullName || "").split(" ").slice(1).join(" "))}</span></h1>
          ${team ? `<div class="p-team lnk" data-team="${team.id}">${logoImg(team)}${esc(fullTeamName(p.currentTeam) || team.name)}</div>` : ""}
          <div class="p-num">${p.primaryNumber ? `#${esc(p.primaryNumber)} · ` : ""}${esc(p.primaryPosition?.abbreviation || "")}${p.active === false ? " · Retired" : ""}</div>
          ${statusLine()}</div></div>
      ${statHero()}
      <div class="p-bio">${bio.map((b) => `<div>${b}</div>`).join("")}</div>
      ${typeof IS_MOBILE !== "undefined" && IS_MOBILE ? `<a class="p-cb" href="career/?mlbam=${id}&name=${encodeURIComponent(p.fullName || "")}&type=${groups[0] === "pitching" ? "pitcher" : "batter"}">
        <span><b>Career Builder</b><em>Build a career card for ${esc(p.fullName || "")}</em></span><i aria-hidden="true">›</i></a>` : ""}
      <div class="p-sum"></div>
    </div>
    <div class="p-right"><div class="p-tabs"><div class="p-tabseg"></div><div class="p-lvl"></div></div><div class="p-body vscroll"></div></div>`;
  // The phone has no room beside the tabs, so the level switch gets its own row under them.
  if (typeof IS_MOBILE !== "undefined" && IS_MOBILE) root.querySelector(".p-tabs").after(root.querySelector(".p-lvl"));
  {
    const box = root.querySelector(".p-banner"), img = box.querySelector("img");
    const phone = typeof IS_MOBILE !== "undefined" && IS_MOBILE;
    if (phone) root.classList.add("has-banner");          // the phone always shows the banner (photo or team wash)
    let k = 0;
    img.onload = () => { if (!box.isConnected) return; if (img.naturalWidth > 400) { box.classList.remove("plain"); root.classList.add("has-banner"); } else img.onerror(); };
    img.onerror = () => { if (!box.isConnected) return; if (++k < banners.length) img.src = banners[k]; else { img.remove(); box.classList.add("plain"); if (!phone) box.remove(); } };
    img.src = banners[0];
  }
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
    const sport = mlbGroups.includes(g) ? 1 : latestSport(g);
    const data = await api(`/api/v1/people/${id}/stats?stats=gameLog&group=${g}&season=${season}${sport !== 1 ? `&sportId=${sport}` : ""}`, { ttl: 300_000 });
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
    if (typeof IS_MOBILE !== "undefined" && IS_MOBILE) { body.innerHTML = logCards(g, rows); return; }
    sortableTable(body, cols, rows, { cls: "glog" });
  }

  // Phone game log: one card per game, like the season cards.
  function logCards(g, rows) {
    const LINE = g === "hitting"
      ? [["AB", "atBats"], ["R", "runs"], ["H", "hits"], ["HR", "homeRuns"], ["RBI", "rbi"], ["BB", "baseOnBalls"], ["SO", "strikeOuts"], ["SB", "stolenBases"]]
      : [["IP", "inningsPitched"], ["H", "hits"], ["R", "runs"], ["ER", "earnedRuns"], ["BB", "baseOnBalls"], ["SO", "strikeOuts"], ["HR", "homeRuns"], ["Pit", "numberOfPitches"]];
    const head = (r) => g === "hitting" ? `${r.hits ?? 0}-${r.atBats ?? 0}${+r.homeRuns ? `, ${r.homeRuns > 1 ? r.homeRuns + " " : ""}HR` : ""}${+r.rbi ? `, ${r.rbi} RBI` : ""}`
      : `${r.inningsPitched ?? 0} IP, ${r.earnedRuns ?? 0} ER, ${r.strikeOuts ?? 0} K${r.wins ? " · W" : r.losses ? " · L" : r.saves ? " · SV" : ""}`;
    return `<div class="ycards">${rows.map((r) => `<div class="yc gl" ${r.__attrs || ""}>
        <div class="yc-h"><b class="gl-d">${esc(ymdLabel(r.date, { month: "short", day: "numeric" }))}</b>
          <span class="yc-tm"><span>${r.home ? "vs" : "@"} ${logoImg(r.opp)}${esc(r.opp.abbr || "")}</span>${r.res ? `<i class="${r.res === "W" ? "pos" : "neg"}">${r.res}</i>` : ""}</span></div>
        <div class="gl-line">${esc(head(r))}</div>
        <div class="yc-grid">${LINE.map(([h, k]) => `<span><em>${h}</em>${num(r[k])}</span>`).join("")}</div></div>`).join("")}</div>`;
  }

  // Phone year by year: still a stat table, trimmed to the columns that matter and laid out for a narrow screen.
  const CHART = {
    hitting: [["G", "gamesPlayed"], ["PA", "plateAppearances"], ["H", "hits"], ["HR", "homeRuns"], ["RBI", "rbi"], ["SB", "stolenBases"], ["BB", "baseOnBalls"], ["SO", "strikeOuts"], ["AVG", "avg", 1], ["OBP", "obp", 1], ["SLG", "slg", 1], ["OPS", "ops", 1]],
    pitching: [["W", "wins"], ["L", "losses"], ["ERA", "era", 1], ["G", (r) => r.gamesPitched ?? r.gamesPlayed], ["GS", "gamesStarted"], ["SV", "saves"], ["IP", "inningsPitched"], ["H", "hits"], ["BB", "baseOnBalls"], ["SO", "strikeOuts"], ["WHIP", "whip", 1], ["K/9", "strikeoutsPer9Inn"]],
  };
  function yearChart(group, rows, foot = null) {
    const cols = CHART[group];
    const cell = (r, [, k, isRate]) => { const v = val(r, k); return `<td>${isRate ? rate(v) : num(v)}</td>`; };
    const bySeason = {}; rows.forEach((r) => (bySeason[r.season] = bySeason[r.season] || []).push(r));
    const ordered = Object.keys(bySeason).sort().reverse().flatMap((y) => bySeason[y]);   // newest first, each season's total before its clubs
    const body = ordered.map((r) => `<tr class="${r.__cls || ""}">
        <th>${r.__cls === "part" ? "" : esc(r.season)}</th>
        <td class="tm">${r.tmId ? `<span class="lnk" data-team="${r.tmId}">${logoImg(teamById[r.tmId] || {})}${esc(r.tm)}</span>` : `${r.oLogo || ""}${esc(r.tm || "")}`}${r.lev ? ` <i class="lev">${esc(r.lev)}${r.lg ? ` · ${esc(r.lg)}` : ""}</i>` : ""}</td>
        ${cols.map((c) => cell(r, c)).join("")}</tr>`).join("");
    const car = career[group];
    const footHtml = foot ? foot.map((f) => `<tr class="tot"><th>${esc(f.season)}</th><td class="tm">${esc(f.tm)}</td>${cols.map((c) => cell(f, c)).join("")}</tr>`).join("")
      : car ? `<tr class="tot"><th>Career</th><td class="tm">${new Set(years[group].map((x) => x.season)).size} yrs</td>${cols.map((c) => cell(car, c)).join("")}</tr>` : "";
    return `<div class="ychart"><table><thead><tr><th>Year</th><td class="tm">Team</td>${cols.map(([h]) => `<td>${h}</td>`).join("")}</tr></thead>
      <tbody>${footHtml}${body}</tbody></table></div>`;
  }

  // ---- Savant: percentile rankings, spray chart / pitch movement, year by year ----
  const svTypes = mlbGroups.map((g) => (g === "pitching" ? "pitcher" : "batter"));
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
    const tabs = [...groups.map((g) => [g, g === "hitting" ? "Batting" : "Pitching"]), ["log", "Game log"], ...(mlbGroups.length ? [["savant", "Savant"]] : []), ["highlights", "Highlights"]];
    root.querySelector(".p-tabseg").innerHTML = seg(tabs, tab);
    drawLevels();
    body.scrollTop = 0;
    if (tab === "highlights") { body.innerHTML = `<div class="s-loading">Loading…</div>`; drawHighlights(); return; }
    if (tab === "savant") { savantTab(); return; }
    if (tab === "log") { body.innerHTML = `<div class="s-loading">Loading…</div>`; gameLog().catch(() => { body.innerHTML = `<div class="s-loading">No game log available</div>`; }); return; }
    if (!groups.length) { body.innerHTML = `<div class="s-loading">No major league stats yet</div>`; return; }
    const lv = curLevel();
    if (lv !== "mlb") { drawOther(lv); return; }
    const rows = yearRows(tab);
    if (typeof IS_MOBILE !== "undefined" && IS_MOBILE) { body.innerHTML = yearChart(tab, rows); return; }
    const cols = [...lead, ...(tab === "hitting" ? BAT_COLS : PIT_COLS)];
    const car = career[tab];
    sortableTable(body, cols, rows, { cls: tab === "hitting" ? "bat yby" : "pit yby", foot: car ? [{ ...car, season: `${new Set(years[tab].map((s) => s.season)).size} Yrs`, age: "", tm: "", lg: "", __cls: "tot" }] : [] });
    // Show the most recent seasons.
    body.scrollTop = body.scrollHeight;
  }
  root.querySelector(".p-tabseg").onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    tab = state.tab = b.dataset.v; draw();
  };
  root.querySelector(".p-lvl").onclick = (e) => {
    const b = e.target.closest("[data-lvl]"); if (!b || b.classList.contains("on")) return;
    state.lvl = b.dataset.lvl; draw();
  };

  // ---- Levels (Baseball Reference style): Majors, Minors, and international / winter leagues ----
  function levelsWith(g) {
    const out = mlbGroups.includes(g) ? ["mlb"] : [];
    if (other) for (const k of Object.keys(LEVELS)) if (other[k][g].length) out.push(k);
    return out;
  }
  function curLevel() {
    const lv = levelsWith(tab);
    return lv.includes(state.lvl) ? state.lvl : lv[0] || "mlb";
  }
  function drawLevels() {
    const box = root.querySelector(".p-lvl");
    const lv = tab === "hitting" || tab === "pitching" ? levelsWith(tab) : [];
    box.innerHTML = lv.length > 1 ? seg(lv.map((k) => [k, k === "mlb" ? "Majors" : LEVELS[k].label]), curLevel(), "data-lvl") : "";
  }
  function latestSport(g) {
    const rs = other ? otherRows("minors", g).concat(otherRows("intl", g)) : [];
    rs.sort((a, b) => a.season - b.season || a.rank - b.rank);
    return rs.length ? rs[rs.length - 1].sportId : 1;
  }
  // One row per club per season, with a "2TM" line first when he played for two clubs at one level.
  function otherRows(lv, g) {
    const rows = [];
    const by = {};
    for (const s of other[lv][g]) (by[`${s.season}|${s.sportId}`] = by[`${s.season}|${s.sportId}`] || []).push(s);
    const keys = Object.keys(by).sort((a, b) => {
      const [ya, sa] = a.split("|"), [yb, sb] = b.split("|");
      return ya - yb || levelRank(+sa) - levelRank(+sb);
    });
    for (const key of keys) {
      const list = by[key];
      const total = list.find((s) => !s.team);
      const parts = list.filter((s) => s.team);
      const s0 = list[0];
      const base = { season: s0.season, age: seasonAge(p.birthDate, +s0.season), lev: LEV[s0.sportId] || s0.sportAbbr || "", sportId: s0.sportId, rank: levelRank(s0.sportId) };
      if (total && parts.length > 1) rows.push({ ...total.stat, ...base, tm: `${parts.length}TM`, lg: new Set(parts.map(lgShort)).size === 1 ? lgShort(parts[0]) : "", aff: "", __cls: "multi" });
      parts.forEach((s) => rows.push({ ...s.stat, ...base, tm: s.team.name || "", oId: s.team.id, oLogo: milbLogo(s.team.id),
        lg: lgShort(s), aff: s.team.parentOrgId || affCache[`${s.season}|${s.team.id}`] || "", __cls: total && parts.length > 1 ? "part" : "" }));
      if (!parts.length && total) rows.push({ ...total.stat, ...base, tm: "", lg: lgShort(total), aff: "" });
    }
    return rows;
  }
  function otherFoot(lv, g) {
    return other[lv].careers[g].slice().sort((a, b) => levelRank(b.sportId) - levelRank(a.sportId)).map((c) => {
      const n = new Set(other[lv][g].filter((s) => s.sportId === c.sportId).map((s) => s.season)).size;
      return { ...c.stat, season: LEV[c.sportId] || c.sportAbbr || "", age: "", tm: `${n} ${n === 1 ? "season" : "seasons"}`, lg: "", lev: "", aff: "", __cls: "tot" };
    });
  }
  function drawOther(lv) {
    const rows = otherRows(lv, tab);
    const foot = otherFoot(lv, tab);
    if (typeof IS_MOBILE !== "undefined" && IS_MOBILE) { body.innerHTML = yearChart(tab, rows, foot); return; }
    const affCol = lv === "minors" ? [{ h: "Aff", k: "aff", cls: "left", title: "Major league affiliate",
      f: (r) => (r.aff && teamById[r.aff] ? `<span class="lnk tmc" data-team="${r.aff}">${logoImg(teamById[r.aff])}${esc(teamById[r.aff].abbr)}</span>` : "") }] : [];
    const cols = [
      { h: "Season", k: "season", asc: true, cls: "left" },
      { h: "Age", k: "age", asc: true },
      { h: "Tm", k: "tm", asc: true, cls: "left", f: (r) => `${r.oLogo || ""}${esc(r.tm || "")}` },
      { h: "Lg", k: "lg", asc: true, cls: "left" },
      { h: "Lev", k: "lev", asc: true, sv: (r) => r.rank, f: (r) => esc(r.lev || "") },
      ...affCol,
      ...(tab === "hitting" ? BAT_COLS : PIT_COLS),
    ];
    sortableTable(body, cols, rows, { cls: `${tab === "hitting" ? "bat" : "pit"} yby lv`, foot });
    body.scrollTop = body.scrollHeight;
    // Parent clubs come from each season's team list; fill the Aff column once they arrive.
    if (lv === "minors" && rows.some((r) => r.oId && !r.aff)) {
      loadAffiliates(rows.filter((r) => r.oId && !r.aff)).then((n) => {
        if (n && alive() && state.lvl === lv && curLevel() === lv && (tab === "hitting" || tab === "pitching")) {
          const keep = body.scrollTop; drawOther(lv); body.scrollTop = keep;
        }
      });
    }
  }

  draw();
  // A big leaguer's other levels arrive after the page is up: add the switch then.
  if (!other) otherP.then((o) => {
    if (!alive()) return;
    other = o;
    if (curLevel() !== "mlb") draw(); else drawLevels();
  });
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

// ---- Other levels: the Stats API keeps each level under its own sportId ----
const LEVELS = {
  minors: { label: "Minors", sports: [11, 12, 13, 14, 15, 5442, 16] },
  intl: { label: "Intl & winter", sports: [17, 23, 51, 31, 32] },
};
const LEV = { 11: "AAA", 12: "AA", 13: "A+", 14: "A", 15: "A-", 5442: "Rk+", 16: "Rk", 17: "Winter", 23: "Ind", 51: "Intl", 31: "NPB", 32: "KBO" };
// Low to high, so a season reads in the order he was promoted.
const LEVEL_ORDER = [16, 5442, 15, 14, 13, 12, 11, 23, 17, 31, 32, 51];
const levelRank = (sid) => { const i = LEVEL_ORDER.indexOf(sid); return i < 0 ? 99 : i; };
async function loadOtherLevels(id) {
  const one = async (sid) => {
    const d = await api(`/api/v1/people/${id}/stats?stats=yearByYear,career&group=hitting,pitching&sportId=${sid}`, { ttl: 3600_000 }).catch(() => ({ stats: [] }));
    const out = { hitting: [], pitching: [], careers: { hitting: [], pitching: [] } };
    for (const blk of d.stats || []) {
      const g = blk.group?.displayName, type = blk.type?.displayName;
      if (g !== "hitting" && g !== "pitching") continue;
      // Keep only this level's rows (the API can ignore sportId and hand back the majors).
      const splits = (blk.splits || []).filter((s) => (s.sport ? s.sport.id === sid : true) && s.stat);
      if (type === "yearByYear") out[g].push(...splits.map((s) => ({ ...s, sportId: sid, sportAbbr: s.sport?.abbreviation })));
      else if (type === "career" && splits[0]) out.careers[g].push({ stat: splits[0].stat, sportId: sid, sportAbbr: splits[0].sport?.abbreviation });
    }
    // A career line with no season rows is noise.
    for (const g of ["hitting", "pitching"]) if (!out[g].length) out.careers[g] = [];
    return out;
  };
  const res = {};
  await Promise.all(Object.entries(LEVELS).map(async ([k, L]) => {
    const parts = await Promise.all(L.sports.map(one));
    res[k] = {
      hitting: parts.flatMap((x) => x.hitting).filter((s) => s.stat.plateAppearances > 0 || s.stat.gamesPlayed > 0),
      pitching: parts.flatMap((x) => x.pitching).filter((s) => s.stat.battersFaced > 0 || parseFloat(s.stat.inningsPitched) > 0 || s.stat.gamesPitched > 0),
      careers: { hitting: parts.flatMap((x) => x.careers.hitting), pitching: parts.flatMap((x) => x.careers.pitching) },
    };
  }));
  return res;
}
// Minor league clubs' parent organizations, by season (affiliations change).
const affCache = {};
async function loadAffiliates(rows) {
  const seasons = [...new Set(rows.map((r) => r.season))];
  let n = 0;
  await Promise.all(seasons.map(async (y) => {
    const d = await apiTry([`/api/v1/teams?sportIds=11,12,13,14,15,16,5442&season=${y}&fields=teams,id,parentOrgId`,
      `/api/v1/teams?sportIds=11,12,13,14,15,16,5442&season=${y}`], { ttl: 86_400_000 }).catch(() => ({ teams: [] }));
    for (const t of d.teams || []) if (t.parentOrgId) { if (!affCache[`${y}|${t.id}`]) n++; affCache[`${y}|${t.id}`] = t.parentOrgId; }
  }));
  return n;
}
// MLB.com hosts minor league and many international club logos by team id.
const milbLogo = (id) => (id ? `<img src="https://www.mlbstatic.com/team-logos/${id}.svg" alt="" onerror="this.remove()">` : "");
function lgShort(s) {
  const l = s.league || {};
  return l.abbreviation || (l.name || "").replace(/\b(League|Baseball)\b/g, "").trim();
}
